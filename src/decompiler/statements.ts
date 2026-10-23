import type { PandaIRBasicBlock } from "../disasm/PandaIRBasicBlock";
import type { PandaLexical } from "../disasm/PandaLexical";
import type { CodeGenerator } from "../codegen/CodeGenerator";
import type { PandaDecompilerMethodHandler } from "./MethodHandler";
import type { Region } from "./Region";

/**
 * 语句树(移植自 Java jmp0.abc.decompiler.structure.statement 包)
 * @Author: jmp0
 */
export interface IPandaDecompileAble {
    decompile(methodHandler: PandaDecompilerMethodHandler, pandaLexical: PandaLexical, astNode: any): void;
}

export class LinearPandaStatement implements IPandaDecompileAble {
    constructor(readonly block: PandaIRBasicBlock) {}

    decompile(methodHandler: PandaDecompilerMethodHandler, pandaLexical: PandaLexical, astNode: any): void {
        methodHandler.handleBlock(this.block, pandaLexical, astNode);
    }
}

export abstract class JumpStatement implements IPandaDecompileAble {
    protected exp: boolean;
    protected logicalExpressionStatement: LogicalExpressionStatement | null = null;

    constructor(conditionalRegion: Region | null) {
        // 注:Java 版对 null 区域直接 NPE 导致整个方法降级,这里做安全处理
        if (conditionalRegion && conditionalRegion.isLogicalRegion()) {
            const sts = conditionalRegion.getStatements();
            const last = sts[sts.length - 1];
            if (last instanceof LogicalExpressionStatement) {
                this.logicalExpressionStatement = last;
            } else {
                this.logicalExpressionStatement = sts[0] as LogicalExpressionStatement;
            }
        }
        this.exp = conditionalRegion ? conditionalRegion.isConditionalExp() : false;
    }

    protected isLogicalExpressionStatement(): boolean {
        return this.logicalExpressionStatement !== null;
    }

    protected generateTestExpression(methodHandler: PandaDecompilerMethodHandler, pandaLexical: PandaLexical): any {
        if (this.logicalExpressionStatement) {
            return this.logicalExpressionStatement.generateTestExpressionInternal(methodHandler, pandaLexical);
        }
        return this.generateTestExpressionByExp(methodHandler, this.exp);
    }

    protected generateTestExpressionByExp(methodHandler: PandaDecompilerMethodHandler, exp: boolean): any {
        const factory = methodHandler.getCodeGenerator().getNodeFactory();
        if (!exp) return factory.unaryExpressionNode("!", factory.identifierNode("acc") as any);
        return factory.identifierNode("acc");
    }

    decompile(methodHandler: PandaDecompilerMethodHandler, pandaLexical: PandaLexical, astNode: any): void {
        throw new Error("abstract");
    }
}

export class IfPandaStatement extends JumpStatement {
    private tryCatchPandaStatement: TryCatchPandaStatement | null = null;
    private consequent: IPandaDecompileAble | null;
    private alternate: IPandaDecompileAble | null;

    constructor(private readonly test: Region, consequent: IPandaDecompileAble | null, alternate: IPandaDecompileAble | null) {
        super(test);
        if (test.isTryCatchHelperRegion()) {
            this.tryCatchPandaStatement = new TryCatchPandaStatement(consequent, alternate);
            this.consequent = null;
            this.alternate = null;
            return;
        }
        this.consequent = consequent;
        this.alternate = alternate;
    }

    decompile(methodHandler: PandaDecompilerMethodHandler, pandaLexical: PandaLexical, astNode: any): void {
        if (this.tryCatchPandaStatement) {
            this.tryCatchPandaStatement.decompile(methodHandler, pandaLexical, astNode);
            return;
        }
        const codeGenerator = methodHandler.getCodeGenerator();
        const factory = codeGenerator.getNodeFactory();
        let exp = this.generateTestExpression(methodHandler, pandaLexical);
        if (this.consequent === null) {
            exp = factory.unaryExpressionNode("!", exp as any);
            const alertBlock = factory.blockStatementNode();
            this.alternate!.decompile(methodHandler, pandaLexical, alertBlock);
            codeGenerator.getNodeUtils().insertNodeToBody(factory.ifStatementNode(exp as any, alertBlock, null) as any, astNode);
        } else if (this.alternate === null) {
            const consequentBlock = factory.blockStatementNode();
            this.consequent.decompile(methodHandler, pandaLexical, consequentBlock);
            codeGenerator.getNodeUtils().insertNodeToBody(factory.ifStatementNode(exp as any, consequentBlock, null) as any, astNode);
        } else {
            const consequentBlock = factory.blockStatementNode();
            this.consequent.decompile(methodHandler, pandaLexical, consequentBlock);
            const alertBlock = factory.blockStatementNode();
            this.alternate.decompile(methodHandler, pandaLexical, alertBlock);
            codeGenerator.getNodeUtils().insertNodeToBody(factory.ifStatementNode(exp as any, consequentBlock, alertBlock) as any, astNode);
        }
    }
}

