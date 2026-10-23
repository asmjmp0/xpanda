import { Program } from "@babel/types";
import {ISimplify} from "./ISimplify";
import * as TYPE from "@babel/types";
import traverse, {NodePath} from "@babel/traverse";
import {SyntaxRewriteSimplify} from "./SyntaxRewriteSimplify";
import {isDoneMember, isNextValue, isNodeEqual} from "./AstUtils";

/**
 * @Author: jmp0
 * @Email: jmp0@qq.com
 */

class SwitchCaseDesc {
    public type:"NORMAL"|"DEFAULT";
    public left:NodePath<TYPE.Expression>;
    public right:NodePath<TYPE.Expression>;
    public body:NodePath<TYPE.BlockStatement>|null;
}

export class HighLevelGrammarSimplify implements ISimplify {
    private getBlockOnlyOneAssignmentExpression(path:NodePath<TYPE.Statement>):NodePath<TYPE.AssignmentExpression>|null{
        if (path.isBlockStatement() && path.get('body').length == 1){
            const statement = path.get('body')[0];
            if (statement.isExpressionStatement() && statement.get('expression')){
                return statement.get('expression') as NodePath<TYPE.AssignmentExpression>;
            }
        }
        return null;
    }

    private getBlockOnlyOneReturnExpression(path:NodePath<TYPE.Statement>):NodePath<TYPE.Expression>{
        if (path.isBlockStatement() && path.get('body').length == 1){
            const statement = path.get('body')[0];
            if (statement.isReturnStatement() && statement.node.argument !== null){
                return statement.get('argument')
            }
        }
        return null

    }

    private getAssignmentExpressionEqualedLeft(first:NodePath<TYPE.AssignmentExpression>,second:NodePath<TYPE.AssignmentExpression>):string|null{
        const fl = first.get('left')
        const rl = second.get('left');
        if (fl.isIdentifier() && rl.isIdentifier()){
            if (fl.node.name === rl.node.name){
                return fl.node.name
            }
        }
        return null;
    }

    private checkAndTransformToConditionalExpression(value:NodePath<TYPE.IfStatement>):boolean{
        //check parent is no self
        if(value.getStatementParent() !== value) return false;
        const consequent = value.get('consequent');
        const alternate = value.get('alternate');
        const consequentAssign = this.getBlockOnlyOneAssignmentExpression(consequent);
        const alternateAssign = this.getBlockOnlyOneAssignmentExpression(alternate);
        if (consequentAssign !== null && alternateAssign !== null){
            const name = this.getAssignmentExpressionEqualedLeft(consequentAssign,alternateAssign);
            if (name === null) return false;
            let conditionalExpression:TYPE.Expression= TYPE.conditionalExpression(value.get('test').node,consequentAssign.get('right').node,alternateAssign.get('right').node);
            if (TYPE.isBooleanLiteral(conditionalExpression.consequent) && TYPE.isBooleanLiteral(conditionalExpression.alternate)
                && conditionalExpression.consequent.value === true && conditionalExpression.alternate.value === false){
                conditionalExpression = value.get('test').node;
            }
            const newAssignmentExpression = TYPE.assignmentExpression('=',TYPE.identifier(name),conditionalExpression);
            value.replaceWith(TYPE.expressionStatement(newAssignmentExpression));
            return true;
        }
        const consequentRet = this.getBlockOnlyOneReturnExpression(consequent);
        const alternateRet = this.getBlockOnlyOneReturnExpression(alternate);
        if (consequentRet !== null && alternateRet !== null){
            let conditionalExpression:TYPE.Expression= TYPE.conditionalExpression(value.get('test').node,consequentRet.node,alternateRet.node);
            if (TYPE.isBooleanLiteral(conditionalExpression.consequent) && TYPE.isBooleanLiteral(conditionalExpression.alternate)
                && conditionalExpression.consequent.value === true && conditionalExpression.alternate.value === false){
                conditionalExpression = value.get('test').node;
            }
            const returnStatement = TYPE.returnStatement(conditionalExpression)
            value.replaceWith(returnStatement);
            return true;
        }
        return false;
    }

    private checkEqualAngGetLeftRight(path:NodePath<TYPE.Expression>,arr:Array<[NodePath<TYPE.Expression>,NodePath<TYPE.Expression>]>):boolean{
        if (path.isBinaryExpression() && (path.node.operator === '===' || path.node.operator === '==')){
            const result = this.checkEqualAngGetLeftRightBinaryExpression(path);
            if (result == null) return false;
            arr.push(result);
            return true;
        } else if (TYPE.isLogicalExpression(path.node) && path.node.operator === '||'){
            // 必须整棵 || 都能拆成比较,否则 switch 会漏掉未识别的分支(例如 `!(a !== b)`
            // 或带 sequence 的条件),把剩余条件直接丢掉导致语义错误。
            if (!this.checkEqualAngGetLeftRight(path.get('left') as NodePath<TYPE.Expression>,arr)) return false;
            return this.checkEqualAngGetLeftRight(path.get('right') as NodePath<TYPE.Expression>,arr);
        }
        return false;
    }

