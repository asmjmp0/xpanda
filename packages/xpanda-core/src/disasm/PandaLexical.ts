import { PandaDisAssembler } from "./PandaDisAssembler";
import type { PandaIRCFG } from "./PandaIRCFG";
import type { PandaInstruction } from "./PandaInstruction";
import { PandaIRBasicBlock } from "./PandaIRBasicBlock";
import { ENTRY_FUNCTION_MAIN } from "../file/PandaFile";
import { PandaMethod } from "../file/method/PandaMethod";
import type { PandaClass } from "../file/clazz/PandaClass";

/**
 * 词法环境实例:name 是变量前缀(如 `local_1` / `local_1_2` / `sendable_0`),占位变量名为 `name + "_" + index`。
 * kind 区分两条运行时独立的链:regular lexenv(newLexEnv/popLexEnv/ld·stlexvar)与
 * sendable env(newsendableenv/ld·stsendablevar)。ldsendablevar/stsendablevar 的
 * level 相对 sendable 链,不能和 regular 链混在一个栈里解析(否则 stlexvar 会落到
 * sendable 环境上,两个类共用同一个槽名)。
 */
interface LexEnvInfo {
    name: string;
    kind: "lexical" | "sendable";
}

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

    private checkAsyncFunctionResolveContain(block: PandaIRBasicBlock): boolean {
        const isReturn = block.getTerminator().isReturnIns();
        for (const instruction of block.pandaInstructions) {
            if (instruction.kind === "async" && instruction.asyncType === "asyncfunctionresolve" && isReturn) {
                return true;
            }
        }
        return false;
    }

    /**
     * 词法环境实例。名字是编译器预留的 `local_<depth>` / `sendable_<depth>`;
     * 同一层级的多个环境(例如连续定义的多个 class 各自的 self-reference 环境)
     * 追加序号 `_2` / `_3` 区分,否则同名的 `let local_1_0` 会在嵌套作用域里互相
     * 遮蔽,引用被绑定到错误的环境(甚至让外层声明看起来"未使用"而被删掉)。
     * depth 是链内深度(regular lexenv 与 sendable env 各自计数)。
     */
    private makeEnvName(instruction: PandaInstruction, depth: number, counters: Map<string, number>): string {
        const kind = instruction.isSendAble ? "sendable" : "local";
        const key = kind + "_" + depth;
        const count = counters.get(key) ?? 0;
        counters.set(key, count + 1);
        return kind + "_" + depth + (count === 0 ? "" : "_" + (count + 1));
    }

    /** 按指令推进词法环境栈,并把 newLexEnv / loadLex / storeLex 的变量前缀记录到描述里 */
    private advanceEnvStack(
        instruction: PandaInstruction,
        ignorePop: boolean,
        stack: LexEnvInfo[],
        startLevel: number,
        desc: PandaLexicalDescription,
        counters: Map<string, number>,
    ): void {
        if (instruction.kind === "newLexEnv") {
            const kind: LexEnvInfo["kind"] = instruction.isSendAble ? "sendable" : "lexical";
            // 链内深度:两条链各自从 0 开始,与应用侧看到的运行时 level 语义一致
            const depth = stack.filter((env) => env.kind === kind).length;
            desc.recordLevel(instruction.pc, stack.length);
            let name = desc.getName(instruction.pc);
            if (name === undefined) {
                name = this.makeEnvName(instruction, depth, counters);
                desc.recordName(instruction.pc, name);
            }
            stack.push({ name, kind });
            return;
        }
        if (instruction.kind === "popLexEnv" && !ignorePop) {
            // popLexEnv 只退 regular lexenv 链,不触碰 sendable env;
            // 不能低于方法入口层级(闭包方法入口时已经带着外层词法环境)
            const lexicalCount = stack.filter((env) => env.kind === "lexical").length;
            if (lexicalCount > startLevel) {
                let last = -1;
                for (let i = stack.length - 1; i >= 0; i--) {
                    if (stack[i].kind === "lexical") { last = i; break; }
                }
                if (last >= 0) stack.splice(last, 1);
            }
            return;
        }
        if (instruction.kind === "storeLex" || instruction.kind === "loadLex") {
            desc.recordLevel(instruction.pc, stack.length);
            // `lexLevel` 是相对当前环境的层数:0 = 当前环境,1 = 外层……
            // 只在同一条链上解析 sendable 与 regular 的 level 互不相干
            const chain: LexEnvInfo["kind"] = instruction.isSendAble ? "sendable" : "lexical";
            const entries = stack.filter((env) => env.kind === chain);
            const target = entries.length - instruction.lexLevel - 1;
            const env = target >= 0 ? entries[target] : undefined;
            if (env && desc.getName(instruction.pc) === undefined) {
                desc.recordName(instruction.pc, env.name);
            }
        }
    }

    /** 模拟一个基本块从入口到出口的环境栈变化(返回出口栈,不修改入参) */
    private simulateBlockStack(
        block: PandaIRBasicBlock,
        stack: LexEnvInfo[],
        startLevel: number,
        desc: PandaLexicalDescription,
        counters: Map<string, number>,
    ): LexEnvInfo[] {
        const cur = stack.slice();
        const ignorePop = this.checkAsyncFunctionResolveContain(block);
        for (const instruction of block.pandaInstructions) {
            this.advanceEnvStack(instruction, ignorePop, cur, startLevel, desc, counters);
        }
        return cur;
    }

    /** 基本块内执行到 pc(含该指令带来的环境变化)时的环境栈 */
    private stackAfterPC(
        block: PandaIRBasicBlock,
        stack: LexEnvInfo[],
        pc: number,
        startLevel: number,
        desc: PandaLexicalDescription,
        counters: Map<string, number>,
    ): LexEnvInfo[] {
        const cur = stack.slice();
        const ignorePop = this.checkAsyncFunctionResolveContain(block);
        for (const instruction of block.pandaInstructions) {
            if (instruction.pc > pc) break;
            this.advanceEnvStack(instruction, ignorePop, cur, startLevel, desc, counters);
        }
        return cur;
    }

    /**
     * 计算每个基本块入口的词法环境栈。
     *
     * 线性 pc 顺序会算错“循环体里既有 popLexEnv 又有跳过它的分支”的情况:
     * popLexEnv 在 pc 序里先出现,同一作用域里排在它后面的分支就被当成已经退出
     * 作用域,ldlexvar 被命名成 `local_-1_x`(未声明变量)。
     *
     * 这里从入口块按 CFG 边传播环境栈;异常边不在 CFG 里,handler 用 try 起点处的
     * 环境栈播种。handler 内部还可能定义嵌套 try(其起点同样不可达),所以播种与
     * 传播交替进行直到没有新的 handler 可播种。
     * 多前驱时取先到者(与可归约代码一致)。
     */
    private computeEnvStacks(
        pandaIRCFG: PandaIRCFG,
        inheritedStack: LexEnvInfo[],
        desc: PandaLexicalDescription,
        counters: Map<string, number>,
    ): Map<PandaIRBasicBlock, LexEnvInfo[]> {
        const stacks = new Map<PandaIRBasicBlock, LexEnvInfo[]>();
        const queue: PandaIRBasicBlock[] = [];
        const enqueue = (block: PandaIRBasicBlock, stack: LexEnvInfo[]): void => {
            if (stacks.has(block)) return;
            stacks.set(block, stack.slice());
            queue.push(block);
        };
        enqueue(pandaIRCFG.getEntryBlock(), inheritedStack);

        const startLevel = inheritedStack.filter((env) => env.kind === "lexical").length;
        const tryBlocks = pandaIRCFG.getPandaMethod().methodCode?.pandaMethodTryBlocks ?? [];
        const seededHandlers = new Set<PandaIRBasicBlock>();
        let progress = true;
        while (progress) {
            progress = false;
            let head = 0;
            while (head < queue.length) {
                const block = queue[head++];
                const outStack = this.simulateBlockStack(block, stacks.get(block)!, startLevel, desc, counters);
                for (const successor of pandaIRCFG.graph.normalSuccessors(block)) {
                    enqueue(successor, outStack);
                }
            }
            queue.length = 0;
            for (const tryBlock of tryBlocks) {
                const startBlock = pandaIRCFG.getBasicBlockByPC(tryBlock.startPC);
                const entryStack = startBlock ? stacks.get(startBlock) : undefined;
                if (!startBlock || !entryStack) continue;
                // try 起点与块首之间有 newLexEnv/popLexEnv 时,handler 以 try 体内的
                // 实际环境进入(如方法入口块 pc0 的 newlexenvwithname)。
                const seed = this.stackAfterPC(startBlock, entryStack, tryBlock.startPC, startLevel, desc, counters);
                for (const catchBlock of tryBlock.pandaMethodCatchBlocks) {
                    const handler = pandaIRCFG.getBasicBlockByPC(catchBlock.handlerPC);
                    if (!handler || seededHandlers.has(handler)) continue;
                    seededHandlers.add(handler);
                    enqueue(handler, seed);
                    progress = true;
                }
            }
        }
        return stacks;
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
            const prefix = this.lexicalMap.get(block.getParent())?.getName(pre.pc);
            const name = prefix !== undefined
                ? prefix + "_" + pre.lexIndex
                : pre.toSignature(this.getLevel(block.getParent(), pre.pc));
            this.addTypeInfo(block.getParent(), name, type);
        } else if (pre && pre.kind === "mov") {
            this.addTypeInfo(block.getParent(), pre.destObj!.toString(), type);
        }
    }

    analyze(): void {
        if (this.finished) return;
        const mainMethod = this.pandaClass.pandaMethods.get(ENTRY_FUNCTION_MAIN);
        if (!mainMethod) return;
        this.analyzeWithPandaMethod(mainMethod, []);
        this.finished = true;
    }

    private analyzeWithPandaMethod(mth: PandaMethod, inheritedStack: LexEnvInfo[]): void {
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
        const desc = new PandaLexicalDescription(pandaIRCFG);
        this.lexicalMap.set(mth, desc);
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

        // 方法入口环境:闭包方法从定义处的词法环境开始
        const startLevel = inheritedStack.filter((env) => env.kind === "lexical").length;
        // 同一层级的多个环境需要不同的变量名(见 makeEnvName)
        const counters = new Map<string, number>();
        // 按 CFG(含 try 表的异常边)预计算每个基本块的入口环境栈:
        // 线性 pc 顺序在 popLexEnv 之后的分支上会算错。
        const blockStacks = this.computeEnvStacks(pandaIRCFG, inheritedStack, desc, counters);

        let curStack = inheritedStack.slice();
        for (const block of pandaIRCFG.pandaIRBasicBlocks) {
            let ignorePop = false;
            if (exceptionHandleBlockSet.has(block) || this.checkAsyncFunctionResolveContain(block)) ignorePop = true;
            const seededStack = blockStacks.get(block);
            if (seededStack !== undefined) curStack = seededStack.slice();
            for (const instruction of block.pandaInstructions) {
                if (instruction.kind === "assert") {
                    this.checkAddDebugInfo(pandaIRCFG, block, instruction);
                }
                this.advanceEnvStack(instruction, ignorePop, curStack, startLevel, desc, counters);
                const declaredMethods = this.getInnerDeclaredMethods(instruction);
                for (const method of declaredMethods) {
                    this.analyzeWithPandaMethod(method, curStack);
                }
            }
        }
    }

    getLevel(method: PandaMethod, pc: number): number {
        // 层级缺失时回退到最外层,避免 NaN 污染变量命名
        return this.lexicalMap.get(method)?.getLevel(pc) ?? 0;
    }

    /** loadLex / storeLex / newLexEnv 所在词法环境的变量前缀;缺失时返回 undefined */
    getLexPrefix(method: PandaMethod, pc: number): string | undefined {
        return this.lexicalMap.get(method)?.getName(pc);
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
    private readonly opCodeNameMap = new Map<number, string>();
    constructor(private readonly pandaIRCFG: PandaIRCFG) {}

    recordLevel(pc: number, level: number): void {
        this.opCodeLevelMap.set(pc, level);
    }

    getLevel(pc: number): number {
        return this.opCodeLevelMap.get(pc) ?? 0;
    }

    /** 记录 pc 处词法环境的变量前缀(newLexEnv 记录新环境,load/storeLex 记录目标环境) */
    recordName(pc: number, name: string): void {
        this.opCodeNameMap.set(pc, name);
    }

    getName(pc: number): string | undefined {
        return this.opCodeNameMap.get(pc);
    }

    getPandaIRCFG(): PandaIRCFG {
        return this.pandaIRCFG;
    }
}
