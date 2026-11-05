/**
 * Hook slots and method-head prologues.
 * @Author: jmp0
 */
import { PandaClass } from "xpanda-core";
import { assemble, assembleInstruction, decodeInstructions } from "../Assembler";
import { concatBytes } from "../codec";
import { maxIcSlot } from "./PatchBinary";
import { patchSetterGlobalName, PATCH_SLOT_MAX, PandaPatchError } from "./PatchTypes";
import type {
    DynamicSetup, DynamicSetupEntry, HookLoader, InsertInstructionsResult,
} from "./PatchTypes";
import { PandaPatchFileModules } from "./PandaPatchFileModules";

export class PandaPatchFileHookSlots extends PandaPatchFileModules {
    protected applyMethodHeadPrologue(
        className: string,
        methodName: string,
        hook: HookLoader,
        asyncContextRegister?: number,
        insertionPC = 0,
        patchSlot?: number,
    ): InsertInstructionsResult {
        const current = this.getMethodCode(className, methodName);
        if (!current) throw new PandaPatchError(`method '${className}::${methodName}' has no code item`);

        // 选两个局部寄存器做临时寄存器;避开 async 上下文寄存器,不够时扩帧
        const excluded = asyncContextRegister !== undefined ? new Set([asyncContextRegister]) : new Set<number>();
        const collectFree = (count: number, from: number): number[] => {
            const registers: number[] = [];
            for (let register = from; register < count; register++) {
                if (!excluded.has(register)) registers.push(register);
            }
            return registers;
        };
        const dynamic = patchSlot !== undefined;
        let numVregs = current.numVregs;
        let preparedInstructions = current.instructions;
        let preparedTries = current.tries ?? [];
        let free = collectFree(numVregs, 0);
        // 动态模式多留一个寄存器保存槽里的函数,isfalse 会覆盖 acc
        const neededRegs = dynamic ? 3 : 2;
        const delta = Math.max(0, neededRegs - free.length);
        if (delta > 0) {
            const grown = this.growFrame(current, delta);
            preparedInstructions = grown.instructions;
            preparedTries = grown.tries;
            const oldNumVregs = numVregs;
            numVregs += delta;
            this.replaceMethodCode(className, methodName, {
                numVregs,
                numArgs: current.numArgs,
                instructions: preparedInstructions,
                tries: preparedTries,
            });
            free = free.concat(collectFree(numVregs, oldNumVregs));
        }

        // 参数寄存器:numArgs 的前 3 个保留给 func_name / new.target / this
        const paramCount = Math.max(0, current.numArgs - 3);
        const paramBase = numVregs + 3;
        const fieldIds = this.hookProtocolStringIds(className);

        // IC slot 分配:ldobjbyname / ldobjbyvalue / callargs2 各占 2 槽,callruntime.isfalse 占 1 槽。
        // 动态模式再给槽值真值测试留 1 槽。
        const slotCount = 2 + (paramCount > 0 ? 3 : 0) + paramCount * 2 + 3 + (dynamic ? 1 : 0);
        let base = maxIcSlot(preparedInstructions) + 2;
        if (base + slotCount > 250) base = 0;
        let nextSlot = base;
        const takeSlots = (count: number): number => {
            const slot = nextSlot;
            nextSlot += count;
            return slot;
        };
        const slotCall = takeSlots(2);
        const slotArgName = paramCount > 0 ? takeSlots(2) : 0;
        const slotArgIsFalse = paramCount > 0 ? takeSlots(1) : 0;
        const slotArgElem = Array.from({ length: paramCount }, () => takeSlots(2));
        const slotResName = takeSlots(2);
        const slotResIsFalse = takeSlots(1);
        const slotSkip = dynamic ? takeSlots(1) : 0;

        const vResult = free[0];
        const vTemp = free[1];
        const vHook = dynamic ? free[2] : 0;
        // 静态模式从目标 module 的 import 绑定取函数;动态模式 acc 里已经是槽中的函数。
        const loadHook = dynamic
            ? assembleInstruction("lda", [vHook])
            : assembleInstruction("ldexternalmodulevar", [hook.importIndex]);
        // 参数寄存器布局:numVregs + 0/1/2 = func_name / new.target / this
        const thisRegister = numVregs + 2;

        // 跳过一段指令块(`jnez` 的目标 = 当前 pc + imm),块太长时用 16 位变体
        const jumpOver = (block: Uint8Array): Uint8Array => {
            if (2 + block.length <= 0x7f) {
                return assembleInstruction("jnez", [2 + block.length], { format: "IMM8" });
            }
            return assembleInstruction("jnez", [3 + block.length], { format: "IMM16" });
        };

        const head = concatBytes([
            assemble("getunmappedargs"),
            assembleInstruction("sta", [vResult]),
            assembleInstruction("lda", [thisRegister]),
            assembleInstruction("sta", [vTemp]),
            loadHook,
            assembleInstruction("callargs2", [slotCall, vTemp, vResult]),
            assembleInstruction("sta", [vResult]),
        ]);

        // if (res.arg) { p0 = res.arg[0]; ... }
        let argBlock: Uint8Array = new Uint8Array(0);
        if (paramCount > 0) {
            const test = concatBytes([
                assembleInstruction("lda", [vResult]),
                assembleInstruction("ldobjbyname", [slotArgName, fieldIds.arg]),
                assembleInstruction("sta", [vTemp]),
                assembleInstruction("lda", [vTemp]),
                assembleInstruction("callruntime.isfalse", [slotArgIsFalse]),
            ]);
            const assign: Uint8Array[] = [];
            for (let index = 0; index < paramCount; index++) {
                assign.push(
                    assembleInstruction("ldai", [index]),
                    assembleInstruction("ldobjbyvalue", [slotArgElem[index], vTemp]),
                    assembleInstruction("sta", [paramBase + index]),
                );
            }
            const assignBytes = concatBytes(assign);
            argBlock = concatBytes([test, jumpOver(assignBytes), assignBytes]);
        }

        // if (res.res) { return res.res; }
        const earlyReturn: Uint8Array[] = [assembleInstruction("lda", [vTemp])];
        if (asyncContextRegister !== undefined) {
            // async 函数的 return 必须先 resolve 成 Promise
            earlyReturn.push(assembleInstruction("asyncfunctionresolve", [asyncContextRegister]));
        }
        earlyReturn.push(assemble("return"));
        const earlyReturnBytes = concatBytes(earlyReturn);
        const resBlock = concatBytes([
            assembleInstruction("lda", [vResult]),
            assembleInstruction("ldobjbyname", [slotResName, fieldIds.res]),
            assembleInstruction("sta", [vTemp]),
            assembleInstruction("lda", [vTemp]),
            assembleInstruction("callruntime.isfalse", [slotResIsFalse]),
            jumpOver(earlyReturnBytes),
            earlyReturnBytes,
        ]);

        let snippet = concatBytes([head, argBlock, resBlock]);
        if (dynamic) {
            // hole 的 ToBoolean 为 false,isfalse 后 jnez 跳过调用。数组尚未被 stpatchvar
            // 扩容时这里仍是越界读,所以安装代码必须先于任何被 hook 的调用执行。
            const test = concatBytes([
                assembleInstruction("wide.ldpatchvar", [patchSlot]),
                assembleInstruction("sta", [vHook]),
                assembleInstruction("lda", [vHook]),
                assembleInstruction("callruntime.isfalse", [slotSkip]),
            ]);
            snippet = concatBytes([test, jumpOver(snippet), snippet]);
        }
        const result = this.insertInstructions(className, methodName, insertionPC, snippet, {
            tryInclusion: asyncContextRegister !== undefined ? "inside" : "outside",
        });
        return {
            ...result,
            hookGlobalName: hook.name,
            ...(dynamic ? { patchSlot } : {}),
        };
    }

