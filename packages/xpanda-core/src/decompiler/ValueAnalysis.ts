import type { PandaIRBasicBlock } from "../disasm/PandaIRBasicBlock";
import type { PandaIRCFG } from "../disasm/PandaIRCFG";

/**
 * 字节码级的值分析(到达定义)。
 *
 * 现有判定基本都是「按寄存器名字 + 指令形状」猜:
 *   - `comparesHoleWith(block, "v8")` —— 只在同一个块里找 `lda v8; noteq` 的语法形状;
 *   - `catchUsesException` —— 只在 handler 入口块里找 `mov`/`lda`;
 *   - finally 的结束块能不能丢 —— 按角色一刀切,而不是看写还有没有活读者。
 *
 * 寄存器被编译器反复复用(`v6` 既是 hole 哨兵又能是读缓冲),名字级判断区分不了
 * 「第几个版本」。这里按基本块求到达定义,回答「这条指令读的是哪个定义」和
 * 「这个定义还被谁读」,给上面这些判定一个值语义的依据。
 *
 * 只按**普通边**传播:异常落点(handler 入口)没有普通前驱,它的 in 集为空,
 * 表示「值未知」——调用方应把空集当作保守情况处理,不要据此判定「没有读者」。
 * @Author: jmp0
 */
export interface ValueDefinition {
    id: number;
    /** 定义所在基本块 */
    block: PandaIRBasicBlock;
    /** 产生该定义的指令 */
    instruction: any;
    /** 被写的寄存器名(如 `v37` / `acc`) */
    register: string;
}

export interface ValueRead {
    block: PandaIRBasicBlock;
    instruction: any;
    register: string;
    /** 到达该读点的定义 id 集合(空集 = 值来自异常落点等未知路径) */
    definitions: number[];
}

/** 指令写/读的寄存器名(只统计显式寄存器操作数) */
interface InstructionAccess {
    def: string | null;
    uses: string[];
}

function isVReg(value: any): boolean {
    return !!value && typeof value === "object" && typeof value.index === "number";
}

function vregName(value: any): string | null {
    return isVReg(value) ? String(value.toString()) : null;
}

/**
 * 一条指令的显式寄存器读写。
 *
 * `acc` 是隐式累加器:装载类指令的 destObj 就是 `acc`,`lda vX` 的 loadParam 是 `vX`。
 * 这里只收集显式出现的寄存器操作数,`acc` 也当作普通寄存器处理(它在指令模型里
 * 就是 destObj)。
 */
export function instructionAccess(instruction: any): InstructionAccess {
    const def = vregName(instruction.destObj);
    const uses: string[] = [];
    const push = (value: any): void => {
        if (Array.isArray(value)) {
            for (const item of value) push(item);
            return;
        }
        const name = vregName(value);
        if (name !== null && name !== def) uses.push(name);
    };
    push(instruction.srcObj);
    push(instruction.loadParam);
    push(instruction.params);
    push(instruction.callParams);
    push(instruction.paramsVReg);
    push(instruction.objectVReg);
    push(instruction.iteratorReg);
    push(instruction.arr);
    push(instruction.storeKeyObj);
    push(instruction.excludeObj);
    push(instruction.excludeFormObj);
    push(instruction.protoReg);
    push(instruction.getterReg);
    push(instruction.setterReg);
    push(instruction.yieldReg);
    push(instruction.cotr);
    return { def, uses };
}

export class ValueAnalysis {
    private readonly definitions: ValueDefinition[] = [];
    private readonly definitionByInstruction = new Map<any, ValueDefinition>();
    private readonly reachingIn = new Map<PandaIRBasicBlock, Map<string, Set<number>>>();
    private readonly reachingOut = new Map<PandaIRBasicBlock, Map<string, Set<number>>>();

    constructor(private readonly cfg: PandaIRCFG) {
        this.collectDefinitions();
        this.solve();
    }

