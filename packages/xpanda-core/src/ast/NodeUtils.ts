import * as TYPE from '@babel/types';
import traverse from "@babel/traverse";
import {NodeFactory} from "./NodeFactory";
export class NodeUtils{
    public static insertToProgram(programA:TYPE.Program,programB:TYPE.Program):void{
        programA.body.forEach((value)=>{
            programB.body.push(value);
        })
    }

    public static insertNodeToBody(node:TYPE.Statement,programB:TYPE.BlockStatement|TYPE.SequenceExpression|TYPE.Program):void{
        if (programB.type === 'BlockStatement' || programB.type === 'Program' ){
            programB.body.push(node);
            return;
        }
        if (programB.type === 'SequenceExpression' &&
            node.type === 'ExpressionStatement'){
            programB.expressions.push(node.expression);
            return;
        }
    }

    public static insertToSequenceExpression(node:TYPE.Expression|TYPE.Statement,seq:TYPE.SequenceExpression):void{
        if (node.type === 'ExpressionStatement'){
            seq.expressions.push(node.expression);
            return;
        }
        seq.expressions.push(node as TYPE.Expression)
    }

    public static decompileFailedBlock(node:TYPE.BlockStatement){
        node.body = []
        TYPE.addComment(node,"inner","decompileFailed!");
    }

    public static setIsAsyncBlock(node:TYPE.BlockStatement){
        if (node.extra === undefined) node.extra = {}
        node.extra["panda_async"] = true;
    }

    public static setIsGeneratorBlock(node:TYPE.BlockStatement){
        if (node.extra === undefined) node.extra = {}
        node.extra["panda_generator"] = true;
    }

    public static copyBlockExtra(node:TYPE.BlockStatement|TYPE.Program,node1:TYPE.BlockStatement){
        if (TYPE.isProgram(node)) return;
        node.extra = node1.extra;
    }

    public static compare(node:TYPE.Program){
        const nodeList:Array<string> = []
        const nodeList2:Array<string> = []
        traverse(TYPE.file(node), {
            enter:(value)=>{
                nodeList.push(value.node.type);
            }
        })
        const gp = NodeFactory.parse(NodeFactory.generate(node));
        traverse(TYPE.file(gp), {
            enter:(value)=>{
                nodeList2.push(value.node.type);
            }
        })
        if (nodeList.length !== nodeList2.length){
            console.log("compare error");
            return;
        }else{
            for (let i = 0; i < nodeList.length; i++) {
                if (nodeList[i] !== nodeList2[i]){
                    console.log(nodeList[i],nodeList2[i],"not equal!")
                }
            }
        }
    }

    public static toJson(node:TYPE.Program){
        return JSON.stringify(node);
    }

    public static toObject(str:string){
        return JSON.parse(str);
    }

    public static isSequenceExpression(node:TYPE.Node):boolean{
        return TYPE.isSequenceExpression(node);
    }

    /**
     * Close the lexical block opened by `newLexEnv`.
     *
     * Markers carry the environment instance
     * (`panda_jmp0_reserved_lex_begin_local_1_2`); a pop matches the environment it
     * actually popped. When that marker is not in the current list (the pop was
     * structured into a branch or the handler seed cannot name it), fall back to the
     * historical "close the last marker in this list" behavior. Generated names are
     * unique per instance, so widening a declaration's block is safe.
     */
    public static covert2SingleBlock(node:TYPE.BlockStatement, envName?:string){
        const sts = node.body;
        const marker = (st:TYPE.Statement):string|null => {
            if (TYPE.isExpressionStatement(st) && TYPE.isIdentifier(st.expression)
                && st.expression.name.startsWith("panda_jmp0_reserved_lex_begin")) {
                return st.expression.name;
            }
            return null;
        };
        if (envName !== undefined) {
            const wanted = "panda_jmp0_reserved_lex_begin_" + envName;
            for (let i = sts.length - 1 ; i >= 0; --i) {
                if (marker(sts[i]) === wanted) {
                    const new_block = sts.splice(i+1,sts.length);
                    const block = TYPE.blockStatement(new_block)
                    node.body = [...sts.splice(0,i),block]
                    return;
                }
            }
            // The popped environment's marker is not in this statement list (it was
            // structured into a branch/nested block, or the handler seed cannot name
            // it). Fall back to closing the last marker in this list to preserve the
            // historical block shape; generated names are unique, so widening scope
            // is safe.
        }
        for (let i = sts.length - 1 ; i >= 0; --i) {
            if (marker(sts[i]) !== null){
                const new_block = sts.splice(i+1,sts.length);
                const block = TYPE.blockStatement(new_block)
                node.body = [...sts.splice(0,i),block]
                return;
            }
        }
    }

    public static tryFixGoto(node:TYPE.BlockStatement,labelName:string):boolean{
        const sts = node.body;
        for (let i = sts.length - 1 ; i >= 0; --i) {
            const st = sts[i];
            if (TYPE.isLabeledStatement(st) && st.label.name === labelName){
                const new_block = sts.splice(i+1,sts.length);
                const block = TYPE.blockStatement(new_block)
                const whileStatement = TYPE.whileStatement(TYPE.booleanLiteral(true),block);
                const labeledStatement = TYPE.labeledStatement(TYPE.identifier(labelName),whileStatement);
                node.body = [...sts.splice(0,i),labeledStatement]
                return true;
            }
        }
        return false;
    }

    public static setReturnTypeCall(node:TYPE.CallExpression){
        if (node.extra === undefined) node.extra = {}
        node.extra["callIns"] = true;
    }

}