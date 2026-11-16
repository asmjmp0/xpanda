import * as fs from "fs";
import * as path from "path";
import { NodeFactory } from "../src/ast/NodeFactory";
import { PandaFile } from "../src/file/PandaFile";
import { PandaParseException } from "../src/PandaParseException";
import { StaticDecompiler } from "../src/static/StaticDecompiler";
import { StaticPandaDisAssembler } from "../src/static/StaticPandaDisAssembler";
import { StaticPandaFile } from "../src/static/StaticPandaFile";
import { isStaticAbcVersion } from "../src/static/StaticHeader";
import type { PandaClass } from "../src/file/clazz/PandaClass";

/**
 * ArkTS-Sta (static runtime) integration tests.
 *
 * The sample is the SDK framework bytecode `fw_@ohos.UiTest.abc`: a 72-byte
 * static header, per-region entity indexes, and the static ISA (core + ets
 * plugin). Parsing is independent from the dynamic PandaFile; the shared
 * structure analysis + simplify pipeline is reused by StaticDecompiler.
 *
 * @Author: jmp0
 */

const RESOURCE = "fw_@ohos.UiTest.abc";
const EXPECTED_DIR = path.join(__dirname, "expected");

let fileCache: StaticPandaFile | null = null;
let decompilerCache: StaticDecompiler | null = null;
let allCodeCache: Map<string, string> | null = null;

function file(): StaticPandaFile {
    if (!fileCache) {
        const data = new Uint8Array(fs.readFileSync(path.join(__dirname, "resources", RESOURCE)));
        if (!isStaticAbcVersion(data.subarray(12, 16))) throw new Error("sample is not a static abc");
        fileCache = new StaticPandaFile(data);
    }
    return fileCache;
}

function decompiler(): StaticDecompiler {
    if (!decompilerCache) decompilerCache = new StaticDecompiler();
    return decompilerCache;
}

function classByName(name: string): PandaClass {
    const found = file().getAllClasses().find((clazz) => clazz.getClassName() === name);
    if (!found) throw new Error("static class not found: " + name);
    return found;
}

/** File-level output (lambdas inlined, generated lambda classes omitted). */
function allCode(): Map<string, string> {
    if (!allCodeCache) {
        allCodeCache = new Map<string, string>();
        for (const result of decompiler().decompileFile(file(), true)) {
            allCodeCache.set(result.clazz.getClassName(), result.code);
        }
    }
    return allCodeCache;
}

function codeOf(name: string): string {
    return allCode().get(name) ?? "";
}

function assertContains(code: string, needle: string, label: string): void {
    if (!code.includes(needle)) {
        throw new Error(`${label}: missing ${JSON.stringify(needle)}\n----\n${code.slice(0, 2000)}`);
    }
}

function assertNotContains(code: string, needle: string, label: string): void {
    if (code.includes(needle)) {
        throw new Error(`${label}: unexpected ${JSON.stringify(needle)}`);
    }
}

function firstDifference(expected: string, actual: string): string {
    const e = expected.split("\n");
    const a = actual.split("\n");
    for (let i = 0; i < Math.max(e.length, a.length); i++) {
        if (e[i] !== a[i]) {
            return `line ${i + 1}:\n  expected: ${e[i] ?? "<EOF>"}\n  actual:   ${a[i] ?? "<EOF>"}`;
        }
    }
    return "";
}

function assertSnapshot(className: string, snapshot: string): void {
    const actual = codeOf(className);
    const expected = fs.readFileSync(path.join(EXPECTED_DIR, snapshot), "utf-8");
    if (actual !== expected) {
        throw new Error(`static snapshot mismatch ${snapshot}\n${firstDifference(expected, actual)}`);
    }
}

// ---------------------------------------------------------------------------

// 1. Header/version/class table.
{
    const f = file();
    if (f.staticHeader.versionString() !== "0.1.0.7") throw new Error("unexpected static version");
    if (f.staticHeader.headerSize !== 72) throw new Error("unexpected static header size");
    if (f.staticHeader.numClasses !== 607) throw new Error("unexpected header class count");
    if (f.indexHeaders.length !== 1) throw new Error("unexpected region count");
    const region = f.indexHeaders[0];
    if (region.classIdxSize !== 609 || region.methodIdxSize !== 1131) {
        throw new Error("unexpected region index sizes");
    }
    if (f.getAllClasses().length !== 609) throw new Error("unexpected parsed class count");
    if (!classByName("L@ohos/UiTest/ETSGLOBAL;")) throw new Error("missing ETSGLOBAL");
}

