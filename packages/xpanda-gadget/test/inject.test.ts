/**
 * xpanda-gadget integration tests:
 *   1. injectAbcBytes: bootstrap module moved into the target abc, entry func_main_0
 *      calls the injected init, the bootstrap module record keeps the raw
 *      `libxpanda_gadget.so` module request (the dlopen channel);
 *   2. injectHapBytes: synthetic HAP gets the patched abc back plus the gadget .so
 *      embedded under libs/arm64-v8a/, other entries stay content-identical;
 *   3. prebuilt .so sanity: aarch64 ELF shared object with JSVM/NAPI imports.
 * @Author: jmp0
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { HapFile, PandaDecompiler, PandaFile } from "xpanda-core";
import { GADGET_SO_NAME, injectAbcBytes, injectHapBytes, writeZip } from "../src";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error("ASSERT FAILED: " + message);
}

function bundledEs2abc(): string | null {
    const executable = process.platform === "win32" ? "es2abc.exe" : "es2abc";
    const candidate = path.resolve(__dirname, "..", "..", "..", "assets", "bin",
        process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : process.platform,
        executable);
    return fs.existsSync(candidate) ? candidate : null;
}

function loadTargetAbc(): Uint8Array {
    return new Uint8Array(fs.readFileSync(path.resolve(__dirname, "..", "..", "xpanda-asm", "test", "resources", "target-multi.abc")));
}

function findClass(pandaFile: PandaFile, className: string) {
    for (const indexHeader of pandaFile.indexHeaders) {
        for (const clazz of indexHeader.pandaClasses) {
            if (clazz.getClassName() === className && !clazz.classExternal) return clazz;
        }
    }
    return null;
}

function prebuiltSo(): Uint8Array | null {
    const soPath = path.resolve(__dirname, "..", "assets", "arm64-v8a", GADGET_SO_NAME);
    return fs.existsSync(soPath) ? new Uint8Array(fs.readFileSync(soPath)) : null;
}

// ---------------------------------------------------------------- 1. abc inject
function testInjectAbc(es2abc: string): void {
    const original = loadTargetAbc();
    const result = injectAbcBytes(original, { es2abc, port: 27043 });
    assert(result.entryClass === "L&entry/src/main/ets/target&;",
        `entry discovery must pick the target entry class, got ${result.entryClass}`);
    assert(result.candidates.length >= 1, "candidates must be reported");
    assert(result.soName === GADGET_SO_NAME, "default so name");
    assert(result.bootstrapSource.includes(`import gadget from "${GADGET_SO_NAME}"`),
        "bootstrap must import the gadget .so by module request");

    const patched = result.data;
    const pandaFile = new PandaFile(patched);
    pandaFile.parseAssembly();
    const entry = findClass(pandaFile, result.entryClass);
    assert(entry, "entry class must survive the patch");
    assert(entry.pandaClassModuleData!.imports.some((item) => item.importName === result.initName),
        "entry module must import the injected init function");

    const main = entry.pandaMethods.get("func_main_0")!;
    assert(main?.methodCode, "entry func_main_0 must keep its code");
    // decompiled entry must reference the injected init call
    const decompiledMain = new PandaDecompiler().decompileClass(entry);
    assert(decompiledMain.includes(result.initName), "decompiled entry must reference the init function");

    // the injected bootstrap module must exist and keep the raw .so module request
    const hookClass = pandaFile.indexHeaders.flatMap((header) => header.pandaClasses)
        .find((clazz) => !clazz.classExternal && clazz.getClassName().includes(`xpanda/hook/${result.moduleName}`));
    assert(hookClass, "injected bootstrap module class must exist");
    assert(hookClass.pandaMethods.has(`#*#${result.initName}`), "bootstrap module must define the init function");
    const imports = hookClass.pandaClassModuleData!.imports;
    const gadgetImport = imports.find((item) => item.path.includes(GADGET_SO_NAME));
    assert(gadgetImport, "bootstrap module record must keep the .so module request");
    assert(gadgetImport!.path.includes("@normalized:Y&&&"),
        "the .so request must use the runtime native-module form, got " + gadgetImport!.path);
    assert(gadgetImport!.importName === "default", "bootstrap must default-import the gadget module");
    // and the string pool carries the request verbatim (runtime resolves it by name)
    const decoded = new TextDecoder().decode(patched);
    assert(decoded.includes(GADGET_SO_NAME), "patched abc must contain the .so request string");

    const source = new PandaDecompiler().decompileClass(hookClass);
    assert(source.includes("27043"), "decompiled bootstrap must carry the baked port");
}

// ---------------------------------------------------------------- 2. hap inject
function testInjectHap(es2abc: string): void {
    const moduleJson = {
        module: {
            name: "entry",
            mainElement: "EntryAbility",
            abilities: [{ name: "EntryAbility", srcEntry: "entryability/EntryAbility.ts" }],
        },
    };
    const moduleJsonBytes = new TextEncoder().encode(JSON.stringify(moduleJson));
    const hapBytes = writeZip([
        { name: "module.json", data: moduleJsonBytes, store: true },
        { name: "ets/modules.abc", data: loadTargetAbc() },
    ]);

    const so = prebuiltSo();
    const result = injectHapBytes(hapBytes, { es2abc, port: 27044, soData: so ?? undefined });
    assert(result.patched.length === 1, "single-abc HAP must patch exactly one entry");
    assert(result.patched[0].entryName === "ets/modules.abc", "patched entry name");
    if (so) {
        assert(result.soEntryName === `libs/arm64-v8a/${GADGET_SO_NAME}`, ".so must embed under libs/<abi>/");
    } else {
        assert(result.soEntryName === null && result.soSkippedReason, "missing .so must be reported");
        console.log("[gadget] prebuilt .so missing, embedding assertions skipped");
    }

    const out = new HapFile(result.data);
    // patched bytecode lands back in the abc entry
    const abcBytes = out.readEntry("ets/modules.abc");
    assert(abcBytes, "repacked HAP must keep the abc entry");
    const pandaFile = new PandaFile(abcBytes!);
    pandaFile.parseAssembly();
    const entry = findClass(pandaFile, result.patched[0].entryClass);
    assert(entry, "repacked abc must still parse");
    assert(entry.pandaClassModuleData!.imports.some((item) => item.importName === result.patched[0].initName),
        "repacked entry must still import the injected init function");

    // module.json must stay content-identical
    const repackedModuleJson = out.readEntry("module.json");
    assert(repackedModuleJson && repackedModuleJson.length === moduleJsonBytes.length
        && Buffer.from(repackedModuleJson).equals(Buffer.from(moduleJsonBytes)),
        "module.json must survive the repack byte-identical");

    // embedded .so is a real aarch64 ELF shared object
    if (result.soEntryName) {
        const soBytes = out.readEntry(result.soEntryName);
        assert(soBytes, "embedded .so must be readable");
        assert(soBytes![0] === 0x7f && soBytes![1] === 0x45 && soBytes![2] === 0x4c && soBytes![3] === 0x46,
            "embedded .so must be an ELF");
        assert(soBytes![4] === 2 && soBytes![5] === 1, "embedded .so must be ELF64 little-endian");
        // e_type at offset 16 == ET_DYN (3)
        assert(soBytes![16] === 3, "embedded .so must be ET_DYN (shared object)");
    }
}

// ---------------------------------------------------------------- 3. prebuilt .so sanity
function testPrebuiltSo(): void {
    const so = prebuiltSo();
    if (!so) {
        console.log("[gadget] skip prebuilt .so checks (not built)");
        return;
    }
    assert(so[0] === 0x7f && so[1] === 0x45 && so[2] === 0x4c && so[3] === 0x46, "prebuilt .so must be ELF");
    // EM_AARCH64 = 183 at offset 18
    const eMachine = so[18] | (so[19] << 8);
    assert(eMachine === 183, `prebuilt .so must be aarch64, got e_machine=${eMachine}`);
    // must reference the runtime libs it dlopens through
    const text = new TextDecoder("latin1").decode(so);
    assert(text.includes("libjsvm.so") || text.includes("OH_JSVM_RunScript"), ".so must link the JSVM bridge");
    assert(text.includes("napi_module_register"), ".so must register as a NAPI module");
}

function main(): void {
    const es2abc = bundledEs2abc();
    if (!es2abc) {
        console.log("[gadget] skip inject tests (es2abc not found)");
        return;
    }
    testInjectAbc(es2abc);
    testInjectHap(es2abc);
    testPrebuiltSo();
    console.log("[gadget] all tests passed");
}

main();
