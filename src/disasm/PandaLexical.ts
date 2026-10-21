import { PandaDisAssembler } from "./PandaDisAssembler";
import type { PandaIRCFG } from "./PandaIRCFG";
import type { PandaInstruction } from "./PandaInstruction";
import { PandaIRBasicBlock } from "./PandaIRBasicBlock";
import { runSplitJumpPass, runSplitTryCatchPass } from "./passes";
import { ENTRY_FUNCTION_MAIN } from "../file/PandaFile";
import { PandaMethod } from "../file/method/PandaMethod";
import type { PandaClass } from "../file/clazz/PandaClass";

/**
 * 词法环境/类型分析(移植自 Java jmp0.abc.disasm.lexical.PandaLexical)
 * 记录每个方法的词法层级与虚寄存器类型,并惰性反汇编所有内嵌方法
 * @Author: jmp0
 */
export class PandaLexical {
    private finished = false;
    private readonly lexicalMap = new Map<PandaMethod, PandaLexicalDescription>();
    private readonly typeMap = new Map<PandaMethod, Map<string, string>>();

    constructor(private readonly pandaClass: PandaClass) {
        this.analyze();
    }

    private getInnerDeclaredMethods(instruction: PandaInstruction): PandaMethod[] {
        const methods: PandaMethod[] = [];
        // method in object
        if (instruction.kind === "createObject") {
            for (const value of instruction.objMap.values()) {
                if (value instanceof PandaMethod) methods.push(value);
            }
            // method in class
        } else if (instruction.kind === "defineClassWithBuffer") {
            methods.push(instruction.constructorMethod!);
            for (const desc of instruction.methodDescriptions) methods.push(desc.method);
            for (const desc of instruction.staticMethodDescriptions) methods.push(desc.method);
            // method in inner define
        } else if (instruction.kind === "defineFunc") {
            methods.push(instruction.func!);
        }
        return methods;
    }

    private checkNeedHandleLevel(nowMethod: PandaMethod, instruction: PandaInstruction, ignorePop: boolean, nowLevel: number): number {
        if (instruction.kind === "newLexEnv") {
            this.lexicalMap.get(nowMethod)!.recordLevel(instruction.pc, nowLevel);
            nowLevel++;
        } else if (instruction.kind === "storeLex" || instruction.kind === "loadLex") {
            this.lexicalMap.get(nowMethod)!.recordLevel(instruction.pc, nowLevel);
        } else if (instruction.kind === "popLexEnv" && !ignorePop) {
            if (nowLevel === 0) {
                return 0;
            }
            nowLevel--;
        }
        return nowLevel;
    }

    private checkAsyncFunctionResolveContain(block: PandaIRBasicBlock): boolean {
        const isReturn = block.getTerminator().isReturnIns();
        for (const instruction of block.pandaInstructions) {
            if (instruction.kind === "async" && instruction.asyncType === "asyncfunctionresolve" && isReturn) {
                return true;
            }
        }
        return false;
    }

    private checkAddDebugInfo(block: PandaIRBasicBlock, instruction: PandaInstruction): void {
        const type = instruction.typeString!.content;
        const pre = block.getPreInstructionByPc(instruction.pc);
        if (pre && pre.kind === "store") {
            this.addTypeInfo(block.getParent(), pre.destObj!.toString(), type);
        } else if (pre && pre.kind === "loadLex") {
            this.addTypeInfo(block.getParent(), pre.toSignature(), type);
        } else if (pre && pre.kind === "mov") {
            this.addTypeInfo(block.getParent(), pre.destObj!.toString(), type);
        }
    }

    analyze(): void {
        if (this.finished) return;
        const mainMethod = this.pandaClass.pandaMethods.get(ENTRY_FUNCTION_MAIN);
        if (!mainMethod) return;
        this.analyzeWithPandaMethod(mainMethod, 0);
        this.finished = true;
    }

    private analyzeWithPandaMethod(mth: PandaMethod, nowLevel: number): void {
        const pandaIRCFG = mth.disAssemble();
        if (!pandaIRCFG) return;
        this.lexicalMap.set(mth, new PandaLexicalDescription(pandaIRCFG));
        this.typeMap.set(mth, new Map());
        // 异常处理块直接跳过
        const exceptionHandleBlockSet = new Set<PandaIRBasicBlock>();
        const tryBlocks = mth.methodCode?.pandaMethodTryBlocks;
        if (tryBlocks) {
            for (const tryBlock of tryBlocks) {
                for (const catchBlock of tryBlock.pandaMethodCatchBlocks) {
                    const pc = catchBlock.handlerPC;
                    const block = pandaIRCFG.getBasicBlockByPC(pc);
                    if (block) exceptionHandleBlockSet.add(block);
                }
            }
        }

        for (const block of pandaIRCFG.pandaIRBasicBlocks) {
            let ignorePop = false;
            if (exceptionHandleBlockSet.has(block) || this.checkAsyncFunctionResolveContain(block)) ignorePop = true;
            for (const instruction of block.pandaInstructions) {
                if (instruction.kind === "assert") {
                    this.checkAddDebugInfo(block, instruction);
                }
                nowLevel = this.checkNeedHandleLevel(mth, instruction, ignorePop, nowLevel);
                const declaredMethods = this.getInnerDeclaredMethods(instruction);
                for (const method of declaredMethods) {
                    this.analyzeWithPandaMethod(method, nowLevel);
                }
            }
        }
    }

    getLevel(method: PandaMethod, pc: number): number {
        return this.lexicalMap.get(method)!.getLevel(pc);
    }

    getPandaIRCFG(pandaMethod: PandaMethod): PandaIRCFG {
        return this.lexicalMap.get(pandaMethod)!.getPandaIRCFG();
    }

    private addTypeInfo(method: PandaMethod, name: string, type: string): void {
        this.typeMap.get(method)!.set(name, type);
    }

    getTypeInfo(method: PandaMethod, name: string): string | undefined {
        return this.typeMap.get(method)?.get(name);
    }
}

export class PandaLexicalDescription {
    private readonly opCodeLevelMap = new Map<number, number>();
    constructor(private readonly pandaIRCFG: PandaIRCFG) {}

    recordLevel(pc: number, level: number): void {
        this.opCodeLevelMap.set(pc, level);
    }

    getLevel(pc: number): number {
        return this.opCodeLevelMap.get(pc)!;
    }

    getPandaIRCFG(): PandaIRCFG {
        return this.pandaIRCFG;
    }
}