    private checkEqualAngGetLeftRightBinaryExpression(path:NodePath<TYPE.Expression>):[NodePath<TYPE.Expression>,NodePath<TYPE.Expression>]|null{
        if((path as NodePath<TYPE.BinaryExpression>).get('left').isPrivateName()) return null;
        return [(path as NodePath<TYPE.BinaryExpression>).get('left') as NodePath<TYPE.Expression>, (path as NodePath<TYPE.BinaryExpression>).get('right')];
    }

    private nodeEqual(path1:NodePath<TYPE.Node>,path2:NodePath<TYPE.Node>):boolean {
        return isNodeEqual(path1.node, path2.node)
    }

    private isAccUndefinedBreak(node:TYPE.Node):boolean {
        return TYPE.isIfStatement(node)
            && TYPE.isBinaryExpression(node.test) && node.test.operator === "=="
            && TYPE.isIdentifier(node.test.left) && node.test.left.name === "acc"
            && TYPE.isIdentifier(node.test.right) && node.test.right.name === "undefined"
            && TYPE.isBreakStatement(node.consequent);
    }

    /** acc[Symbol.iterator]() */
    private isSymbolIteratorCall(node:TYPE.Node):boolean {
        if (!TYPE.isCallExpression(node) || !TYPE.isMemberExpression(node.callee)) return false;
        const callee = node.callee;
        if (!callee.computed || !TYPE.isMemberExpression(callee.property)) return false;
        return TYPE.isIdentifier(callee.property.object) && callee.property.object.name === "Symbol"
            && TYPE.isIdentifier(callee.property.property) && callee.property.property.name === "iterator";
    }

    private canTransform2questionMarkStatement(rawSwitchCase:Array<SwitchCaseDesc>):TYPE.Statement|null {
        if (rawSwitchCase.length != 2) return null;
        const case1:SwitchCaseDesc = rawSwitchCase[0];
        const case2:SwitchCaseDesc = rawSwitchCase[1];
        if (case1.body != null) return null;
        if (!case1.right.isNullLiteral()) return null;
        if (!TYPE.isIdentifier(case2.right.node)) return null;
        if (case2.right.node.name !== 'undefined') return null;
        if (case2?.body.node.body.length != 1) return null;
        const statement = case2.body.node.body[0];
        if (TYPE.isExpressionStatement(statement) && TYPE.isAssignmentExpression(statement.expression)){
            if (TYPE.isIdentifier(statement.expression.left) && TYPE.isIdentifier(case1.left.node)){
                if(statement.expression.left.name === case1.left.node.name) {
                    const assignmentExpression = TYPE.assignmentExpression("=", TYPE.identifier(case1.left.node.name), TYPE.logicalExpression("??", TYPE.identifier(case1.left.node.name), statement.expression.right));
                    return TYPE.expressionStatement(assignmentExpression);
                }else {
                    const logicalExpression = TYPE.logicalExpression("??",case1.left.node,statement.expression);
                    return TYPE.expressionStatement(logicalExpression);
                }
            }
        }
        return null;
    }

