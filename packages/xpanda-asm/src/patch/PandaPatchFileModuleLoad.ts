/**
 * Module-load callback instrumentation.
 *
 * Every module record executes its top-level code in a `func_main_0` method
 * that ends in a single `returnundefined`. This layer appends an import of a
 * listener function (usually exported by the injected bootstrap module) to a
 * module record and calls it right before that final return:
 *
 *   lda.str "<record>"
 *   sta v0
 *   ldexternalmodulevar <listener import>
 *   callarg1 <ic slot>, v0
 *   returnundefined
 *
 * The listener therefore runs while the module is still evaluating; a caller
 * that needs "after evaluation" semantics (for example the gadget JSVM) should
 * queue the event and dispatch it on the next event-loop turn.
 * @Author: jmp0
 */
import type { PandaClass } from "xpanda-core";
import { assembleInstruction, decodeInstructions } from "../Assembler";
import { concatBytes } from "../codec";
import { maxIcSlot } from "./PatchBinary";
import { normalizedRequestForRecord } from "./EntityCodec";
import {
    PandaPatchError,
} from "./PatchTypes";
import type {
    PatchModuleLoadOptions, PatchModuleLoadResult, PatchedModuleLoad, SkippedModuleLoad,
} from "./PatchTypes";
import { PandaPatchFileHookPatch } from "./PandaPatchFileHookPatch";

/** Strip the `L...;` class wrapper; keep module record names untouched. */
function recordNameOf(className: string): string {
    return className.startsWith("L") && className.endsWith(";") ? className.slice(1, -1) : className;
}

export class PandaPatchFileModuleLoad extends PandaPatchFileHookPatch {
    /** Classes already instrumented in this patch session (idempotence guard). */
    private readonly moduleLoadInstrumented = new Set<PandaClass>();

    /**
     * Call `listenerName` (exported by `listenerRecordName`) before the final
     * `returnundefined` of every module's `func_main_0`.
     *
     * The listener module must already exist in this abc, normally as the module
     * moved by `patchInit(...)` whose result exposes `moduleRecordName`; declare
     * the listener function in the init source and export it through
     * `PatchInitOptions.exportFunctions`.
     */
    patchModuleLoadCallbacks(options: PatchModuleLoadOptions): PatchModuleLoadResult {
        const listenerRecordName = options.listenerRecordName?.trim();
        const listenerName = options.listenerName?.trim();
        if (!listenerRecordName) {
            throw new PandaPatchError("patchModuleLoadCallbacks requires listenerRecordName");
        }
        if (!listenerName || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(listenerName)) {
            throw new PandaPatchError(`invalid module-load listener name '${options.listenerName}'`);
        }
        const localName = options.localName?.trim() || listenerName;
        const request = normalizedRequestForRecord(listenerRecordName);
        const recordFilter = options.records
            ? new Set(options.records.map((name) => recordNameOf(name.trim())))
            : null;
        const listenerRecord = recordNameOf(listenerRecordName);

        const patched: PatchedModuleLoad[] = [];
        const skipped: SkippedModuleLoad[] = [];

        for (const clazz of this.classes()) {
            const className = clazz.getClassName();
            const moduleData = clazz.pandaClassModuleData;
            // Classes without module metadata (compiler annotations, helper records)
            // are not modules and are not worth reporting.
            if (!className || !moduleData) continue;
            const record = recordNameOf(className);
            if (recordFilter && !recordFilter.has(record) && !recordFilter.has(className)) continue;

            const skip = (reason: string): void => {
                skipped.push({ className, record, reason });
            };
            if (record === listenerRecord) {
                skip("listener module");
                continue;
            }
            if (this.moduleLoadInstrumented.has(clazz)) {
                skip("already instrumented in this session");
                continue;
            }
            if (moduleData.imports.some((item) => item.importName === null)) {
                skip("module has namespace imports; appending a regular import would shift them");
                continue;
            }
            const method = clazz.pandaMethods.get("func_main_0");
            if (!method || method.methodExternal) {
                skip("no func_main_0");
                continue;
            }
            const code = this.getMethodCode(className, "func_main_0");
            if (!code) {
                skip("func_main_0 has no code item");
                continue;
            }
            const decoded = decodeInstructions(code.instructions);
            if (decoded.length === 0) {
                skip("empty func_main_0");
                continue;
            }
            const returns = decoded.filter((instruction) => instruction.opcode.name === "returnundefined");
            if (returns.length !== 1 || returns[0] !== decoded[decoded.length - 1]) {
                skip(`func_main_0 must end in exactly one returnundefined (found ${returns.length})`);
                continue;
            }

            try {
                // v0 must be a real local: when func_main_0 has no locals, v0 is the
                // implicit func_name register and the decompiler renders writes to it
                // as an anonymous slot. Grow the frame by one before using it.
                let prepared = code;
                let returnPC = returns[0].pc;
                if (code.numVregs === 0) {
                    const grown = this.growFrame(code, 1);
                    this.replaceMethodCode(className, "func_main_0", {
                        numVregs: 1,
                        numArgs: code.numArgs,
                        instructions: grown.instructions,
                        tries: grown.tries,
                    });
                    prepared = this.getMethodCode(className, "func_main_0")!;
                    const grownDecoded = decodeInstructions(prepared.instructions);
                    const grownReturn = grownDecoded[grownDecoded.length - 1];
                    if (!grownReturn || grownReturn.opcode.name !== "returnundefined") {
                        throw new PandaPatchError("func_main_0 changed shape while growing its frame");
                    }
                    returnPC = grownReturn.pc;
                }

                const string = this.addStringId(className, record);
                if (string.id > 0xffff) {
                    throw new PandaPatchError(
                        `string id ${string.id} does not fit lda.str (16-bit) in '${className}'`);
                }
                const importIndex = this.addModuleImport(className, localName, listenerName, request);
                if (importIndex > 0xffff) {
                    throw new PandaPatchError(
                        `import index ${importIndex} does not fit ldexternalmodulevar (16-bit)`);
                }
                let icSlot = maxIcSlot(prepared.instructions) + 2;
                if (icSlot > 250) icSlot = 0;
                const loadListener = importIndex <= 0xff
                    ? assembleInstruction("ldexternalmodulevar", [importIndex])
                    : assembleInstruction("wide.ldexternalmodulevar", [importIndex]);
                const insertion = this.insertInstructions(className, "func_main_0", returnPC, concatBytes([
                    assembleInstruction("lda.str", [string.id]),
                    assembleInstruction("sta", [0]),
                    loadListener,
                    assembleInstruction("callarg1", [icSlot, 0]),
                ]));
                this.moduleLoadInstrumented.add(clazz);
                patched.push({
                    className,
                    record,
                    importIndex,
                    stringId: string.id,
                    atPC: insertion.atPC,
                    insertedLength: insertion.insertedLength,
                });
            } catch (error) {
                const reason = error instanceof Error ? error.message : String(error);
                if (options.strict) throw error;
                skip(reason);
            }
        }

        return { patched, skipped };
    }
}
