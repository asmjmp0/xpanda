/**
 * Two-phase hook patching orchestration.
 * @Author: jmp0
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { PandaClass, PandaFile } from "xpanda-core";
import { assembleInstruction, decodeInstructions } from "../Assembler";
import { resolveEs2abc, resolveTargetApiVersion, runEs2abc } from "./Es2Abc";
import { concatBytes } from "../codec";
import { maxIcSlot } from "./PatchBinary";
import { buildHookClassSource } from "./HookSource";
import { normalizedRequestForRecord } from "./EntityCodec";
import { DEFAULT_INIT_FUNCTION, generateHookName, patchSetterGlobalName, PandaPatchError } from "./PatchTypes";
import type {
    InsertInstructionsResult, PatchInitOptions, PatchInitResult,
    PatchMethodHeadSourceOptions, PrepareMethodHeadOptions, PreparedTarget,
} from "./PatchTypes";
import { PandaPatchFileEntities } from "./PandaPatchFileEntities";
import { PandaPatchFileHookImport } from "./PandaPatchFileHookImport";

interface PatchModuleResult {
    results: InsertInstructionsResult[];
    initResult?: PatchInitResult;
}

export class PandaPatchFileHookPatch extends PandaPatchFileHookImport {
    prepareMethodHead(className: string, methodName: string, options: PrepareMethodHeadOptions = {}): string {
        const current = this.getMethodCode(className, methodName);
        if (!current) throw new PandaPatchError(`method '${className}::${methodName}' has no code item`);
        const decoded = decodeInstructions(current.instructions);
        if (decoded.some((instruction) => /^(creategeneratorobj|generator)/.test(instruction.opcode.name))) {
            throw new PandaPatchError("patchMethodHead does not support generator functions");
        }

        // async 函数:前导插在 `asyncfunctionenter; sta vCtx` 之后,早退用 asyncfunctionresolve
        let asyncContextRegister: number | undefined;
        let insertionPC: number | undefined;
        const asyncIndex = decoded.findIndex((instruction) => instruction.opcode.name === "asyncfunctionenter");
        if (asyncIndex >= 0) {
            const store = decoded[asyncIndex + 1];
            if (!store || store.opcode.name !== "sta" || store.operands.length !== 1) {
                throw new PandaPatchError("unsupported async prologue shape (expected `asyncfunctionenter; sta vCtx`)");
            }
            asyncContextRegister = store.operands[0];
            if (asyncContextRegister >= current.numVregs) {
                throw new PandaPatchError("async context register is not a local register");
            }
            const after = decoded[asyncIndex + 2];
            insertionPC = after ? after.pc : current.instructions.length;
        }

        let hookGlobalName = options.hookGlobalName;
        if (hookGlobalName === undefined) {
            do {
                hookGlobalName = generateHookName();
            } while (this.preparedMethodHeads.has(hookGlobalName));
        }
        let targets = this.preparedMethodHeads.get(hookGlobalName);
        if (!targets) {
            targets = [];
            this.preparedMethodHeads.set(hookGlobalName, targets);
        }
        if (targets.some((target) => target.className === className && target.methodName === methodName)) {
            throw new PandaPatchError(`method '${className}::${methodName}' is already prepared for hook '${hookGlobalName}'`);
        }
        targets.push({ className, methodName, asyncContextRegister, insertionPC });
        return hookGlobalName;
    }

    /**
     * 两段式 AOP 第二步:编译 hook 源码 → 把 hook class 搬进目标 abc → 给所有预约的方法插入前导。
     * 同一个 hook 名预约了多个方法时,这里只编译/搬运一次,然后逐个插入。
     */

    patchMethodHeads(hookGlobalName: string, hookSource: string, options: PatchMethodHeadSourceOptions = {}): InsertInstructionsResult[] {
        const targets = this.preparedMethodHeads.get(hookGlobalName);
        if (!targets || targets.length === 0) {
            throw new PandaPatchError(`unknown hook name '${hookGlobalName}'; call prepareMethodHead first`);
        }
        return this.patchHookSource(
            [hookGlobalName], new Map([[hookGlobalName, targets]]), hookSource, options);
    }

    /**
     * 把同一份 hook 源文件里的多个 hook 函数一次性注入目标 abc:
     * 源文件按 hook 名分组只编译一次、只搬一个 hook module,每个 hook 各自 import,
     * 再挂到 `prepareMethodHead` 预约的目标方法上。
     *
     * 源文件里除这些入口函数外的顶层函数会作为同一个 module 的辅助函数一起搬走。
     * 所有 hook 的目标类必须位于同一个 index region(hook class 只会搬一份)。
     */

    patchHookBundle(
        hookGlobalNames: string[],
        hookSource: string,
        options: PatchMethodHeadSourceOptions = {},
    ): InsertInstructionsResult[] {
        if (hookGlobalNames.length === 0) {
            throw new PandaPatchError("patchHookBundle requires at least one hook name");
        }
        if (new Set(hookGlobalNames).size !== hookGlobalNames.length) {
            throw new PandaPatchError("patchHookBundle hook names must be unique");
        }
        const targetsByHook = new Map<string, PreparedTarget[]>();
        for (const hookGlobalName of hookGlobalNames) {
            const targets = this.preparedMethodHeads.get(hookGlobalName);
            if (!targets || targets.length === 0) {
                throw new PandaPatchError(`unknown hook name '${hookGlobalName}'; call prepareMethodHead first`);
            }
            targetsByHook.set(hookGlobalName, targets);
        }
        return this.patchHookSource(hookGlobalNames, targetsByHook, hookSource, options);
    }

    protected patchHookSource(
        hookGlobalNames: string[],
        targetsByHook: Map<string, PreparedTarget[]>,
        hookSource: string,
        options: PatchMethodHeadSourceOptions,
    ): InsertInstructionsResult[] {
        return this.withTempDir(options.es2abc, options.targetApiVersion, options.keepTemp, (es2abc, apiVersionArgs, targetBcVersion, tempDir) =>
            this.patchMethodHeadsClass(
                hookGlobalNames, targetsByHook, hookSource, es2abc, apiVersionArgs, targetBcVersion, tempDir, options,
            ).results);
    }

    /**
     * 只注入 init 函数,不 hook 任何方法:把初始化 module 搬进入口类所在 region,
     * 给入口 module 追加 init 函数的 import,并在 `func_main_0` 开头调用它。
     */
    patchInit(initSource: string, options: PatchInitOptions): PatchInitResult {
        const init = initSource?.trim();
        if (!init) {
            throw new PandaPatchError("patchInit requires init source");
        }
        if (!options.setupClassName) {
            throw new PandaPatchError("patchInit requires setupClassName (the entry class that calls init)");
        }
        const initName = options.initName?.trim() || DEFAULT_INIT_FUNCTION;
        return this.withTempDir(options.es2abc, options.targetApiVersion, options.keepTemp, (es2abc, apiVersionArgs, targetBcVersion, tempDir) => {
            const moduleName = generateHookName("__xpanda_init");
            const result = this.patchMethodHeadsClass(
                [], new Map(), init, es2abc, apiVersionArgs, targetBcVersion, tempDir,
                { ...options, init: initName }, moduleName,
            );
            if (!result.initResult) {
                throw new PandaPatchError("internal error: init was not injected");
            }
            return result.initResult;
        });
    }

    /** First patched host class, used as a fallback when no setup class is given. */
    private firstTargetClass(targetsByHook: Map<string, PreparedTarget[]>): PandaClass | undefined {
        for (const targets of targetsByHook.values()) {
            if (targets.length > 0) return this.requireClass(targets[0].className);
        }
        return undefined;
    }

    /**
     * Injected module records must follow the target abc's record-name convention.
     *
     * The runtime's `JSPandaFile::CheckIsRecordWithBundleName` samples one record from
     * the merged abc: when that record lacks the bundle prefix, it strips the
     * `bundleName/moduleName` prefix from the entry point (`AdaptOldIsaRecord`) and
     * the entry module can no longer be found. `&name&` records are module-relative
     * (the historical hook shape); plain `Lpath/...;` class names mean the abc stores
     * bundle-prefixed records, so the injected record must carry the same first path
     * segment (e.g. `&com.example.app/xpanda/hook/...&`).
     */
    private injectedRecordName(moduleName: string, sourceClass: PandaClass | undefined): string {
        const className = sourceClass?.getClassName();
        if (className && className.startsWith("L") && className.endsWith(";")) {
            const body = className.slice(1, -1);
            if (!body.startsWith("&")) {
                const slash = body.indexOf("/");
                if (slash > 0) return `&${body.slice(0, slash)}/xpanda/hook/${moduleName}&`;
            }
        }
        return `&xpanda/hook/${moduleName}&`;
    }

    private withTempDir<T>(
        es2abcOption: string | undefined,
        targetApiVersionOption: number | undefined,
        keepTemp: boolean | undefined,
        run: (es2abc: string, apiVersionArgs: string[], targetBcVersion: string, tempDir: string) => T,
    ): T {
        const es2abc = resolveEs2abc(es2abcOption);
        // hook/init 必须使用与目标 abc 相同的字节码版本
        const targetBcVersion = this.pf.header.versionString();
        const targetApiVersion = resolveTargetApiVersion(es2abc, targetBcVersion, targetApiVersionOption);
        const apiVersionArgs = ["--target-api-version", String(targetApiVersion)];
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "xpanda-asm-"));
        try {
            return run(es2abc, apiVersionArgs, targetBcVersion, tempDir);
        } finally {
            if (keepTemp) {
                console.log(`[xpanda-asm] temp dir kept: ${tempDir}`);
            } else {
                fs.rmSync(tempDir, { recursive: true, force: true });
            }
        }
    }

    /**
     * class 注入:es2abc 把 hook 源码编译成带独立 module record 的 abc,把这个 hook class
     * (类实体 + 方法 + 字符串/literal array 依赖 + module record)整体搬到目标 abc 的同一
     * region,并把 module 字段(import/export 表)一起搬过来。
     *
     * 然后给目标 module 追加 import 表项(指向 hook record),前导用
     * `ldexternalmodulevar` 取 hook 函数 —— hook 内部的 import / 顶层变量因此能正常解析。
     *
     * 目标 region 需要 proto index table 无效(>= 12.0.1.0)。
     */

    protected patchMethodHeadsClass(
        hookGlobalNames: string[],
        targetsByHook: Map<string, PreparedTarget[]>,
        hookSource: string,
        es2abc: string,
        apiVersionArgs: string[],
        targetBcVersion: string,
        tempDir: string,
        options: PatchMethodHeadSourceOptions,
        moduleNameOverride?: string,
    ): PatchModuleResult {
        // 一个 bundle 只生成一个 hook module;module 名取第一个 hook 名(与单 hook 的命名保持一致)。
        // init-only 时没有 hook 名,使用调用方生成的 moduleName。
        const hookModuleName = moduleNameOverride ?? hookGlobalNames[0];
        if (!hookModuleName) {
            throw new PandaPatchError("hook module name is required");
        }
        const dynamic = options.dynamic === true;
        const initName = options.init !== undefined && options.init.trim() !== "" ? options.init.trim() : undefined;
        const extraExports = (options.exportFunctions ?? [])
            .map((name) => name.trim())
            .filter((name) => name.length > 0);
        if (options.patchSlot !== undefined && !dynamic) {
            throw new PandaPatchError("patchSlot requires dynamic: true");
        }
        if (options.patchSlot !== undefined && hookGlobalNames.length !== 1) {
            throw new PandaPatchError(
                "patchSlot applies to a single hook; omit it when patching several hooks at once");
        }
        if (initName !== undefined && options.setupClassName === undefined) {
            throw new PandaPatchError("init requires setupClassName (the entry class that calls it)");
        }
        if (options.setupClassName !== undefined && !dynamic && initName === undefined) {
            throw new PandaPatchError(
                "setupClassName requires dynamic: true; a static hook must be imported by every target module");
        }
        const setupClass = options.setupClassName === undefined
            ? undefined
            : this.requireClass(options.setupClassName);
        const slotByHook = new Map<string, number>();
        const setterNameByHook = new Map<string, string>();
        if (dynamic) {
            for (const hookGlobalName of hookGlobalNames) {
                const slot = options.patchSlot !== undefined
                    ? this.claimPatchSlot(hookGlobalName, options.patchSlot)
                    : this.allocatePatchSlot(hookGlobalName);
                slotByHook.set(hookGlobalName, slot);
                setterNameByHook.set(hookGlobalName, `${hookGlobalName}__set`);
            }
        }
        const hookSourcePath = path.join(tempDir, "hook-class.js");
        fs.writeFileSync(
            hookSourcePath,
            buildHookClassSource(hookGlobalNames, hookSource, [...setterNameByHook.values()], initName, extraExports),
        );
        const hookAbcPath = path.join(tempDir, "hook-class.abc");
        const hookRecordName = this.injectedRecordName(hookModuleName, setupClass
            ?? this.firstTargetClass(targetsByHook));
        runEs2abc(es2abc, [
            "--module", "--merge-abc", ...apiVersionArgs,
            "--record-name", hookRecordName,
            "--output", hookAbcPath,
            hookSourcePath,
        ]);

        const hookBytes = new Uint8Array(fs.readFileSync(hookAbcPath));
        const hookVersion = `${hookBytes[12]}.${hookBytes[13]}.${hookBytes[14]}.${hookBytes[15]}`;
        if (hookVersion !== targetBcVersion) {
            throw new PandaPatchError(
                `hook bytecode version ${hookVersion} does not match target ${targetBcVersion}; `
                + "pass targetApiVersion explicitly");
        }
        const hookFile = new PandaFile(hookBytes);
        const hookPatch = PandaPatchFileEntities.createForImport(hookBytes);
        const hookClassName = `L${hookRecordName};`;
        const hookClass = hookFile.getAllClasses().find((clazz) => clazz.getClassName() === hookClassName);
        if (!hookClass) {
            throw new PandaPatchError(
                "moving the hook class requires the hook source to declare "
                + `'function ${hookModuleName}(...)'; class '${hookClassName}' was not compiled`);
        }
        const hookModuleData = hookClass.pandaClassModuleData;
        if (!hookModuleData) {
            throw new PandaPatchError("hook abc has no module record; the hook must be compiled as an ES module");
        }
        for (const hookGlobalName of hookGlobalNames) {
            const hookMethodName = `#*#${hookGlobalName}`;
            if (!hookClass.pandaMethods.has(hookMethodName)) {
                throw new PandaPatchError(
                    "moving the hook class requires the hook source to declare "
                    + `'function ${hookGlobalName}(...)'; method '${hookClassName}::${hookMethodName}' was not compiled`);
            }
            const exported = hookModuleData.exports.some((exp) =>
                exp.path === null && exp.exportName === hookGlobalName);
            if (!exported) {
                throw new PandaPatchError(
                    `the hook module must export '${hookGlobalName}' (use 'export function ${hookGlobalName}(...)')`);
            }
        }
        if (initName !== undefined) {
            if (!hookClass.pandaMethods.has(`#*#${initName}`)) {
                throw new PandaPatchError(
                    "moving the hook class requires the hook/init source to declare "
                    + `'function ${initName}(...)'; method '${hookClassName}::#*#${initName}' was not compiled`);
            }
            const exported = hookModuleData.exports.some((exp) =>
                exp.path === null && exp.exportName === initName);
            if (!exported) {
                throw new PandaPatchError(
                    `the init module must export '${initName}' (use 'export function ${initName}(...)')`);
            }
        }
        for (const name of extraExports) {
            if (!hookClass.pandaMethods.has(`#*#${name}`)) {
                throw new PandaPatchError(
                    "moving the hook class requires the hook/init source to declare "
                    + `'function ${name}(...)'; method '${hookClassName}::#*#${name}' was not compiled`);
            }
            const exported = hookModuleData.exports.some((exp) =>
                exp.path === null && exp.exportName === name);
            if (!exported) {
                throw new PandaPatchError(
                    `the module must export '${name}' (use 'export function ${name}(...)')`);
            }
        }

        // 一个 bundle 的 hook class 只搬进一个 region。缺省是目标方法所在的 region
        //(所有目标类必须同 region);dynamic hook 指定 setupClassName 时跟着 setup 类走,
        // 目标方法可以分散在其它 region(动态前导不读 import,只需要 setup 先执行)。
        const targetClasses: PandaClass[] = [];
        for (const hookGlobalName of hookGlobalNames) {
            for (const target of targetsByHook.get(hookGlobalName)!) {
                const targetClass = this.requireClass(target.className);
                if (!targetClasses.includes(targetClass)) targetClasses.push(targetClass);
            }
        }
        if (targetClasses.length === 0 && initName === undefined) {
            throw new PandaPatchError("patchHookBundle requires at least one prepared target method");
        }
        const dynamicHooks = dynamic && hookGlobalNames.length > 0;
        if (!dynamicHooks && targetClasses.length > 1) {
            const targetRegion = targetClasses[0].indexHeader;
            if (targetClasses.some((targetClass) => targetClass.indexHeader !== targetRegion)) {
                throw new PandaPatchError(
                    "moving the hook class into methods of different index regions is not supported");
            }
        }
        const hookHostClass = dynamicHooks && setupClass
            ? setupClass
            : (targetClasses[0] ?? setupClass);
        if (!hookHostClass) {
            throw new PandaPatchError("patchHookBundle requires at least one prepared target method");
        }

        // import 触发 hook 模块求值,是 setup 写槽的唯一入口:
        // 缺省挂到每个目标类上;dynamic hook 指定 setupClassName 时只挂到该类。
        const importHosts = new Map<string, Set<string>>();
        if (hookGlobalNames.length > 0) {
            if (dynamic && setupClass) {
                importHosts.set(setupClass.getClassName(), new Set(hookGlobalNames));
            } else {
                for (const hookGlobalName of hookGlobalNames) {
                    for (const target of targetsByHook.get(hookGlobalName)!) {
                        let classHooks = importHosts.get(target.className);
                        if (!classHooks) {
                            classHooks = new Set();
                            importHosts.set(target.className, classHooks);
                        }
                        classHooks.add(hookGlobalName);
                    }
                }
            }
        }
        // localName 是目标 module record 内的局部名:同一个类导入多个 hook 时无法共用一个
        if (options.localName !== undefined) {
            for (const [className, classHooks] of importHosts) {
                if (classHooks.size > 1) {
                    throw new PandaPatchError(
                        `localName cannot be used because '${className}' imports multiple hooks; `
                        + "use the default per-hook local names");
                }
            }
        }

        // import 宿主没有 module record(bundle-pack / 未合并 abc)时硬加一个:
        // isCommonjs + moduleRecordIdx + 空 module record,后续再追加 hook/init import。
        const moduleHosts = new Set(importHosts.keys());
        if (initName !== undefined) moduleHosts.add(setupClass.getClassName());
        for (const hostClassName of moduleHosts) {
            this.ensureModuleRecord(this.requireClass(hostClassName));
        }

        const setterSlots = new Map<string, number>();
        for (const [hookGlobalName, setterName] of setterNameByHook) {
            setterSlots.set(`#*#${setterName}`, slotByHook.get(hookGlobalName)!);
        }
        const setup = this.dynamicSetup(hookClass, hookHostClass.getClassName(), slotByHook, setterNameByHook);
        this.importHookClass(
            hookFile, hookPatch, hookClass, hookHostClass.getClassName(), options,
            setterSlots.size > 0 ? setterSlots : undefined,
            setup,
        );

        const recordName = hookClassName.slice(1, -1);
        const request = normalizedRequestForRecord(recordName);
        const importKey = (className: string, hookGlobalName: string): string =>
            `${className}\u0000${hookGlobalName}`;
        const importIndexByClassHook = new Map<string, number>();
        // 动态前导本身不读这个 import，但它是 hook 模块被求值、setup 写槽的唯一入口。
        for (const [hostClassName, hostHooks] of importHosts) {
            for (const hookGlobalName of hostHooks) {
                importIndexByClassHook.set(
                    importKey(hostClassName, hookGlobalName),
                    this.addModuleImport(
                        hostClassName,
                        options.localName ?? hookGlobalName,
                        hookGlobalName,
                        request));
            }
        }

        let initResult: PatchInitResult | undefined;
        if (initName !== undefined) {
            const entryClassName = setupClass.getClassName();
            const initImportIndex = this.addModuleImport(
                entryClassName,
                `${options.localName ?? hookModuleName}__init`,
                initName,
                request);
            const insertion = this.injectInitCall(entryClassName, initImportIndex);
            initResult = {
                className: entryClassName,
                methodName: "func_main_0",
                moduleName: hookModuleName,
                initName,
                moduleClassName: hookClassName,
                moduleRecordName: hookRecordName,
                importIndex: initImportIndex,
                atPC: insertion.atPC,
                insertedLength: insertion.insertedLength,
                codeOffset: insertion.codeOffset,
            };
        }

        const results: InsertInstructionsResult[] = [];
        for (const hookGlobalName of hookGlobalNames) {
            for (const target of targetsByHook.get(hookGlobalName)!) {
                const prologue = this.applyMethodHeadPrologue(
                    target.className,
                    target.methodName,
                    {
                        // 动态模式不读这个 import;指定 setupClassName 时目标类上没有 import。
                        importIndex: importIndexByClassHook.get(importKey(target.className, hookGlobalName)) ?? 0,
                        name: hookGlobalName,
                    },
                    target.asyncContextRegister,
                    target.insertionPC ?? 0,
                    slotByHook.get(hookGlobalName),
                );
                const setterName = setterNameByHook.get(hookGlobalName);
                results.push(setterName === undefined ? prologue : {
                    ...prologue,
                    setterGlobalName: patchSetterGlobalName(hookGlobalName),
                    setterMethodName: `#*#${setterName}`,
                });
            }
        }
        for (const hookGlobalName of hookGlobalNames) {
            this.preparedMethodHeads.delete(hookGlobalName);
        }
        return { results, initResult };
    }

    /**
     * 在入口类 `func_main_0` 开头调用 init:module import 已完成求值(动态模式下
     * setup 已执行),因此 init 一定在 setup 之后。
     */
    protected injectInitCall(className: string, importIndex: number): InsertInstructionsResult {
        const methodName = "func_main_0";
        const code = this.getMethodCode(className, methodName);
        if (!code) {
            throw new PandaPatchError(`init requires class '${className}' to have a func_main_0 method`);
        }
        let icSlot = maxIcSlot(code.instructions) + 2;
        if (icSlot > 250) icSlot = 0;
        const snippet = concatBytes([
            assembleInstruction("ldexternalmodulevar", [importIndex]),
            assembleInstruction("callarg0", [icSlot]),
        ]);
        return this.insertInstructions(className, methodName, 0, snippet);
    }

    /**
     * 把一个 class 从 hook abc 搬到目标 region:
     *   - 方法代码里的字符串 / literal array / 方法 id 按目标 region 重新分配;
     *   - 方法实体重写 class_idx / proto_idx / name / header index,丢弃 debug/annotation tag;
     *   - 类实体保留 name / super / access_flags / fields / methods,module 字段
     *     (含 module record)一起搬过来;
     *   - 类与方法的索引表追加到文件末尾。
     * 返回导入后的方法名 → region 内方法 id。
     */

    patchMethodHead(hookGlobalName: string, hookSource: string, options: PatchMethodHeadSourceOptions = {}): InsertInstructionsResult {
        return this.patchMethodHeads(hookGlobalName, hookSource, options)[0];
    }

    /**
     * 新增方法:克隆一个模板方法实体(复用 proto/access flags),追加方法名与代码,
     * 重建类实体并重定位,最后把新方法登记到类索引表(返回可用于 call 指令的 id)。
     */

}
