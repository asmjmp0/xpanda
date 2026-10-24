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

    public static covert2SingleBlock(node:TYPE.BlockStatement){
        const sts = node.body;
        for (let i = sts.length - 1 ; i >= 0; --i) {
            const st = sts[i];
            if (TYPE.isExpressionStatement(st) && TYPE.isIdentifier(st.expression) && st.expression.name === "panda_jmp0_reserved_lex_begin"){
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