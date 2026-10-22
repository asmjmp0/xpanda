import { PandaDisAssembler } from "./PandaDisAssembler";
import type { PandaIRCFG } from "./PandaIRCFG";
import type { PandaInstruction } from "./PandaInstruction";
import { PandaIRBasicBlock } from "./PandaIRBasicBlock";
import { ENTRY_FUNCTION_MAIN } from "../file/PandaFile";
import { PandaMethod } from "../file/method/PandaMethod";
import type { PandaClass } from "../file/clazz/PandaClass";

/**
 * 词法环境/类型分析(移植自 Java jmp0.abc.disasm.lexical.PandaLexical)
 * 记录每个方法的词法层级与虚寄存器类型,并惰性反汇编所有内嵌方法
 * 单方法反汇编失败(如 jeq 家族未实现)时跳过该方法,不中断整个类的分析
 * @Author: jmp0
 */
export class PandaLexical {
    private finished = false;
    private readonly lexicalMap = new Map<PandaMethod, PandaLexicalDescription>();
    private readonly typeMap = new Map<PandaMethod, Map<string, string>>();
    /** 已分析过的方法(同一方法只分析一次,锁定首次引用处的词法层级) */
    private readonly visited = new Set<PandaMethod>();

    constructor(private readonly pandaClass: PandaClass) {
        this.analyze();
    }

    private getInnerDeclaredMethods(instruction: PandaInstruction): PandaMethod[] {
        const methods: PandaMethod[] = [];
        const pushIfMethod = (value: any): void => {
            if (value instanceof PandaMethod) methods.push(value);
        };
        // method in object
        if (instruction.kind === "createObject") {
            for (const value of instruction.objMap.values()) pushIfMethod(value);
            // method in class
        } else if (instruction.kind === "defineClassWithBuffer") {
            pushIfMethod(instruction.constructorMethod);
            for (const desc of instruction.methodDescriptions) pushIfMethod(desc.method);
            for (const desc of instruction.staticMethodDescriptions) pushIfMethod(desc.method);
            // method in inner define
        } else if (instruction.kind === "defineFunc") {
            pushIfMethod(instruction.func);
        }
        return methods;
    }

    private checkNeedHandleLevel(nowMethod: PandaMethod, instruction: PandaInstruction, ignorePop: boolean, nowLevel: number, startLevel: number): number {
        if (instruction.kind === "newLexEnv") {
            this.lexicalMap.get(nowMethod)!.recordLevel(instruction.pc, nowLevel);
            nowLevel++;
        } else if (instruction.kind === "storeLex" || instruction.kind === "loadLex") {
            this.lexicalMap.get(nowMethod)!.recordLevel(instruction.pc, nowLevel);
        } else if (instruction.kind === "popLexEnv" && !ignorePop) {
            // 不能低于方法入口层级(闭包方法入口时已经带着外层词法环境)
            if (nowLevel <= startLevel) {
                return startLevel;
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

    /** 取 pc 的前一条指令;pc 为块首时沿 pc 序回退到前一个块的末条指令(TDZ 检查常被块边界切开) */
    private getPreInstruction(pandaIRCFG: PandaIRCFG, block: PandaIRBasicBlock, pc: number): PandaInstruction | null {
        const pre = block.getPreInstructionByPc(pc);
        if (pre) return pre;
        const idx = pandaIRCFG.getBlockIndexPC(block.getStartPC());
        if (idx === null || idx === 0) return null;
        return pandaIRCFG.pandaIRBasicBlocks[idx - 1].getTerminator();
    }

    private checkAddDebugInfo(pandaIRCFG: PandaIRCFG, block: PandaIRBasicBlock, instruction: PandaInstruction): void {
        const type = instruction.typeString!.content;
        const pre = this.getPreInstruction(pandaIRCFG, block, instruction.pc);
        if (pre && pre.kind === "store") {
            this.addTypeInfo(block.getParent(), pre.destObj!.toString(), type);
        } else if (pre && pre.kind === "loadLex") {
            this.addTypeInfo(block.getParent(), pre.toSignature(this.getLevel(block.getParent(), pre.pc)), type);
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
        // 同一方法只分析一次,避免重复引用时以不同层级覆盖首次分析结果
        if (this.visited.has(mth)) return;
        this.visited.add(mth);
        // 单方法反汇编失败(如 jeq/jne/jstricteq/jnstricteq 未实现)时跳过该方法,不中断整个类的分析
        let pandaIRCFG: PandaIRCFG | null;
        try {
            pandaIRCFG = mth.disAssemble();
        } catch (_e) {
            return;
        }
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

        // 方法入口层级:闭包方法从定义处的词法层级开始
        const startLevel = nowLevel;

        for (const block of pandaIRCFG.pandaIRBasicBlocks) {
            let ignorePop = false;
            if (exceptionHandleBlockSet.has(block) || this.checkAsyncFunctionResolveContain(block)) ignorePop = true;
            for (const instruction of block.pandaInstructions) {
                if (instruction.kind === "assert") {
                    this.checkAddDebugInfo(pandaIRCFG, block, instruction);
                }
                nowLevel = this.checkNeedHandleLevel(mth, instruction, ignorePop, nowLevel, startLevel);
                const declaredMethods = this.getInnerDeclaredMethods(instruction);
                for (const method of declaredMethods) {
                    this.analyzeWithPandaMethod(method, nowLevel);
                }
            }
        }
    }

    getLevel(method: PandaMethod, pc: number): number {
        // 层级缺失时回退到最外层,避免 NaN 污染变量命名
        return this.lexicalMap.get(method)?.getLevel(pc) ?? 0;
    }

    has(pandaMethod: PandaMethod): boolean {
        return this.lexicalMap.has(pandaMethod);
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
        return this.opCodeLevelMap.get(pc) ?? 0;
    }

    getPandaIRCFG(): PandaIRCFG {
        return this.pandaIRCFG;
    }
}