    private checkAndTransformToSwitchCase(value:NodePath<TYPE.IfStatement>):boolean{
        if (value.getStatementParent() !== value) return false;
        const rawSwitchCase:Array<SwitchCaseDesc> = []
        let temp = value;
        let defaultBody:TYPE.Statement[] = null;
        let partial = false;
        while (true){
            const tempTest = temp.get('test');
            const testResult:Array<[NodePath<TYPE.Expression>,NodePath<TYPE.Expression>]> = [];
            if (!this.checkEqualAngGetLeftRight(tempTest,testResult)) {
                // 链尾条件拆不出比较(如 `else if (a && b) ...`):把当前 if 及其 else
                // 链整体放进 default,前面已经识别出的 case 仍可合成 switch。
                // 第一个条件就拆不出时不能合成(没有任何 case)。
                if (rawSwitchCase.length === 0) return false;
                defaultBody = [temp.node];
                partial = true;
                break;
            }
            if (testResult.length === 0) return false;
            const body = temp.get('consequent');
            if (!body.isBlockStatement()) return false;
            for (let i = 0; i < testResult.length; i++) {
                const oneCase= new SwitchCaseDesc();
                oneCase.left = testResult[i][0];
                oneCase.right = testResult[i][1];
                oneCase.body = i === testResult.length -1 ? body : null;
                oneCase.type = "NORMAL";
                rawSwitchCase.push(oneCase);
            }
            const tt = temp.get('alternate');
            if (tt.isIfStatement()){
                temp = tt;
            }else if(tt.isBlockStatement()){
                defaultBody = tt.node.body;
                break;
            }else if (tt.node === null){
                break;
            }else return false;
        }
        if (rawSwitchCase.length < 2) return false;
        //check left all same;
        for (let i = 0; i < rawSwitchCase.length - 1; i++) {
            if (!this.nodeEqual(rawSwitchCase[i].left,rawSwitchCase[i+1].left))
                return false;
        }
        //build switch statement
        // 尾部还有无法拆成 case 的 else-if 时不能折成 ??(会丢掉后续分支)
        const questionMarkStatement = partial ? null : this.canTransform2questionMarkStatement(rawSwitchCase);
        if (questionMarkStatement != null){
            value.replaceWith(questionMarkStatement);
            return true;
        }
        const switchCases:Array<TYPE.SwitchCase> = []
        for (let desc of rawSwitchCase) {
            if (desc.body === null){
                switchCases.push(TYPE.switchCase(desc.right.node,[]))
                continue;
            }
            if (!TYPE.isReturnStatement(desc.body.node.body[desc.body.node.body.length-1])){
                desc.body.node.body.push(TYPE.breakStatement())
            }
            switchCases.push(TYPE.switchCase(desc.right.node,desc.body.node.body))
        }
        const switchStatement = TYPE.switchStatement(rawSwitchCase[0].left.node,switchCases)
        if (defaultBody != null){
            switchCases.push(TYPE.switchCase(null,defaultBody))
        }
        value.replaceWith(switchStatement);
        return true;
    }

    private checkAndTransformToForStatement(value:NodePath<TYPE.WhileStatement>){
        const pre = value.getPrevSibling();
        if (!TYPE.isExpressionStatement(pre.node)) return false;
        const test = value.get('test');
        if (!TYPE.isBooleanLiteral(test.node)) return false;
        const body = value.get('body')
        if (!TYPE.isBlockStatement(body.node)) return false;
        const bodyStatements = (body as NodePath<TYPE.BlockStatement>).get('body')
        if (bodyStatements.length < 2) return false;
        const first = bodyStatements[0];
        const last = bodyStatements[bodyStatements.length -1];
        if (!TYPE.isExpressionStatement(last.node)) return false;
        if (!first.isIfStatement()) return false;
        const consequent = first.get('consequent');
        if (!TYPE.isBreakStatement(consequent.node)) return false;
        //now transform it to for loop;
        const forBlock = TYPE.blockStatement([])
        for (let i = 1; i < bodyStatements.length - 1; i++) {
            forBlock.body.push(bodyStatements[i].node);
        }
        const forTest = first.get('test').node
        if (!TYPE.isBinaryExpression(forTest)) return false;
        else forTest.operator = SyntaxRewriteSimplify.binaryInvert(forTest);
        const forStatement = TYPE.forStatement(pre.node.expression,forTest,last.node.expression,forBlock)
        pre.remove();
        value.replaceWith(forStatement);
        return true;
    }


