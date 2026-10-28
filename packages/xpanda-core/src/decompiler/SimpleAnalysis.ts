import type { PandaIRCFG } from "../disasm/PandaIRCFG";
import type { PandaLexical } from "../disasm/PandaLexical";
import { NodeFactory } from "../ast/NodeFactory";
import { NodeUtils } from "../ast/NodeUtils";
import { LinearPandaStatement } from "./statements";
import { checkIsAsyncException, checkIsGeneratorException } from "./ExceptionTable";
import type { PandaDecompilerMethodHandler } from "./MethodHandler";
import * as TYPE from "@babel/types";

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
        // 确保显式异常边已建立(SimpleAnalysis 可能在没有 StructureAnalysis 时单独使用)
        irCFG.getExceptionTable();
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
        const factory = NodeFactory;
        const utils = NodeUtils;
        factory.addLeadingComment(astNode, "The function was created by SimpleAnalysis,because StructureAnalysis failed.");
        if (this.isAsyncFunction) utils.setIsAsyncBlock(astNode);
        if (this.isGeneratorFunction) utils.setIsGeneratorBlock(astNode);
        for (const statement of this.statements) {
            const blockStatementNode = factory.blockStatementNode();
            for (const handler of this.irCFG.graph.exceptionSuccessors(statement.block)) {
                const arrayObject = [];
                arrayObject.push(factory.identifierNode(handler.name));
                const callExpressionNode = factory.callExpressionNode(factory.identifierNode("decompiler_exception_handled_by") as any, arrayObject as any);
                utils.insertNodeToBody(factory.expressionStatementNode(callExpressionNode as any) as any, blockStatementNode);
            }
            if (this.exceptionHandleBlocks.has(statement.block)) {
                const assignment = factory.assignmentExpressionNode("=", factory.identifierNode("acc") as any, factory.identifierNode("decompiler_exception_detail") as any);
                utils.insertNodeToBody(factory.expressionStatementNode(assignment as any) as any, blockStatementNode);
            }
            statement.decompile(methodHandler, pandaLexical, blockStatementNode);
            const instruction = statement.block.getTerminator();
            if (instruction.kind === "jumpDirect") {
                const arrayObject = [];
                arrayObject.push(factory.identifierNode("label_" + instruction.destinationPC));
                const callExpressionNode = factory.callExpressionNode(factory.identifierNode("decompiler_goto") as any, arrayObject as any);
                utils.insertNodeToBody(factory.expressionStatementNode(callExpressionNode as any) as any, blockStatementNode);
            } else if (instruction.kind === "jumpEqual" || instruction.kind === "jumpNotEqual") {
                const arrayObject = [];
                arrayObject.push(factory.identifierNode("label_" + instruction.destinationPC));
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
        this.hoistLexicalDeclarations(astNode);
    }

    /**
     * SimpleAnalysis 下每个 IR 块都是独立的 `label: { ... }`,而 newLexEnv 的
     * `let local_L_i` 会落在入口块里,后面的 label 就访问不到它(块级作用域)。
     * 这里把所有词法环境变量声明提升到函数体顶部,并合并同名声明。
     */
    private hoistLexicalDeclarations(astNode: any): void {
        const body: TYPE.Statement[] = astNode.body;
        const names: string[] = [];
        const seen = new Set<string>();

        const walk = (node: any): void => {
            if (!node || typeof node.type !== "string") return;
            if (TYPE.isFunction(node) || TYPE.isClass(node)) return;
            if (TYPE.isVariableDeclaration(node)) {
                node.declarations = node.declarations.filter((declarator: TYPE.VariableDeclarator) => {
                    if (!TYPE.isIdentifier(declarator.id) || declarator.init) return true;
                    if (!/^(local|sendable)_\d+_\d+$/.test(declarator.id.name)) return true;
                    if (!seen.has(declarator.id.name)) {
                        seen.add(declarator.id.name);
                        names.push(declarator.id.name);
                    }
                    return false;
                });
            }
            for (const key of TYPE.VISITOR_KEYS[node.type] ?? []) {
                const value = node[key];
                if (Array.isArray(value)) {
                    for (const child of value) walk(child);
                    node[key] = value.filter((child: any) =>
                        !(TYPE.isVariableDeclaration(child) && child.declarations.length === 0));
                } else {
                    walk(value);
                }
            }
        };
        for (const statement of body) walk(statement);
        astNode.body = body.filter((statement: any) =>
            !(TYPE.isVariableDeclaration(statement) && statement.declarations.length === 0));

        if (names.length === 0) return;
        const declarators = names.map((name) => TYPE.variableDeclarator(TYPE.identifier(name), null));
        // 跳过 import 和指令 prologue,不要破坏 "use strict" 等语义
        let insertAt = 0;
        while (insertAt < astNode.body.length) {
            const statement = astNode.body[insertAt];
            if (!TYPE.isImportDeclaration(statement) && !(TYPE.isExpressionStatement(statement) && (statement as any).directive)) break;
            insertAt++;
        }
        astNode.body.splice(insertAt, 0, TYPE.variableDeclaration("let", declarators));
    }
}
