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

export class Region implements IPandaDecompileAble {
    block: PandaIRBasicBlock | null;
    type: RegionType;
    private _statements: IPandaDecompileAble[];
    name: string;
    conditionalExp = false;
    exceptionLandingPad = false;
    tryCatchHelperRegion = false;
    logicalRegion = false;

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

    /** helper region 构造(Java Region(name, type)) */
    static helper(name: string): Region {
        const r = new Region(null, "Condition");
        r.name = name;
        r.tryCatchHelperRegion = true;
        return r;
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
        copyOne.tryCatchHelperRegion = this.tryCatchHelperRegion;
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
    isTryCatchHelperRegion(): boolean { return this.tryCatchHelperRegion; }
    isExceptionLandingPad(): boolean { return this.exceptionLandingPad; }
    setExceptionLandingPadFlag(): void { this.exceptionLandingPad = true; }

    getName(): string { return this.name; }
    setName(name: string): void { this.name = name; }
    getType(): RegionType { return this.type; }

    toString(): string {
        return this.name;
    }
}

export class TryCatchHelperRegion extends Region {
    constructor(tryEntryRegion: Region, handleEntryRegion: Region) {
        super(null, "Condition");
        this.name = "tryCatchHelper_" + tryEntryRegion + "_" + handleEntryRegion;
        this.tryCatchHelperRegion = true;
    }
}
