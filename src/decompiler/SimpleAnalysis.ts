import type { PandaIRCFG } from "../disasm/PandaIRCFG";
import type { PandaLexical } from "../disasm/PandaLexical";
import { LinearPandaStatement } from "./statements";
import type { PandaDecompilerMethodHandler } from "./MethodHandler";

/**
 * 结构化失败时的降级方案(移植自 Java SimpleAnalysis)
 * 线性输出所有基本块,用 label + decompiler_goto 模拟跳转
 * @Author: jmp0
 */
export class SimpleAnalysis {
    private isAsyncFunction = false;
    private isGeneratorFunction = false;
    private readonly exceptionHandleBlocks = new Set<any>();
    private readonly statements: LinearPandaStatement[] = [];

    constructor(private readonly irCFG: PandaIRCFG) {
        this.checkIsAsync();
        this.checkAndSpecialFunction();
        for (const basicBlock of irCFG.pandaIRBasicBlocks) {
            this.statements.push(new LinearPandaStatement(basicBlock));
        }
    }

    private checkAndSpecialFunction(): void {
        if (this.irCFG.getPandaMethod().hasException()) {
            for (const tryBlock of this.irCFG.getPandaMethod().methodCode!.pandaMethodTryBlocks!) {
                const catchBlock = tryBlock.pandaMethodCatchBlocks[0];
                const tryEntryBlock = this.irCFG.getBasicBlockByPC(tryBlock.startPC);
                const tryCodeLength = tryBlock.length;
                const handleEntryBlock = this.irCFG.getBasicBlockByPC(catchBlock.handlerPC);
                const handleCodeLength = catchBlock.codeSize;
                if (!tryEntryBlock || !handleEntryBlock) continue;
                if (tryCodeLength === 0 || handleCodeLength === 0) continue;
                this.exceptionHandleBlocks.add(handleEntryBlock);
                const { checkIsAsyncException, checkIsGeneratorException } = require("./RegionGraphBuilder");
                if (checkIsAsyncException(handleEntryBlock)) {
                    this.isAsyncFunction = true;
                    continue;
                }
                if (checkIsGeneratorException(tryEntryBlock)) {
                    this.isGeneratorFunction = true;
                }
            }
        }
    }

    private checkIsAsync(): void {
        for (const instruction of this.irCFG.getEntryBlock().pandaInstructions) {
            if (instruction.kind === "async" && instruction.asyncType === "asyncfunctionenter") {
                this.isAsyncFunction = true;
                break;
            }
        }
    }

    analysis(methodHandler: PandaDecompilerMethodHandler, pandaLexical: PandaLexical, astNode: any): void {
        const codeGenerator = methodHandler.getCodeGenerator();
        const factory = codeGenerator.getNodeFactory();
        const utils = codeGenerator.getNodeUtils();
        factory.addLeadingComment(astNode, "The function was created by SimpleAnalysis,because StructureAnalysis failed.");
        if (this.isAsyncFunction) utils.setIsAsyncBlock(astNode);
        if (this.isGeneratorFunction) utils.setIsGeneratorBlock(astNode);
        for (const statement of this.statements) {
            const blockStatementNode = factory.blockStatementNode();
            if (statement.block.catchBlockList) {
                for (const b of statement.block.catchBlockList) {
                    const arrayObject = codeGenerator.arrayObject();
                    codeGenerator.addToArray(arrayObject, factory.identifierNode(b.name));
                    const callExpressionNode = factory.callExpressionNode(factory.identifierNode("decompiler_exception_handled_by") as any, arrayObject as any);
                    utils.insertNodeToBody(factory.expressionStatementNode(callExpressionNode as any) as any, blockStatementNode);
                }
            }
            if (this.exceptionHandleBlocks.has(statement.block)) {
                const assignment = factory.assignmentExpressionNode("=", factory.identifierNode("acc") as any, factory.identifierNode("decompiler_exception_detail") as any);
                utils.insertNodeToBody(factory.expressionStatementNode(assignment as any) as any, blockStatementNode);
            }
            statement.decompile(methodHandler, pandaLexical, blockStatementNode);
            const instruction = statement.block.getTerminator();
            if (instruction.kind === "jumpDirect") {
                const arrayObject = codeGenerator.arrayObject();
                codeGenerator.addToArray(arrayObject, factory.identifierNode("label_" + instruction.destinationPC));
                const callExpressionNode = factory.callExpressionNode(factory.identifierNode("decompiler_goto") as any, arrayObject as any);
                utils.insertNodeToBody(factory.expressionStatementNode(callExpressionNode as any) as any, blockStatementNode);
            } else if (instruction.kind === "jumpEqual" || instruction.kind === "jumpNotEqual") {
                const arrayObject = codeGenerator.arrayObject();
                codeGenerator.addToArray(arrayObject, factory.identifierNode("label_" + instruction.destinationPC));
                const callExpressionNode = factory.callExpressionNode(factory.identifierNode("decompiler_goto") as any, arrayObject as any);
                const ifTestObject = instruction.kind === "jumpNotEqual"
                    ? factory.identifierNode("acc") as any
                    : factory.unaryExpressionNode("!", factory.identifierNode("acc") as any);
                const ifStatementNode = factory.ifStatementNode(ifTestObject, factory.expressionStatementNode(callExpressionNode as any), null);
                utils.insertNodeToBody(ifStatementNode as any, blockStatementNode);
            }
            const labeledStatementNode = factory.labeledStatementNode(statement.block.name, blockStatementNode);
            utils.insertNodeToBody(labeledStatementNode as any, astNode);
        }
    }
}
