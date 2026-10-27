import { PandaParseException } from "../PandaParseException";
import type { PandaIRBasicBlock } from "../disasm/PandaIRBasicBlock";
import type { PandaLexical } from "../disasm/PandaLexical";
import type { PandaDecompilerMethodHandler } from "./MethodHandler";
import { LabelStatement, LinearPandaStatement, LogicalExpressionStatement } from "./statements";
import type { IPandaDecompileAble } from "./statements";

/**
 * Region(移植自 Java jmp0.abc.decompiler.structure.Region)
 * @Author: jmp0
 */
export type RegionType = "Linear" | "Condition" | "Tail";

/**
 * 结构化 try 的显式描述。
 *
 * 旧实现用一个"假的 Condition 区域"冒充 try:false 边当 try 体、true 边当 handler,
 * 再用可变的 `tryCatchHelperRegion` 布尔标志传播语义。这里改成真正的 Try 区域:
 *   - 正常边(false)→ try 体
 *   - 异常边("exception")→ handler
 * 异常边是控制流图的第三边,不参与条件极性,但参与可达性/支配/死代码判定。
 */
export class TryRegion {
    /**
     * try 体与 handler 不在这里保存:**边上才是唯一事实来源**
     * (正常边 → try 体、异常边 → handler)。多个 try 表条目共用起点时,
     * 后接的 Try 区域会改接前者的正常边,描述符里的引用会过期。
     */
    constructor(
        /** try 表保护范围结束 pc(不含),AST 上用于判断 catch 与 finally 的嵌套关系 */
        readonly catchEndPC: number | null,
        /** 该 handler 的语义:真 catch,还是 24+ 内联 finally 的异常路径 */
        readonly kind: "catch" | "finallyEpilogue",
    ) {}
}

export class Region implements IPandaDecompileAble {
    block: PandaIRBasicBlock | null;
    type: RegionType;
    private _statements: IPandaDecompileAble[];
    name: string;
    conditionalExp = false;
    exceptionLandingPad = false;
    logicalRegion = false;
    /**
     * 非 null 时该区域是一个 Try 区域。类型仍为 "Condition":归约器里所有
     * "条件区域"的图算法(循环/词法节点/尾块合并)必须与旧的 helper 完全一致,
     * try 语义由该描述符单独分发。
     */
    tryRegion: TryRegion | null = null;
    /**
     * 该区域是某个 try 的入口时,保护范围的结束 pc(不含)。
     * reduceSequence 不能把这个位置之后的语句并进 try 体。
     */
    tryBodyEndPC: number | null = null;

    constructor(block: PandaIRBasicBlock | null, type: RegionType) {
        this.block = block;
        this.type = type;
        this._statements = [];
        this.name = block ? block.name : "";
        if (block) this._statements.push(new LinearPandaStatement(block));
        if (block) this.name = block.name;
        if (this.type === "Condition" && block) {
            const jump = block.getTerminator();
            if (jump.kind === "jumpNotEqual") {
                this.conditionalExp = false;
            } else if (jump.kind === "jumpEqual") {
                this.conditionalExp = true;
            } else {
                throw new PandaParseException("generateTestExpression");
            }
        }
    }

    getStatements(): IPandaDecompileAble[] {
        return this._statements;
    }

    addRegion(region: Region): void {
        this._statements.push(...region.getStatements());
    }

    addStatement(statement: IPandaDecompileAble): void {
        this._statements.push(statement);
    }

    addFirstStatement(statement: IPandaDecompileAble): void {
        this._statements.unshift(statement);
    }

    clearStatements(): void {
        this._statements = [];
    }

    decompile(methodHandler: PandaDecompilerMethodHandler, pandaLexical: PandaLexical, astNode: any): void {
        for (const statement of this._statements) {
            statement.decompile(methodHandler, pandaLexical, astNode);
        }
    }

    copy(): Region {
        const copyOne = new Region(this.block, this.type);
        copyOne.clearStatements();
        copyOne.addRegion(this);
        // copy() 用于 fixIrreducibleByTailRegion 复制共享的 Tail 区域;
        // 条件/逻辑区域标志必须一起复制,否则副本会退化成只读 acc。
        copyOne.conditionalExp = this.conditionalExp;
        copyOne.logicalRegion = this.logicalRegion;
        copyOne.exceptionLandingPad = this.exceptionLandingPad;
        copyOne.tryRegion = this.tryRegion;
        copyOne.tryBodyEndPC = this.tryBodyEndPC;
        return copyOne;
    }

    setType(type: RegionType): void {
        this.type = type;
    }

    expInvert(): void {
        this.conditionalExp = !this.conditionalExp;
    }

    isLogicalRegion(): boolean { return this.logicalRegion; }
    isConditionalExp(): boolean { return this.conditionalExp; }
    isTryRegion(): boolean { return this.tryRegion !== null; }
    isExceptionLandingPad(): boolean { return this.exceptionLandingPad; }
    setExceptionLandingPadFlag(): void { this.exceptionLandingPad = true; }

    getName(): string { return this.name; }
    setName(name: string): void { this.name = name; }
    getType(): RegionType { return this.type; }

    toString(): string {
        return this.name;
    }
}
