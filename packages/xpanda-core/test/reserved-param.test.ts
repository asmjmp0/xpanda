/**
 * Regression for the post-structure reserved-parameter pass.
 *
 * Raw output must not leak the compiler's `panda_jmp0_reserved_param_*` entry
 * parameters: a stable `p2 = this` folds to `this`, a mutable `p2` is renamed
 * to a normal local, `p1` becomes `new.target`, and `p0` becomes the function
 * or class name. The pass has to be complete enough that simplify no longer
 * has to special-case these names.
 * @Author: jmp0
 */
import * as fs from "fs";
import * as path from "path";
import { PandaFile } from "../src/file/PandaFile";
import { PandaDecompiler } from "../src/PandaDecompiler";
import { resolveReservedParams } from "../src/decompiler/ReservedParamResolver";
import { NodeFactory } from "../src/ast/NodeFactory";

function assert(condition: boolean, message: string): void {
    if (!condition) {
        throw new Error(message);
    }
}

function resolve(source: string): string {
    const program = NodeFactory.parse(source);
    resolveReservedParams(program);
    const output = NodeFactory.generate(program);
    assert(!output.includes("panda_jmp0_reserved_param"), `reserved parameter leaked:\n${output}`);
    return output;
}

const stable = resolve(`
function foo() {
  let v0, panda_jmp0_reserved_param_p2;
  panda_jmp0_reserved_param_p2 = this;
  return panda_jmp0_reserved_param_p2.value;
}
`);
assert(stable.includes("return this.value;"), `stable p2 should fold to this:\n${stable}`);
assert(!stable.includes("= this;"), `stable p2 preamble should be removed:\n${stable}`);

const mutable = resolve(`
function bar(p0) {
  let panda_jmp0_reserved_param_p2;
  panda_jmp0_reserved_param_p2 = this;
  if (p0) {
    panda_jmp0_reserved_param_p2 = p0;
  }
  return panda_jmp0_reserved_param_p2.value;
}
`);
assert(/thisArg\d* = this;/.test(mutable), `mutable p2 must keep its initializer:\n${mutable}`);
assert(/thisArg\d* = p0;/.test(mutable), `mutable p2 assignment must be renamed:\n${mutable}`);
assert(/return thisArg\d*\.value;/.test(mutable), `mutable p2 read must be renamed:\n${mutable}`);
assert(!/this\s*=/.test(mutable), `mutable p2 must not become an assignment to this:\n${mutable}`);

const newTarget = resolve(`
function baz() {
  let panda_jmp0_reserved_param_p1;
  return panda_jmp0_reserved_param_p1;
}
`);
assert(newTarget.includes("return new.target;"), `p1 should become new.target:\n${newTarget}`);

const named = resolve(`
const fn = function named() {
  let panda_jmp0_reserved_param_p0;
  return panda_jmp0_reserved_param_p0;
};
`);
assert(named.includes("return named;"), `p0 should become the function name:\n${named}`);

const lexBegin = resolve(`
function lex() {
  panda_jmp0_reserved_lex_begin;
  return 1;
}
`);
assert(!lexBegin.includes("panda_jmp0_reserved_lex_begin"), `lex_begin marker must be removed:\n${lexBegin}`);
assert(lexBegin.includes("return 1;"), `lex_begin must not remove the rest of the function:\n${lexBegin}`);

const sendable = resolve(`
const SendableThing = class SendableThing {
  method() {
    return panda_jmp0_reserved_sendable_class;
  }
};
`);
assert(sendable.includes("return SendableThing;"), `sendable class marker should become the class name:\n${sendable}`);

const exportName = resolve(`
let panda_jmp0_reserved_export_name_exported = 1;
let exported = 2;
console.log(panda_jmp0_reserved_export_name_exported);
export { exported };
`);
assert(!exportName.includes("panda_jmp0_reserved_export_name_"), `export-name alias must be removed:\n${exportName}`);
assert(exportName.includes("console.log(exported);"), `export-name reference should use the real name:\n${exportName}`);
assert(exportName.includes("export { exported };"), `real export binding must stay:\n${exportName}`);

// End-to-end: raw md5 output has no reserved entry parameters.
const data = new Uint8Array(fs.readFileSync(path.join(__dirname, "resources", "md5.abc")));
const pandaFile = new PandaFile(data);
pandaFile.parseAssembly();
const decompiler = new PandaDecompiler();
const rawParts: string[] = [];
for (const clazz of pandaFile.getAllClasses()) {
    const raw = decompiler.decompileClassRaw(clazz);
    if (raw.length > 0) rawParts.push(raw);
}
const raw = rawParts.join("\n");
assert(raw.length > 0, "md5.abc produced no raw output");
assert(!raw.includes("panda_jmp0_reserved_param"), "md5.abc raw output still contains a reserved parameter");

console.log("reserved-param.test.ts ok");