    /**
     * Keep the compiled setter's numArgs (proto check) and replace the body with
     * `lda v3; wide.stpatchvar slot; returnundefined`. The code item's numVregs is 0,
     * so v3 is the first user argument.
     */

    protected dynamicSetup(
        hookClass: PandaClass,
        targetClassName: string,
        slotByHook: Map<string, number>,
        setterNameByHook: Map<string, string>,
    ): DynamicSetup | undefined {
        if (slotByHook.size === 0) return undefined;
        const methodName = [...hookClass.pandaMethods.keys()]
            .find((name) => name.endsWith("<#xpanda_reserved_setup"));
        if (!methodName) {
            throw new PandaPatchError("hook module is missing class xpanda_reserved_setup");
        }
        const exports = hookClass.pandaClassModuleData?.exports;
        if (!exports) {
            throw new PandaPatchError("hook module has no exports for xpanda_reserved_setup");
        }
        const exportIndex = (exportName: string): number => {
            const index = exports.findIndex((entry) => entry.path === null && entry.exportName === exportName);
            if (index < 0) {
                throw new PandaPatchError(`hook module does not export '${exportName}'`);
            }
            return index;
        };
        const entries: DynamicSetupEntry[] = [];
        for (const [hookGlobalName, slot] of slotByHook) {
            const setterName = setterNameByHook.get(hookGlobalName);
            if (setterName === undefined) continue;
            entries.push({
                slot,
                hookExportIndex: exportIndex(hookGlobalName),
                setterExportIndex: exportIndex(setterName),
                globalNameId: this.patchSetterStringId(targetClassName, patchSetterGlobalName(hookGlobalName)),
            });
        }
        return { methodName, entries };
    }