    private collectDefinitions(): void {
        for (const block of this.cfg.pandaIRBasicBlocks) {
            for (const instruction of block.pandaInstructions) {
                const { def } = instructionAccess(instruction);
                if (def === null) continue;
                const definition: ValueDefinition = {
                    id: this.definitions.length,
                    block,
                    instruction,
                    register: def,
                };
                this.definitions.push(definition);
                this.definitionByInstruction.set(instruction, definition);
            }
        }
    }

    private solve(): void {
        const blocks = this.cfg.pandaIRBasicBlocks;
        const entry = blocks[0];
        for (const block of blocks) {
            this.reachingIn.set(block, new Map());
            this.reachingOut.set(block, new Map());
        }
        let changed = true;
        for (let round = 0; changed && round < 64; round++) {
            changed = false;
            for (const block of blocks) {
                const incoming = new Map<string, Set<number>>();
                if (block !== entry) {
                    for (const predecessor of this.cfg.graph.normalPredecessors(block)) {
                        for (const [register, ids] of this.reachingOut.get(predecessor) ?? []) {
                            const target = incoming.get(register) ?? new Set<number>();
                            for (const id of ids) target.add(id);
                            incoming.set(register, target);
                        }
                    }
                }
                this.reachingIn.set(block, incoming);
                const outgoing = new Map<string, Set<number>>();
                for (const [register, ids] of incoming) outgoing.set(register, new Set(ids));
                for (const instruction of block.pandaInstructions) {
                    const { def } = instructionAccess(instruction);
                    if (def === null) continue;
                    const definition = this.definitionByInstruction.get(instruction);
                    if (!definition) continue;
                    outgoing.set(def, new Set([definition.id]));
                }
                if (!sameEnvironment(outgoing, this.reachingOut.get(block)!)) {
                    this.reachingOut.set(block, outgoing);
                    changed = true;
                }
            }
        }
    }

    /** 指令写出的定义(不是定义指令时返回 null) */
    definitionOf(instruction: any): ValueDefinition | null {
        return this.definitionByInstruction.get(instruction) ?? null;
    }

    /** 某条指令读取 `register` 时,到达的定义集合(按块内顺序重放到该指令) */
    definitionsAtRead(block: PandaIRBasicBlock, instruction: any, register: string): number[] {
        const state = new Map<string, Set<number>>();
        for (const [name, ids] of this.reachingIn.get(block) ?? []) state.set(name, new Set(ids));
        for (const current of block.pandaInstructions) {
            if (current === instruction) break;
            const { def } = instructionAccess(current);
            if (def === null) continue;
            const definition = this.definitionByInstruction.get(current);
            if (definition) state.set(def, new Set([definition.id]));
        }
        return Array.from(state.get(register) ?? []);
    }

    /**
     * 读这个定义的指令(按方法内顺序)。
     *
     * 只返回**值确实来自该定义**的读点;异常落点里值未知的读点不会命中
     * (in 集为空),调用方需要保守处理时别把它当「没有读者」。
     */
    readersOf(definition: ValueDefinition): ValueRead[] {
        const readers: ValueRead[] = [];
        for (const block of this.cfg.pandaIRBasicBlocks) {
            for (const instruction of block.pandaInstructions) {
                const { uses } = instructionAccess(instruction);
                if (!uses.includes(definition.register)) continue;
                const definitions = this.definitionsAtRead(block, instruction, definition.register);
                if (!definitions.includes(definition.id)) continue;
                readers.push({ block, instruction, register: definition.register, definitions });
            }
        }
        return readers;
    }

    /** 该定义是否在给定 pc 集合之外被读过(空集读点不算,见类注释) */
    isReadOutside(definition: ValueDefinition, pcs: Iterable<number>): boolean {
        const allowed = new Set<number>(pcs);
        return this.readersOf(definition).some((read) => !allowed.has(read.instruction.pc));
    }
}

function sameEnvironment(
    left: Map<string, Set<number>>,
    right: Map<string, Set<number>>,
): boolean {
    if (left.size !== right.size) return false;
    for (const [register, ids] of left) {
        const other = right.get(register);
        if (!other || other.size !== ids.size) return false;
        for (const id of ids) if (!other.has(id)) return false;
    }
    return true;
}