    private checkAndTransformToForInStatement(value:NodePath<TYPE.WhileStatement>){
        // acc = v9.next().value;
        // v10 = acc;
        // if (acc == undefined) break;
        const pre = value.getPrevSibling();
        if (!TYPE.isExpressionStatement(pre.node)) return false;
        const test = value.get('test');
        if (!TYPE.isBooleanLiteral(test.node)) return false;
        const body = value.get('body')
        if (!TYPE.isBlockStatement(body.node)) return false;
        const bodyStatements = (body as NodePath<TYPE.BlockStatement>).get('body')
        if (bodyStatements.length < 3) return false;
        const a = bodyStatements[0];
        const b = bodyStatements[1];
        const c = bodyStatements[2];
        if (TYPE.isExpressionStatement(a.node) && TYPE.isAssignmentExpression(a.node.expression) &&
            isNextValue(a.node.expression.right) && TYPE.isIdentifier(a.node.expression.left) && a.node.expression.left.name === 'acc'){
            if (TYPE.isExpressionStatement(b.node) && TYPE.isAssignmentExpression(b.node.expression)
                && TYPE.isIdentifier(b.node.expression.right) && b.node.expression.right.name === 'acc'){
                const vv = b.node.expression.left  as TYPE.Identifier;
                if (this.isAccUndefinedBreak(c.node)){
                    const body = TYPE.blockStatement(bodyStatements.slice(3,bodyStatements.length).map((value)=>{
                        return value.node;
                    }));
                    value.replaceWith(TYPE.forInStatement(vv,TYPE.identifier("reserved"),body));
                    return true;
                }
            }
        }
        return false;
    }
    private checkAndTransformToForOfStatement(value:NodePath<TYPE.WhileStatement>){
        const pre = value.getPrevSibling();
        if (!TYPE.isExpressionStatement(pre.node)) return false;
        const test = value.get('test');
        if (!TYPE.isBooleanLiteral(test.node)) return false;
        const body = value.get('body')
        if (!TYPE.isBlockStatement(body.node)) return false;
        const bodyStatements = (body as NodePath<TYPE.BlockStatement>).get('body')
        if (bodyStatements.length < 3) return false;
        const outStatement = bodyStatements[1];
        if (!outStatement.isIfStatement()) return false;
        const btest = outStatement.get('test');
        const consequent = outStatement.get('consequent');
        if (!TYPE.isBreakStatement(consequent.node)) return false;
        if (!isDoneMember(btest.node)) return false;
        let it = ((((pre.node as TYPE.ExpressionStatement).expression as TYPE.AssignmentExpression).right) as TYPE.MemberExpression).object as TYPE.Identifier
        if (it === undefined) return false;
        let vv = (btest.node as TYPE.MemberExpression).object as TYPE.Identifier;
        let arr:TYPE.Statement[] = [];
        for (let i = 2; i < bodyStatements.length; i++) {
            arr.push(bodyStatements[i].node);
        }
        const blockStatement = TYPE.blockStatement(arr);
        traverse(blockStatement,{
           MemberExpression:(value)=>{
               const node = value.get('property').node;
               if (TYPE.isIdentifier(node) && node.name === 'value'){
                   value.replaceWith(value.node.object);
               }
           }
        },value.scope);
        const forOfStatement = TYPE.forOfStatement(vv,it,blockStatement);
        value.replaceWith(forOfStatement);
        pre.remove();
        return true;
    }

    simplify(node: Program): boolean {
        let changed = false;
        traverse(TYPE.file(node), {
            //transform while-statement to for-statement
            WhileStatement:(value)=>{
                if (this.checkAndTransformToForStatement(value)) changed = true;
                if (this.checkAndTransformToForInStatement(value)) changed = true;
                if (this.checkAndTransformToForOfStatement(value)) changed = true;
            },
            IfStatement:(value)=>{
                // transform to conditional expression
                if (this.checkAndTransformToConditionalExpression(value)) changed = true;
            },
            ForInStatement:(value)=>{
                if (TYPE.isIdentifier(value.node.right) && value.node.right.name === 'reserved'){
                    let node = value.getPrevSibling().node;
                    if (TYPE.isExpressionStatement(node)){
                        node = node.expression
                    }
                    if(TYPE.isAssignmentExpression(node)){
                        node = node.right
                    }
                    if (this.isSymbolIteratorCall(node)){
                        const callee = (node as TYPE.CallExpression).callee
                        const callexp = (callee as TYPE.MemberExpression).object as TYPE.CallExpression
                        const id = callexp.arguments[0] as TYPE.Identifier
                        if (TYPE.isIdentifier(id)) {
                            value.get('right').replaceWith(id)
                            value.getPrevSibling().remove();
                            changed = true;
                        }
                    }
                }
            },
            ConditionalExpression:(value)=>{
                // can transform optionalMemberExpression
                const conditionalNode = value.node;
                const test = conditionalNode.test;
                const consequent = conditionalNode.consequent;
                const alternate = conditionalNode.alternate;
                if (!TYPE.isLogicalExpression(test)) return;
                if (!TYPE.isBinaryExpression(test.left)) return;
                if (test.left.operator != '===' ) return;
                if (!TYPE.isNullLiteral(test.left.right)) return;
                if (!TYPE.isIdentifier(test.left.left)) return;
                const leftName = test.left.left.name;

                if (!TYPE.isBinaryExpression(test.right)) return;
                if (test.right.operator != '===' ) return;
                if (!TYPE.isIdentifier(test.right.right)) return;
                if (test.right.right.name != "undefined") return;
                if (!TYPE.isIdentifier(test.right.left)) return;
                const rightName = test.right.left.name;
                if (leftName !== rightName) return;

                if (!TYPE.isIdentifier(consequent)) return;
                if (consequent.name !== 'undefined') return;
                if (!TYPE.isMemberExpression(alternate)) return;
                if (!TYPE.isIdentifier(alternate.object)) return;
                if (alternate.object.name != rightName) return;
                const optionalMemberExpression = TYPE.optionalMemberExpression(alternate.object,alternate.property as TYPE.Expression ,true,true);
                value.replaceWith(optionalMemberExpression);
                changed = true;
            }
        })

        traverse(TYPE.file(node), {
            IfStatement:(value)=>{
                // transform to switch case expression
                if (this.checkAndTransformToSwitchCase(value)) changed = true;
            }
        })
        return changed;
    }
}