export class WhileStatement extends JumpStatement {
    private headStms: IPandaDecompileAble[] | null;
    private bodyStms: IPandaDecompileAble[];

    constructor(region: Region | null, body: Region) {
        super(region);
        this.bodyStms = body.getStatements().slice();
        if (region === null) {
            this.headStms = null;
            return;
        }
        this.headStms = region.getStatements().slice();
    }

    decompile(methodHandler: PandaDecompilerMethodHandler, pandaLexical: PandaLexical, astNode: any): void {
        const codeGenerator = methodHandler.getCodeGenerator();
        const factory = codeGenerator.getNodeFactory();
        const block = factory.blockStatementNode();
        if (this.headStms !== null) {
            for (const headStm of this.headStms) {
                headStm.decompile(methodHandler, pandaLexical, block);
            }
            let testNode = this.generateTestExpression(methodHandler, pandaLexical);
            if (this.isLogicalExpressionStatement()) {
                testNode = factory.unaryExpressionNode("!", testNode as any);
            }
            const jumpOutBlock = factory.ifStatementNode(testNode as any, factory.breakStatement(), null);
            codeGenerator.getNodeUtils().insertNodeToBody(jumpOutBlock as any, block);
        }
        for (const bodyStm of this.bodyStms) {
            bodyStm.decompile(methodHandler, pandaLexical, block);
        }
        const trueNode = factory.booleanLiteralNode(true);
        const doWhileNode = factory.whileStatementNode(trueNode, block);
        codeGenerator.getNodeUtils().insertNodeToBody(doWhileNode as any, astNode);
    }
}

export class DoWhileStatement extends JumpStatement {
    private bodyStms: IPandaDecompileAble[];

    constructor(body: Region) {
        super(body);
        this.bodyStms = body.getStatements().slice();
    }

    decompile(methodHandler: PandaDecompilerMethodHandler, pandaLexical: PandaLexical, astNode: any): void {
        const codeGenerator = methodHandler.getCodeGenerator();
        const factory = codeGenerator.getNodeFactory();
        const block = factory.blockStatementNode();
        for (const bodyStm of this.bodyStms) {
            bodyStm.decompile(methodHandler, pandaLexical, block);
        }
        const testNode = factory.unaryExpressionNode("!", this.generateTestExpression(methodHandler, pandaLexical) as any);
        const doWhileNode = factory.doWhileStatementNode(testNode as any, block);
        codeGenerator.getNodeUtils().insertNodeToBody(doWhileNode as any, astNode);
    }
}

export class BreakStatement implements IPandaDecompileAble {
    constructor(private readonly comment: string | null) {}

    decompile(methodHandler: PandaDecompilerMethodHandler, _pandaLexical: PandaLexical, astNode: any): void {
        const codeGenerator = methodHandler.getCodeGenerator();
        const breakStatement = codeGenerator.getNodeFactory().breakStatement();
        if (this.comment) {
            codeGenerator.getNodeFactory().addTrailingComment(breakStatement as any, this.comment);
        }
        codeGenerator.getNodeUtils().insertNodeToBody(breakStatement as any, astNode);
    }
}

export class ContinueStatement implements IPandaDecompileAble {
    constructor(private readonly comment: string | null) {}

    decompile(methodHandler: PandaDecompilerMethodHandler, _pandaLexical: PandaLexical, astNode: any): void {
        const codeGenerator = methodHandler.getCodeGenerator();
        const continueStatement = codeGenerator.getNodeFactory().continueStatement();
        if (this.comment) {
            codeGenerator.getNodeFactory().addTrailingComment(continueStatement as any, this.comment);
        }
        codeGenerator.getNodeUtils().insertNodeToBody(continueStatement as any, astNode);
    }
}

export class GotoStatement implements IPandaDecompileAble {
    constructor(private readonly dest: Region) {}

    decompile(methodHandler: PandaDecompilerMethodHandler, _pandaLexical: PandaLexical, astNode: any): void {
        const name = this.dest.getName();
        const codeGenerator = methodHandler.getCodeGenerator();
        const factory = codeGenerator.getNodeFactory();
        if (!codeGenerator.getNodeUtils().tryFixGoto(astNode, name)) {
            const identifierNode = factory.identifierNode("xpanda_goto");
            const arrayObject = codeGenerator.arrayObject();
            codeGenerator.addToArray(arrayObject, factory.identifierNode(name));
            const callExpressionNode = factory.callExpressionNode(identifierNode as any, arrayObject as any);
            codeGenerator.getNodeUtils().insertNodeToBody(factory.expressionStatementNode(callExpressionNode as any) as any, astNode);
        }
    }
}

export class LabelStatement implements IPandaDecompileAble {
    constructor(private readonly region: Region) {}