// 2. The dynamic parser must reject a static abc with a clear message, not a DataView crash.
{
    const data = new Uint8Array(fs.readFileSync(path.join(__dirname, "resources", RESOURCE)));
    let rejected = false;
    try {
        new PandaFile(data);
    } catch (e) {
        rejected = e instanceof PandaParseException && String((e as Error).message).includes("static abc");
    }
    if (!rejected) throw new Error("PandaFile should reject ArkTS-Sta abc");
}

// 3. Every method with code disassembles.
{
    let methods = 0;
    for (const clazz of file().getAllClasses()) {
        for (const method of clazz.pandaMethods.values()) {
            if (!method.methodCode) continue;
            StaticPandaDisAssembler.disAssembly(method);
            methods++;
        }
    }
    if (methods !== 2025) throw new Error("unexpected static method count: " + methods);
}

// 4. Whole-class snapshots: module lowering (ETSGLOBAL), enum/static-init lowering,
// and lambda reconstruction (Driver).
assertSnapshot("L@ohos/UiTest/ETSGLOBAL;", "static-uitest-etsglobal.js");
assertSnapshot("L@ohos/UiTest/ComponentEventType;", "static-uitest-component-event-type.js");
assertSnapshot("L@ohos/UiTest/Driver;", "static-uitest-driver.js");

// 5. Class/method/field/call/accessor restoration.
{
    const component = codeOf("L@ohos/UiTest/Component;");
    assertContains(component, "class Component {", "Component");
    assertContains(component, "constructor(p0) {", "Component");
    assertContains(component, "this.nativeComponent = \"\";", "Component");
    assertContains(component, "return new Promise((resolve, reject) => {", "Component");
    assertContains(component, "return this.comClickSync();", "Component");
    assertContains(component, "/* native method */", "Component native methods");
    assertNotContains(component, "new lambda_", "Component lambda inlining");
    assertNotContains(component, "SimpleAnalysis", "Component");
    assertNotContains(component, "unknownMethod", "Component");

    const partial = codeOf("L@ohos/UiTest/%%partial-Component;");
    assertContains(partial, "class PartialComponent extends PartialObject {", "partial Component");
    assertContains(partial, "this.nativeComponent = null;", "partial Component");

    const objectLiteral = codeOf("L@ohos/UiTest/@ohos$UiTest$ComponentEventOptions$ObjectLiteral;");
    assertContains(objectLiteral, "get on() {", "object literal");
    assertContains(objectLiteral, "set on(p0) {", "object literal");
    assertContains(objectLiteral, "return this.on;", "object literal");
    assertContains(objectLiteral, "this.on = p0;", "object literal");

    const driver = codeOf("L@ohos/UiTest/Driver;");
    assertContains(driver, "static create() {", "Driver");
    assertContains(driver, "return new Promise((resolve, reject) => {", "Driver lambda inlining");
    assertContains(driver, "return this.dragSync(p0, p1, p2, p3, p4);", "Driver lambda body");
    assertContains(driver, "this.nativeDriver = p0;", "Driver");
    assertNotContains(driver, "lambda_invoke_201", "Driver generated method removal");
    if (codeOf("L@ohos/UiTest/%%lambda-lambda_invoke-201;") !== "") {
        throw new Error("fully inlined lambda class should not be emitted");
    }

    const uiTest = codeOf("L@ohos/UiTest/UiTest;");
    assertContains(uiTest, "loadLibraryWithPermissionCheck(\"uitest_ani\", \"@ohos.UiTest\")", "UiTest");
    assertContains(uiTest, "static GetConnectionStat() {", "UiTest native method");

    const enumClass = codeOf("L@ohos/UiTest/ComponentEventType;");
    assertContains(enumClass, "ComponentEventType.COMPONENT_CLICKED = new ComponentEventType(1, 1);", "enum");
    assertContains(enumClass, "super(new Int(p1));", "enum constructor");
    assertContains(enumClass, "static values() {", "enum static method");
}

// 6. Every emitted class parses. Fully inlined lambda classes are gone; the one
// lambda whose capture is not a simple expression is kept and still called.
{
    let classes = 0;
    let remainingLambdas = 0;
    for (const [name, code] of allCode()) {
        if (!code) continue;
        if (code.includes("SimpleAnalysis")) {
            throw new Error("static class fell back to SimpleAnalysis: " + name);
        }
        if (name.includes("%%lambda-lambda_invoke-")) remainingLambdas++;
        NodeFactory.parse(code);
        classes++;
    }
    if (classes !== 92) throw new Error("unexpected decompiled static class count: " + classes);
    if (remainingLambdas !== 1) throw new Error("unexpected remaining lambda class count: " + remainingLambdas);
    assertContains(codeOf("L@ohos/UiTest/Driver;"), "new lambda_lambda_invoke_442(", "non-inlinable lambda kept");
}

console.log("static-decompile.test.ts: ok");
