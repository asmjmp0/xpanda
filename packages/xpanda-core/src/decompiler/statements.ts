import type { PandaIRBasicBlock } from "../disasm/PandaIRBasicBlock";
import type { PandaLexical } from "../disasm/PandaLexical";
import { NodeFactory } from "../ast/NodeFactory";
import { NodeUtils } from "../ast/NodeUtils";
import type { PandaDecompilerMethodHandler } from "./MethodHandler";
import type { Region } from "./Region";
import type { HandlerSavePlan } from "./ExceptionTable";

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
        const factory = NodeFactory;
        if (!exp) return factory.unaryExpressionNode("!", factory.identifierNode("acc") as any);
        return factory.identifierNode("acc");
    }

    decompile(methodHandler: PandaDecompilerMethodHandler, pandaLexical: PandaLexical, astNode: any): void {
        throw new Error("abstract");
    }
}

export class IfPandaStatement extends JumpStatement {
    private consequent: IPandaDecompileAble | null;
    private alternate: IPandaDecompileAble | null;

    constructor(private readonly test: Region, consequent: IPandaDecompileAble | null, alternate: IPandaDecompileAble | null) {
        super(test);
        this.consequent = consequent;
        this.alternate = alternate;
    }

    decompile(methodHandler: PandaDecompilerMethodHandler, pandaLexical: PandaLexical, astNode: any): void {
        const factory = NodeFactory;
        let exp = this.generateTestExpression(methodHandler, pandaLexical);
        if (this.consequent === null) {
            exp = factory.unaryExpressionNode("!", exp as any);
            const alertBlock = factory.blockStatementNode();
            this.alternate!.decompile(methodHandler, pandaLexical, alertBlock);
            NodeUtils.insertNodeToBody(factory.ifStatementNode(exp as any, alertBlock, null) as any, astNode);
        } else if (this.alternate === null) {
            const consequentBlock = factory.blockStatementNode();
            this.consequent.decompile(methodHandler, pandaLexical, consequentBlock);
            NodeUtils.insertNodeToBody(factory.ifStatementNode(exp as any, consequentBlock, null) as any, astNode);
        } else {
            const consequentBlock = factory.blockStatementNode();
            this.consequent.decompile(methodHandler, pandaLexical, consequentBlock);
            const alertBlock = factory.blockStatementNode();
            this.alternate.decompile(methodHandler, pandaLexical, alertBlock);
            NodeUtils.insertNodeToBody(factory.ifStatementNode(exp as any, consequentBlock, alertBlock) as any, astNode);
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
        const factory = NodeFactory;
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
            NodeUtils.insertNodeToBody(jumpOutBlock as any, block);
        }
        for (const bodyStm of this.bodyStms) {
            bodyStm.decompile(methodHandler, pandaLexical, block);
        }
        const trueNode = factory.booleanLiteralNode(true);
        const doWhileNode = factory.whileStatementNode(trueNode, block);
        NodeUtils.insertNodeToBody(doWhileNode as any, astNode);
    }
}

export class DoWhileStatement extends JumpStatement {
    private bodyStms: IPandaDecompileAble[];

    constructor(body: Region) {
        super(body);
        this.bodyStms = body.getStatements().slice();
    }

    decompile(methodHandler: PandaDecompilerMethodHandler, pandaLexical: PandaLexical, astNode: any): void {
        const factory = NodeFactory;
        const block = factory.blockStatementNode();
        for (const bodyStm of this.bodyStms) {
            bodyStm.decompile(methodHandler, pandaLexical, block);
        }
        const testNode = factory.unaryExpressionNode("!", this.generateTestExpression(methodHandler, pandaLexical) as any);
        const doWhileNode = factory.doWhileStatementNode(testNode as any, block);
        NodeUtils.insertNodeToBody(doWhileNode as any, astNode);
    }
}

export class BreakStatement implements IPandaDecompileAble {
    constructor(private readonly comment: string | null) {}

    decompile(methodHandler: PandaDecompilerMethodHandler, _pandaLexical: PandaLexical, astNode: any): void {
        const breakStatement = NodeFactory.breakStatement();
        if (this.comment) {
            NodeFactory.addTrailingComment(breakStatement as any, this.comment);
        }
        NodeUtils.insertNodeToBody(breakStatement as any, astNode);
    }
}

export class ContinueStatement implements IPandaDecompileAble {
    constructor(private readonly comment: string | null) {}

    decompile(methodHandler: PandaDecompilerMethodHandler, _pandaLexical: PandaLexical, astNode: any): void {
        const continueStatement = NodeFactory.continueStatement();
        if (this.comment) {
            NodeFactory.addTrailingComment(continueStatement as any, this.comment);
        }
        NodeUtils.insertNodeToBody(continueStatement as any, astNode);
    }
}

export class GotoStatement implements IPandaDecompileAble {
    constructor(private readonly dest: Region) {}