    decompile(methodHandler: PandaDecompilerMethodHandler, _pandaLexical: PandaLexical, astNode: any): void {
        const codeGenerator = methodHandler.getCodeGenerator();
        const label = codeGenerator.getNodeFactory().labeledStatementNode(this.region.getName(), null as any);
        codeGenerator.getNodeUtils().insertNodeToBody(label as any, astNode);
    }
}

export abstract class LogicalExpressionStatement extends JumpStatement {
    protected readonly firstExp: boolean;
    protected readonly secondExp: boolean;
    protected readonly first: IPandaDecompileAble;
    protected readonly second: IPandaDecompileAble;

    constructor(first: Region, second: Region) {
        super(first);
        this.first = first.getStatements()[0];
        this.firstExp = first.isConditionalExp();
        this.second = second.getStatements()[0];
        this.secondExp = second.isConditionalExp();
    }

    abstract getType(): "||" | "&&";

    /** 供子类与 JumpStatement 调用 */
    generateTestExpressionInternal(methodHandler: PandaDecompilerMethodHandler, pandaLexical: PandaLexical): any {
        return this.generateTestExpressionPublic(methodHandler, pandaLexical);
    }

    generateTestExpressionPublic(methodHandler: PandaDecompilerMethodHandler, pandaLexical: PandaLexical): any {
        const codeGenerator = methodHandler.getCodeGenerator();
        const factory = codeGenerator.getNodeFactory();
        const utils = codeGenerator.getNodeUtils();
        const type = this.getType();
        const sequenceFirst = factory.sequenceExpressionNode([]);
        this.first.decompile(methodHandler, pandaLexical, sequenceFirst);
        if (this.first instanceof LogicalExpressionStatement) {
            this.insertLogicalOperand(factory, sequenceFirst, this.first);
        } else if (type === "||") {
            utils.insertToSequenceExpression(this.generateTestExpressionByExp(methodHandler, !this.firstExp) as any, sequenceFirst as any);
        } else {
            utils.insertToSequenceExpression(this.generateTestExpressionByExp(methodHandler, this.firstExp) as any, sequenceFirst as any);
        }
        const sequenceSecond = factory.sequenceExpressionNode([]);
        this.second.decompile(methodHandler, pandaLexical, sequenceSecond);
        if (this.second instanceof LogicalExpressionStatement) {
            this.insertLogicalOperand(factory, sequenceSecond, this.second);
        } else {
            utils.insertToSequenceExpression(this.generateTestExpressionByExp(methodHandler, this.secondExp) as any, sequenceSecond as any);
        }
        return factory.logicalExpressionNode(type, sequenceFirst as any, sequenceSecond as any);
    }

    /**
     * 合并后的子逻辑区域(已经是 `A || B` / `A && B` 表达式)不能再追加 `acc`/`!acc`:
     * 子逻辑语句的值本身就是条件表达式,而 acc 里留的是最后一个比较结果,追加会覆盖它。
     * `||` 的操作数是“跳转条件”,`&&` 的操作数是“fallthrough 条件”,因此父子类型不同时取反。
     */
    private insertLogicalOperand(
        factory: any,
        sequence: any,
        child: LogicalExpressionStatement,
    ): void {
        if (child.getType() === this.getType()) return;
        const last = sequence.expressions[sequence.expressions.length - 1];
        if (!last) return;
        sequence.expressions[sequence.expressions.length - 1] = factory.unaryExpressionNode("!", last);
    }

    decompile(methodHandler: PandaDecompilerMethodHandler, pandaLexical: PandaLexical, astNode: any): void {
        const codeGenerator = methodHandler.getCodeGenerator();
        if (codeGenerator.getNodeUtils().isSequenceExpression(astNode)) {
            const node = this.generateTestExpressionPublic(methodHandler, pandaLexical);
            codeGenerator.getNodeUtils().insertToSequenceExpression(node as any, astNode);
        }
    }
}

export class AndLogicalExpressionStatement extends LogicalExpressionStatement {
    getType(): "||" | "&&" { return "&&"; }
}

export class OrLogicalExpressionStatement extends LogicalExpressionStatement {
    getType(): "||" | "&&" { return "||"; }
}

export class TryCatchPandaStatement implements IPandaDecompileAble {
    constructor(private readonly tryBody: IPandaDecompileAble | null, private readonly catchBody: IPandaDecompileAble | null) {}

    decompile(methodHandler: PandaDecompilerMethodHandler, pandaLexical: PandaLexical, astNode: any): void {
        const codeGenerator = methodHandler.getCodeGenerator();
        const factory = codeGenerator.getNodeFactory();
        const tryBodyNode = factory.blockStatementNode();
        this.tryBody?.decompile(methodHandler, pandaLexical, tryBodyNode);
        const catchBodyNode = factory.blockStatementNode();
        this.catchBody?.decompile(methodHandler, pandaLexical, catchBodyNode);
        const tryNode = factory.tryStatementNode(tryBodyNode, catchBodyNode);
        codeGenerator.getNodeUtils().insertNodeToBody(tryNode as any, astNode);
    }
}