    /** Body of `xpanda_reserved_setup.xpanda_reserved_setup`: one local holds globalThis. */
    protected setupInstructions(entries: DynamicSetupEntry[]): Uint8Array {
        const parts: Uint8Array[] = [];
        let icSlot = 0;
        for (const entry of entries) {
            parts.push(
                this.loadLocalModuleVar(entry.hookExportIndex),
                assembleInstruction("wide.stpatchvar", [entry.slot]),
                assemble("ldglobal"),
                assembleInstruction("sta", [0]),
                this.loadLocalModuleVar(entry.setterExportIndex),
                assembleInstruction("stobjbyname", [icSlot, entry.globalNameId, 0]),
            );
            icSlot += 2;
        }
        parts.push(assemble("returnundefined"));
        return concatBytes(parts);
    }

    protected loadLocalModuleVar(index: number): Uint8Array {
        if (index <= 0xff) return assembleInstruction("ldlocalmodulevar", [index]);
        return assembleInstruction("wide.ldlocalmodulevar", [index]);
    }

    protected patchSetterStringId(className: string, text: string): number {
        const clazz = this.requireClass(className);
        let byName = this.patchSetterStringIdsByRegion.get(clazz.indexHeader);
        if (!byName) {
            byName = new Map();
            this.patchSetterStringIdsByRegion.set(clazz.indexHeader, byName);
        }
        const cached = byName.get(text);
        if (cached !== undefined) return cached;
        const id = this.addStringId(className, text).id;
        byName.set(text, id);
        return id;
    }

    protected allocatePatchSlot(hookName: string): number {
        const reserved = this.patchSlotsByHook.get(hookName);
        if (reserved !== undefined) return reserved;
        this.notePatchSlotsFromFile();
        while (this.patchSlotCursor <= PATCH_SLOT_MAX && this.observedPatchSlots.has(this.patchSlotCursor)) {
            this.patchSlotCursor++;
        }
        if (this.patchSlotCursor > PATCH_SLOT_MAX) {
            throw new PandaPatchError("no free GlobalPatch slot");
        }
        const slot = this.patchSlotCursor++;
        this.observedPatchSlots.add(slot);
        this.patchSlotsByHook.set(hookName, slot);
        return slot;
    }

    protected claimPatchSlot(hookName: string, slot: number): number {
        if (!Number.isInteger(slot) || slot < 0 || slot > PATCH_SLOT_MAX) {
            throw new PandaPatchError(
                `patch slot ${slot} is out of range; the runtime sign-extends the imm16, so the slot must be 0..${PATCH_SLOT_MAX}`);
        }
        const bound = this.patchSlotsByHook.get(hookName);
        if (bound !== undefined && bound !== slot) {
            throw new PandaPatchError(`hook '${hookName}' is already bound to patch slot ${bound}`);
        }
        for (const [other, used] of this.patchSlotsByHook) {
            if (other !== hookName && used === slot) {
                throw new PandaPatchError(`patch slot ${slot} is already used by hook '${other}'`);
            }
        }
        this.notePatchSlotsFromFile();
        if (this.observedPatchSlots.has(slot) && bound !== slot) {
            throw new PandaPatchError(`patch slot ${slot} is already used in this abc`);
        }
        this.observedPatchSlots.add(slot);
        this.patchSlotsByHook.set(hookName, slot);
        if (slot >= this.patchSlotCursor) this.patchSlotCursor = slot + 1;
        return slot;
    }

    /** Record wide.ldpatchvar / wide.stpatchvar immediates already present in the file. */
    protected notePatchSlotsFromFile(): void {
        if (this.patchSlotsScanned) return;
        this.patchSlotsScanned = true;
        let max = this.patchSlotCursor - 1;
        for (const clazz of this.classes()) {
            const className = clazz.getClassName();
            for (const methodName of this.getMethodNames(className)) {
                const code = this.getMethodCode(className, methodName);
                if (!code) continue;
                for (const instruction of decodeInstructions(code.instructions)) {
                    if (instruction.opcode.name !== "wide.ldpatchvar"
                        && instruction.opcode.name !== "wide.stpatchvar") continue;
                    const slot = instruction.operands[0];
                    this.observedPatchSlots.add(slot);
                    if (slot > max) max = slot;
                }
            }
        }
        if (max + 1 > this.patchSlotCursor) this.patchSlotCursor = max + 1;
    }

    /**
     * hook 协议字段名(`arg` / `res`)在目标 region 里的 string id。
     * 实体索引表按 region 共享,同一个 region 只追加一次。
     */

    protected hookProtocolStringIds(className: string): { arg: number; res: number } {
        const clazz = this.requireClass(className);
        const cached = this.hookProtocolStringIdsByRegion.get(clazz.indexHeader);
        if (cached) return cached;
        const ids = {
            arg: this.addStringId(className, "arg").id,
            res: this.addStringId(className, "res").id,
        };
        this.hookProtocolStringIdsByRegion.set(clazz.indexHeader, ids);
        return ids;
    }

    /**
     * 两段式 AOP 第一步:校验目标方法并预约 hook 名。
     * 同一个 hook 名可以对多个方法各调用一次(显式传同一个 hookGlobalName);
     * 不传时每次生成新的随机名。返回值既用作 hook 函数名,也用作注入代码查找的全局名。
     */

}