    decompile(methodHandler: PandaDecompilerMethodHandler, _pandaLexical: PandaLexical, astNode: any): void {
        const name = this.dest.getName();
        const factory = NodeFactory;
        if (!NodeUtils.tryFixGoto(astNode, name)) {
            const identifierNode = factory.identifierNode("xpanda_goto");
            const arrayObject = [];
            arrayObject.push(factory.identifierNode(name));
            const callExpressionNode = factory.callExpressionNode(identifierNode as any, arrayObject as any);
            NodeUtils.insertNodeToBody(factory.expressionStatementNode(callExpressionNode as any) as any, astNode);
        }
    }
}

export class LabelStatement implements IPandaDecompileAble {
    constructor(private readonly region: Region) {}

    decompile(methodHandler: PandaDecompilerMethodHandler, _pandaLexical: PandaLexical, astNode: any): void {
        const label = NodeFactory.labeledStatementNode(this.region.getName(), null as any);
        NodeUtils.insertNodeToBody(label as any, astNode);
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
        const factory = NodeFactory;
        const utils = NodeUtils;
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
        if (NodeUtils.isSequenceExpression(astNode)) {
            const node = this.generateTestExpressionPublic(methodHandler, pandaLexical);
            NodeUtils.insertToSequenceExpression(node as any, astNode);
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
    constructor(
        private readonly tryBody: IPandaDecompileAble | null,
        private readonly catchBody: IPandaDecompileAble | null,
        /** 该 try 保护范围的结束 pc(try 表),用于判断 catch 与 finally 的嵌套关系 */
        private readonly tryBodyEndPC: number | null = null,
        /**
         * Try 区域的语义。`finallyEpilogue` 表示这是 24+ 内联 finally 的异常路径
         * handler:结构化阶段先按 catch 输出(cleanup + 重抛),再由尾部
         * foldEagerCatchToFinally 根据 try 体里内联的同一份 cleanup 折回 try/finally。
         * 标记写在 AST 的 extra 上,让最终折叠能确认它来自 Try 区域。
         */
        private readonly kind: "catch" | "finallyEpilogue" = "catch",
        /**
         * 逐抛出点保存槽位的值等价计划(见 planHandlerSaves):
         *   - materialize:在 try 前物化一次 `R = S`,范围内的保存全部冗余;
         *   - resurrect:写入 tryNode.extra,AST liveness 在可抛语句处保持这些
         *     槽位的保存活跃(handler 观察读、值证明失败的寄存器)。
         */
        private readonly savesPlan: HandlerSavePlan | null = null,
    ) {}

    decompile(methodHandler: PandaDecompilerMethodHandler, pandaLexical: PandaLexical, astNode: any): void {
        const factory = NodeFactory;
        const tryBodyNode = factory.blockStatementNode();
        this.tryBody?.decompile(methodHandler, pandaLexical, tryBodyNode);
        const catchBodyNode = factory.blockStatementNode();
        // handler 是按 Panda 累加器生成的:进入 catch 时异常在 acc 里,之后的
        // `acc = ...` 继续当累加器用。catch 参数用的是独立名字 catchAcc,
        // 这里先把异常搬回函数级 acc,后续语句就和 try 体里的累加器写法一致,
        // 优化器能把 `catchAcc = ...` 死链正常折掉。
        const toAcc = factory.assignmentExpressionNode(
            "=",
            factory.identifierNode("acc") as any,
            factory.identifierNode("catchAcc") as any,
        );
        NodeUtils.insertNodeToBody(factory.expressionStatementNode(toAcc as any) as any, catchBodyNode);
        this.catchBody?.decompile(methodHandler, pandaLexical, catchBodyNode);
        // 值等价证明成立的保存槽位在 try 前物化一次(`v15 = v3`):handler 读取的
        // 值 = 源寄存器在 try 入口的值(范围内不变),范围内的逐抛出点保存随后由
        // liveness 当死存储删掉。物化语句必须紧挨 try 之前,读取的正是 try 入口值。
        if (this.savesPlan) {
            for (const entry of this.savesPlan.materialize) {
                const assign = factory.assignmentExpressionNode(
                    "=",
                    factory.identifierNode(entry.register) as any,
                    factory.identifierNode(entry.source) as any,
                );
                NodeUtils.insertNodeToBody(factory.expressionStatementNode(assign as any) as any, astNode);
            }
        }
        const tryNode = factory.tryStatementNode(tryBodyNode, catchBodyNode);
        if (this.kind === "finallyEpilogue") {
            tryNode.extra = { ...(tryNode.extra ?? {}), xpandaTryKind: "finallyEpilogue" };
        }
        if (this.savesPlan && this.savesPlan.resurrect.length > 0) {
            tryNode.extra = { ...(tryNode.extra ?? {}), xpandaHandlerSaves: this.savesPlan.resurrect };
        }
        if (this.tryBodyEndPC !== null) methodHandler.recordTryBodyEnd(tryNode, this.tryBodyEndPC);
        NodeUtils.insertNodeToBody(tryNode as any, astNode);
    }
}
