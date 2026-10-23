import { Program } from "@babel/types";
import {ISimplify} from "./ISimplify";
import * as TYPE from "@babel/types";
import traverse, {NodePath} from "@babel/traverse";
import {SyntaxRewriteSimplify} from "./SyntaxRewriteSimplify";
import {collectIdentifierNames, isDoneMember, isNextValue, isNodeEqual} from "./AstUtils";


const {
    breakStatement,
    expressionStatement,
    file,
    forInStatement,
    identifier,
    isBooleanLiteral,
    isBreakStatement,
    isCallExpression,
    isLogicalExpression,
    isMemberExpression,
    isProgram,
    optionalMemberExpression,
    switchCase,
    unaryExpression: unaryExpressionBuilder,
    assignmentExpression: assignmentExpressionBuilder,
    blockStatement: blockStatementBuilder,
    conditionalExpression: conditionalExpressionBuilder,
    forOfStatement: forOfStatementBuilder,
    forStatement: forStatementBuilder,
    isAssignmentExpression: isAssignmentExpressionNode,
    isBinaryExpression: isBinaryExpressionNode,
    isBlockStatement: isBlockStatementNode,
    isExpressionStatement: isExpressionStatementNode,
    isIdentifier: isIdentifierNode,
    isIfStatement: isIfStatementNode,
    isNullLiteral: isNullLiteralNode,
    isReturnStatement: isReturnStatementNode,
    logicalExpression: logicalExpressionBuilder,
    returnStatement: returnStatementBuilder,
    switchStatement: switchStatementBuilder,
} = TYPE;

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
        if (!path.node) return null;
        // else-if 折叠后分支可能直接是裸赋值语句(`if (A) { X = a } else if (B) ...`
        // 里的 alternate),因此除单语句块外也要接受裸 ExpressionStatement。
        let expression: NodePath<TYPE.Node> | null = null;
        if (path.isBlockStatement() && path.get('body').length == 1){
            const statement = path.get('body')[0];
            if (statement.isExpressionStatement()){
                expression = statement.get('expression');
            }
        } else if (path.isExpressionStatement()) {
            expression = path.get('expression');
        }
        if (expression && expression.isAssignmentExpression()) {
            return expression as NodePath<TYPE.AssignmentExpression>;
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
        // if 只能出现在语句位置(Program/Block 的 body、if 的 consequent/alternate、
        // switch case 等),这些位置都能安全替换成赋值语句。
        // 注意不能要求 getStatementParent() === value:else-if 的 alternate 位于
        // 外层 if 之下,getStatementParent() 会返回外层 if。
        // 不过 return 链要保持 `else if ... else ...` 结构,只允许非嵌套的 if
        // 折成 return 三目,否则会生成 `else return A ? ... : B` 这样的多层嵌套。
        const nested = value.getStatementParent() !== value;
        const consequent = value.get('consequent');
        const alternate = value.get('alternate');
        const consequentAssign = this.getBlockOnlyOneAssignmentExpression(consequent);
        const alternateAssign = this.getBlockOnlyOneAssignmentExpression(alternate);
        if (consequentAssign !== null && alternateAssign !== null){
            const name = this.getAssignmentExpressionEqualedLeft(consequentAssign,alternateAssign);
            if (name === null) return false;
            let conditionalExpression:TYPE.Expression= conditionalExpressionBuilder(value.get('test').node,consequentAssign.get('right').node,alternateAssign.get('right').node);
            if (isBooleanLiteral(conditionalExpression.consequent) && isBooleanLiteral(conditionalExpression.alternate)
                && conditionalExpression.consequent.value === true && conditionalExpression.alternate.value === false){
                conditionalExpression = value.get('test').node;
            }
            const newAssignmentExpression = assignmentExpressionBuilder('=',identifier(name),conditionalExpression);
            value.replaceWith(expressionStatement(newAssignmentExpression));
            return true;
        }
        // return 三目只在非嵌套位置折叠,保留 else-if 链的可读结构
        if (nested) return false;
        const consequentRet = this.getBlockOnlyOneReturnExpression(consequent);
        const alternateRet = this.getBlockOnlyOneReturnExpression(alternate);
        if (consequentRet !== null && alternateRet !== null){
            let conditionalExpression:TYPE.Expression= conditionalExpressionBuilder(value.get('test').node,consequentRet.node,alternateRet.node);
            if (isBooleanLiteral(conditionalExpression.consequent) && isBooleanLiteral(conditionalExpression.alternate)
                && conditionalExpression.consequent.value === true && conditionalExpression.alternate.value === false){
                conditionalExpression = value.get('test').node;
            }
            const returnStatement = returnStatementBuilder(conditionalExpression)
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
        } else if (isLogicalExpression(path.node) && path.node.operator === '||'){
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

    /**
     * 把 `x.a.b` 链的最内层成员改成可选访问 `x?.a.b`;x 必须是受保护标识符。
     * 外层链也必须是 OptionalMemberExpression(optional=false),否则 Babel 会
     * 输出 `(x?.a).b`,遇到 x 为空时会继续读 `.b` 而抛异常。
     */
    private makeOptionalChain(node: TYPE.Expression, target: string): TYPE.Expression | null {
        if (!isMemberExpression(node) || node.optional) return null;
        if (isIdentifierNode(node.object) && node.object.name === target) {
            return optionalMemberExpression(node.object, node.property as TYPE.Expression, node.computed, true);
        }
        const inner = this.makeOptionalChain(node.object as TYPE.Expression, target);
        if (!inner) return null;
        return optionalMemberExpression(inner, node.property as TYPE.Expression, node.computed, false);
    }

    /**
     * test 是否等价于 `x == null`:接受合并后的 `x == null` 与未合并的
     * `x === null || x === undefined` 两种形态。只接受标识符,避免把
     * `p0.value.author` 这类成员访问重复求值(可能触发 getter)。
     */
    private nullishGuardTarget(test: TYPE.Expression): TYPE.Identifier | null {
        if (isBinaryExpressionNode(test) && test.operator === "==") {
            if (isNullLiteralNode(test.left) && isIdentifierNode(test.right)) return test.right;
            if (isNullLiteralNode(test.right) && isIdentifierNode(test.left)) return test.left;
            return null;
        }
        if (!isLogicalExpression(test) || test.operator !== "||") return null;
        const strict = (node: TYPE.Node): TYPE.BinaryExpression | null =>
            isBinaryExpressionNode(node) && node.operator === "===" ? node : null;
        const left = strict(test.left);
        const right = strict(test.right);
        if (!left || !right) return null;
        for (const [a, b] of [[left, right], [right, left]] as Array<[TYPE.BinaryExpression, TYPE.BinaryExpression]>) {
            if (isIdentifierNode(a.left) && isNullLiteralNode(a.right)
                && isIdentifierNode(b.left) && isIdentifierNode(b.right, { name: "undefined" })
                && a.left.name === b.left.name) {
                return a.left;
            }
        }
        return null;
    }

    private isAccUndefinedBreak(node:TYPE.Node):boolean {
        return isIfStatementNode(node)
            && isBinaryExpressionNode(node.test) && node.test.operator === "=="
            && isIdentifierNode(node.test.left) && node.test.left.name === "acc"
            && isIdentifierNode(node.test.right) && node.test.right.name === "undefined"
            && isBreakStatement(node.consequent);
    }

    /** acc[Symbol.iterator]() */
    private isSymbolIteratorCall(node:TYPE.Node):boolean {
        if (!isCallExpression(node) || !isMemberExpression(node.callee)) return false;
        const callee = node.callee;
        if (!callee.computed || !isMemberExpression(callee.property)) return false;
        return isIdentifierNode(callee.property.object) && callee.property.object.name === "Symbol"
            && isIdentifierNode(callee.property.property) && callee.property.property.name === "iterator";
    }

    private canTransform2questionMarkStatement(rawSwitchCase:Array<SwitchCaseDesc>):TYPE.Statement|null {
        if (rawSwitchCase.length != 2) return null;
        const case1:SwitchCaseDesc = rawSwitchCase[0];
        const case2:SwitchCaseDesc = rawSwitchCase[1];
        if (case1.body != null) return null;
        if (!case1.right.isNullLiteral()) return null;
        if (!isIdentifierNode(case2.right.node)) return null;
        if (case2.right.node.name !== 'undefined') return null;
        if (case2?.body.node.body.length != 1) return null;
        const statement = case2.body.node.body[0];
        if (isExpressionStatementNode(statement) && isAssignmentExpressionNode(statement.expression)){
            if (isIdentifierNode(statement.expression.left) && isIdentifierNode(case1.left.node)){
                if(statement.expression.left.name === case1.left.node.name) {
                    const assignmentExpression = assignmentExpressionBuilder("=", identifier(case1.left.node.name), logicalExpressionBuilder("??", identifier(case1.left.node.name), statement.expression.right));
                    return expressionStatement(assignmentExpression);
                }else {
                    const logicalExpression = logicalExpressionBuilder("??",case1.left.node,statement.expression);
                    return expressionStatement(logicalExpression);
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
                switchCases.push(switchCase(desc.right.node,[]))
                continue;
            }
            if (!isReturnStatementNode(desc.body.node.body[desc.body.node.body.length-1])){
                desc.body.node.body.push(breakStatement())
            }
            switchCases.push(switchCase(desc.right.node,desc.body.node.body))
        }
        const switchStatement = switchStatementBuilder(rawSwitchCase[0].left.node,switchCases)
        if (defaultBody != null){
            switchCases.push(switchCase(null,defaultBody))
        }
        value.replaceWith(switchStatement);
        return true;
    }

    private checkAndTransformToForStatement(value:NodePath<TYPE.WhileStatement>){
        const pre = value.getPrevSibling();
        if (!isExpressionStatementNode(pre.node)) return false;
        const test = value.get('test');
        if (!isBooleanLiteral(test.node)) return false;
        const body = value.get('body')
        if (!isBlockStatementNode(body.node)) return false;
        const bodyStatements = (body as NodePath<TYPE.BlockStatement>).get('body')
        if (bodyStatements.length < 2) return false;
        const first = bodyStatements[0];
        const last = bodyStatements[bodyStatements.length -1];
        if (!isExpressionStatementNode(last.node)) return false;
        if (!first.isIfStatement()) return false;
        const consequent = first.get('consequent');
        if (!isBreakStatement(consequent.node)) return false;
        //now transform it to for loop;
        const forBlock = blockStatementBuilder([])
        for (let i = 1; i < bodyStatements.length - 1; i++) {
            forBlock.body.push(bodyStatements[i].node);
        }
        const forTest = first.get('test').node
        if (!isBinaryExpressionNode(forTest)) return false;
        else forTest.operator = SyntaxRewriteSimplify.binaryInvert(forTest);
        const forStatement = forStatementBuilder(pre.node.expression,forTest,last.node.expression,forBlock)
        pre.remove();
        value.replaceWith(forStatement);
        return true;
    }


    private checkAndTransformToForInStatement(value:NodePath<TYPE.WhileStatement>){
        // acc = v9.next().value;
        // v10 = acc;
        // if (acc == undefined) break;
        const pre = value.getPrevSibling();
        if (!isExpressionStatementNode(pre.node)) return false;
        const test = value.get('test');
        if (!isBooleanLiteral(test.node)) return false;
        const body = value.get('body')
        if (!isBlockStatementNode(body.node)) return false;
        const bodyStatements = (body as NodePath<TYPE.BlockStatement>).get('body')
        if (bodyStatements.length < 3) return false;
        const a = bodyStatements[0];
        const b = bodyStatements[1];
        const c = bodyStatements[2];
        if (isExpressionStatementNode(a.node) && isAssignmentExpressionNode(a.node.expression) &&
            isNextValue(a.node.expression.right) && isIdentifierNode(a.node.expression.left) && a.node.expression.left.name === 'acc'){
            if (isExpressionStatementNode(b.node) && isAssignmentExpressionNode(b.node.expression)
                && isIdentifierNode(b.node.expression.right) && b.node.expression.right.name === 'acc'){
                const vv = b.node.expression.left  as TYPE.Identifier;
                if (this.isAccUndefinedBreak(c.node)){
                    const body = blockStatementBuilder(bodyStatements.slice(3,bodyStatements.length).map((value)=>{
                        return value.node;
                    }));
                    value.replaceWith(forInStatement(vv,identifier("reserved"),body));
                    return true;
                }
            }
        }
        return false;
    }
    /** `it = obj[Symbol.iterator]()` / `it = obj[Symbol.iterator]` 里的 obj。 */
    private iterableOfIteratorInit(expr: TYPE.Expression): TYPE.Expression | null {
        let callee: TYPE.Node = expr;
        if (isCallExpression(expr)) {
            if (expr.arguments.length > 0) return null;
            callee = expr.callee;
        }
        if (!isMemberExpression(callee) || !callee.computed) return null;
        const prop = callee.property;
        if (!isMemberExpression(prop) || prop.computed) return null;
        if (!isIdentifierNode(prop.object) || prop.object.name !== "Symbol") return null;
        if (!isIdentifierNode(prop.property) || prop.property.name !== "iterator") return null;
        return callee.object as TYPE.Expression;
    }

    /** `it.next()` 且 it 是指定迭代器变量。 */
    private isNextCallOf(expr: TYPE.Node | null | undefined, itName: string): boolean {
        if (!isCallExpression(expr) || expr.arguments.length !== 0) return false;
        const callee = expr.callee;
        return isMemberExpression(callee) && !callee.computed
            && isIdentifierNode(callee.object) && callee.object.name === itName
            && isIdentifierNode(callee.property) && callee.property.name === "next";
    }

    /** `X = X.value`(for-of 循环变量的绑定赋值,转换后应删除)。 */
    private isSelfValueAssignment(stmt: TYPE.Statement, name: string): boolean {
        if (!isExpressionStatementNode(stmt) || !isAssignmentExpressionNode(stmt.expression)) return false;
        const assign = stmt.expression;
        return assign.operator === "="
            && isIdentifierNode(assign.left) && assign.left.name === name
            && isMemberExpression(assign.right) && !assign.right.computed
            && isIdentifierNode(assign.right.object) && assign.right.object.name === name
            && isIdentifierNode(assign.right.property) && assign.right.property.name === "value";
    }

    /** 语句是否是无条件的 `name = ...`。 */
    private isDirectAssignmentTo(stmt: TYPE.Node, name: string): boolean {
        return isExpressionStatementNode(stmt)
            && isAssignmentExpressionNode(stmt.expression)
            && stmt.expression.operator === "="
            && isIdentifierNode(stmt.expression.left)
            && stmt.expression.left.name === name;
    }

    /**
     * 删除 `it = iterable[Symbol.iterator]()` 后,循环外的这次读取是否还能看到被删掉的值。
     *
     * 循环之前执行、或读取前一定先有 `name = ...` 覆盖(例如同一个临时迭代器被
     * 后续循环复用:`v13 = p1.keys()[Symbol.iterator]()` 后又读 `v13.next()`),
     * 都说明读取的不是被删除的初始化值。只沿读取自己的祖先块向前找直接赋值,
     * 保证“只要读到这一句,赋值就一定已经执行过”。
     */
    private hasNewerValueBefore(ref: NodePath, loop: NodePath<TYPE.WhileStatement>, name: string): boolean {
        // 闭包里的读取可能在循环执行期间被调用,无法按语句顺序判断,直接放弃。
        if (ref.getFunctionParent() !== loop.getFunctionParent()) return false;

        const loopAncestors = new Set<TYPE.Node>();
        for (let p: NodePath | null = loop; p; p = p.parentPath) loopAncestors.add(p.node);

        let refChild: NodePath = ref;
        let common: NodePath | null = null;
        for (let p: NodePath | null = ref; p; p = p.parentPath) {
            if (loopAncestors.has(p.node)) {
                common = p;
                break;
            }
            refChild = p;
        }
        if (!common || common.node === loop.node) return false;
        if (!isBlockStatementNode(common.node) && !isProgram(common.node)) return false;

        const body = common.node.body as TYPE.Node[];
        let loopChild: NodePath = loop;
        while (loopChild.parentPath && loopChild.parentPath.node !== common.node) {
            loopChild = loopChild.parentPath;
        }
        if (!loopChild.parentPath || loopChild.parentPath.node !== common.node) return false;
        const loopIndex = body.indexOf(loopChild.node);
        const refIndex = body.indexOf(refChild.node);
        if (loopIndex < 0 || refIndex < 0) return false;
        // 循环之前的读取不受删除初始化影响。
        if (refIndex < loopIndex) return true;
        if (refIndex === loopIndex) return false;

        // 从读取处向上逐层看同一语句块里是否有前置的直接赋值;
        // 最外层只认循环之后的赋值(循环前的会被本轮迭代覆盖)。
        let current: NodePath | null = ref;
        while (current && current.node !== common.node) {
            const parent = current.parentPath;
            if (!parent) return false;
            const siblings = (parent.node as { body?: TYPE.Node[] }).body;
            if (Array.isArray(siblings)) {
                const index = siblings.indexOf(current.node);
                if (index >= 0) {
                    const lower = parent.node === common.node ? loopIndex + 1 : 0;
                    for (let i = index - 1; i >= lower; i--) {
                        if (this.isDirectAssignmentTo(siblings[i], name)) return true;
                    }
                }
            }
            current = parent;
        }
        return false;
    }

    private checkAndTransformToForOfStatement(value:NodePath<TYPE.WhileStatement>){
        const pre = value.getPrevSibling();
        if (!isExpressionStatementNode(pre.node)) return false;
        const init = pre.node.expression;
        if (!isAssignmentExpressionNode(init) || init.operator !== "=" || !isIdentifierNode(init.left)) return false;
        const iterable = this.iterableOfIteratorInit(init.right as TYPE.Expression);
        if (!iterable) return false;
        const iterBinding = value.scope.getBinding(init.left.name);
        if (!iterBinding) return false;

        const test = value.get('test');
        if (!isBooleanLiteral(test.node)) return false;
        const body = value.get('body')
        if (!isBlockStatementNode(body.node)) return false;
        const bodyStatements = (body as NodePath<TYPE.BlockStatement>).get('body')
        if (bodyStatements.length < 3) return false;
        // body[0] 必须是 `vv = it.next()`
        const nextStatement = bodyStatements[0].node;
        if (!isExpressionStatementNode(nextStatement) || !isAssignmentExpressionNode(nextStatement.expression)) return false;
        const nextAssign = nextStatement.expression;
        if (nextAssign.operator !== "=" || !isIdentifierNode(nextAssign.left)
            || !this.isNextCallOf(nextAssign.right, init.left.name)) return false;
        // 转换会删掉 `it = obj[Symbol.iterator]()`;循环体内不能再读取迭代器临时量。
        // ArkTS 会在提前 return 的分支里内联 `it.return()` 收尾,转换后 it 已不再赋值,
        // 保留这些读取会变成对 undefined 取属性。循环之后的读取只有在确定先被新的
        // `it = ...` 覆盖时才安全(编译器会复用同一个临时迭代器连续写多个 while)。
        const nextCall = nextAssign.right as TYPE.CallExpression;
        const iterObjectNode = (nextCall.callee as TYPE.MemberExpression).object;
        for (const ref of iterBinding.referencePaths) {
            if (!ref.node || ref.node === iterObjectNode) continue;
            if (ref.findParent((parent) => parent.node === value.node)) return false;
            if (!this.hasNewerValueBefore(ref, value, init.left.name)) return false;
        }
        // 循环体内改写迭代器会改变下一次 next() 的对象,for-of 无法保留这种语义。
        for (const violation of iterBinding.constantViolations) {
            if (!violation.node) continue;
            if (violation.findParent((parent) => parent.node === value.node)) return false;
            if (violation.getFunctionParent() !== value.getFunctionParent()) return false;
        }
        const vv = nextAssign.left as TYPE.Identifier;
        if (vv.name === init.left.name) return false;
        // for-of 循环结束后循环变量留在“最后一个元素”上,而 while 形态停在 done 结果对象;
        // 循环外的读取必须是被后续 `vv = ...` 覆盖后的新值(同样支持临时变量复用)。
        const valueBinding = value.scope.getBinding(vv.name);
        if (valueBinding) {
            for (const ref of valueBinding.referencePaths) {
                if (!ref.node) continue;
                if (ref.findParent((parent) => parent.node === value.node)) continue;
                if (!this.hasNewerValueBefore(ref, value, vv.name)) return false;
            }
        }

        const outStatement = bodyStatements[1];
        if (!outStatement.isIfStatement()) return false;
        const btest = outStatement.get('test');
        const consequent = outStatement.get('consequent');
        if (!isBreakStatement(consequent.node)) return false;
        if (!isDoneMember(btest.node)) return false;
        const doneObject = (btest.node as TYPE.MemberExpression).object;
        if (!isIdentifierNode(doneObject) || doneObject.name !== vv.name) return false;

        // `vv = vv.value` 由 for-of 的循环变量赋值替代。先判定再替换,
        // 否则 `vv.value` 已被改写后这条赋值就认不出来了。
        const skipSelfValueAssignment = this.isSelfValueAssignment(bodyStatements[2].node, vv.name);
        // 只替换迭代器结果对象自己的 `.value`,循环体里其它对象的 `.value` 保持不变。
        // 必须在仍挂在 AST 上的 body 路径上遍历:对脱离树的 blockStatement 单独调用 traverse
        // 会因 parentPath 缺失使 scope 链断在非 Program 节点(crawl 时 programParent 为 undefined)。
        body.traverse({
           MemberExpression:(path)=>{
               if (path.node.computed) return;
               if (!isIdentifierNode(path.node.object) || path.node.object.name !== vv.name) return;
               if (!isIdentifierNode(path.node.property) || path.node.property.name !== "value") return;
               path.replaceWith(identifier(vv.name));
           }
        });
        const arr:TYPE.Statement[] = [];
        for (let i = 2; i < bodyStatements.length; i++) {
            if (i === 2 && skipSelfValueAssignment) continue;
            arr.push(bodyStatements[i].node);
        }
        const blockStatement = blockStatementBuilder(arr);
        const forOfStatement = forOfStatementBuilder(vv,iterable as any,blockStatement);
        value.replaceWith(forOfStatement);
        pre.remove();
        return true;
    }

    /** test 去掉偶数个 `!` 后是标识符时返回名字;`!X`(奇数次)返回 null。 */
    private loopTestSimpleName(test: TYPE.Expression): string | null {
        let expr: TYPE.Expression = test;
        let negated = false;
        while (TYPE.isUnaryExpression(expr) && expr.operator === "!") {
            negated = !negated;
            expr = expr.argument as TYPE.Expression;
        }
        return !negated && isIdentifierNode(expr) ? expr.name : null;
    }

    /**
     * 还原“提前 return 的 for...of”被 lower 成的 do-while:
     *
     *   it = arr[Symbol.iterator]();
     *   do {
     *     v = it.next();
     *     if (v.done) return true;
     *     ...;                       // 含 if (acc) continue;
     *     acc = ...;                 // 循环 test 的物化
     *   } while (acc);
     *   close(it);
     *   return false;
     *
     * → for (const v of arr) {
     *     ...;
     *     if (!acc) return false;    // 原来的循环出口
     *   }
     *   return true;
     *
     * 与 while(true)+break 形态不同,这里的 done 分支 return 的是循环正常结束值,
     * 循环 test 为假则走循环后的 return。只有 continue 的守卫能保证 test 在 continue
     * 路径上为真时才转换,否则 for-of 的 continue 会跳过附加的出口判断。
     */
    private checkAndTransformDoWhileToForOfStatement(value: NodePath<TYPE.DoWhileStatement>): boolean {
        const testName = this.loopTestSimpleName(value.node.test);
        if (testName === null) return false;

        // 循环前紧邻的可能还有不读取迭代器的临时初始化(如 `acc = false`),
        // 向后找到真正的 `it = arr[Symbol.iterator]()` 即可,这些语句保留在原位。
        let initPath: NodePath | null = value.getPrevSibling();
        let init: TYPE.AssignmentExpression | null = null;
        let iterable: TYPE.Expression | null = null;
        for (let skipped = 0; initPath && skipped < 4; skipped++) {
            if (!isExpressionStatementNode(initPath.node) || !isAssignmentExpressionNode(initPath.node.expression)) break;
            const candidate = initPath.node.expression;
            if (!isIdentifierNode(candidate.left)) break;
            const candidateIterable = this.iterableOfIteratorInit(candidate.right as TYPE.Expression);
            if (candidateIterable) {
                init = candidate;
                iterable = candidateIterable;
                break;
            }
            // 只允许跨过不读取任何名字的简单常量初始化。
            if (isBooleanLiteral(candidate.right) || isNullLiteralNode(candidate.right)
                || (isIdentifierNode(candidate.right) && candidate.right.name === "undefined")) {
                initPath = initPath.getPrevSibling();
                continue;
            }
            break;
        }
        if (!init || !iterable || !initPath) return false;
        const iterName = (init.left as TYPE.Identifier).name;
        const iterBinding = value.scope.getBinding(iterName);
        if (!iterBinding) return false;

        const body = value.get('body');
        if (!isBlockStatementNode(body.node)) return false;
        const bodyStatements = (body as NodePath<TYPE.BlockStatement>).get('body');
        if (bodyStatements.length < 3) return false;

        // body[0]: vv = it.next()
        const nextStatement = bodyStatements[0].node;
        if (!isExpressionStatementNode(nextStatement) || !isAssignmentExpressionNode(nextStatement.expression)) return false;
        const nextAssign = nextStatement.expression;
        if (nextAssign.operator !== "=" || !isIdentifierNode(nextAssign.left)
            || !this.isNextCallOf(nextAssign.right, iterName)) return false;
        const vv = nextAssign.left;
        if (vv.name === iterName) return false;

        // body[1]: if (vv.done) return <常量>
        const doneStmt = bodyStatements[1];
        if (!doneStmt.isIfStatement() || doneStmt.node.alternate) return false;
        const doneTest = doneStmt.get('test');
        if (!isDoneMember(doneTest.node)) return false;
        const doneObject = (doneTest.node as TYPE.MemberExpression).object;
        if (!isIdentifierNode(doneObject) || doneObject.name !== vv.name) return false;
        const doneConsequent = doneStmt.get('consequent');
        let doneReturn: TYPE.Expression | null = null;
        if (doneConsequent.isReturnStatement() && doneConsequent.node.argument) {
            doneReturn = doneConsequent.node.argument;
        } else if (doneConsequent.isBlockStatement() && doneConsequent.node.body.length === 1) {
            const only = doneConsequent.node.body[0];
            if (isReturnStatementNode(only) && only.argument) doneReturn = only.argument;
        }
        // 循环结束值会被搬到循环之后,只接受常量,避免依赖循环内被修改的状态。
        if (!doneReturn || !isBooleanLiteral(doneReturn)) return false;

        // 循环后的 iterator.close + return <常量>
        const extras: NodePath<TYPE.Statement>[] = [];
        let cursor = value.getNextSibling();
        while (cursor && cursor.isIfStatement() && collectIdentifierNames(cursor.node).has(iterName)) {
            extras.push(cursor as NodePath<TYPE.Statement>);
            cursor = cursor.getNextSibling();
        }
        if (extras.length === 0 || !cursor || !cursor.isReturnStatement()) return false;
        const exitPath = cursor as NodePath<TYPE.ReturnStatement>;
        if (!exitPath.node.argument || !isBooleanLiteral(exitPath.node.argument)) return false;
        const exitReturn = exitPath.node.argument;

        // 转换后 it/vv 都不再存在:it 只能出现在 init/next()/close 里,
        // vv 只能在循环体内使用。
        const iterObjectNode = ((nextAssign.right as TYPE.CallExpression).callee as TYPE.MemberExpression).object;
        for (const ref of iterBinding.referencePaths) {
            if (!ref.node || ref.node === iterObjectNode) continue;
            if (extras.some((e) => ref.findParent((parent) => parent.node === e.node))) continue;
            return false;
        }
        for (const violation of iterBinding.constantViolations) {
            if (!violation.node || violation.node === init) continue;
            return false;
        }
        const valueBinding = value.scope.getBinding(vv.name);
        if (valueBinding) {
            for (const ref of valueBinding.referencePaths) {
                if (!ref.node) continue;
                if (!ref.findParent((parent) => parent.node === value.node)) return false;
            }
        }

        // 循环 test 在 continue 路径上必须为真,否则附加的出口判断会被跳过。
        let valid = true;
        body.traverse({
            Function: (p) => p.skip(),
            ContinueStatement: (p) => {
                const owner = p.findParent((parent) => parent.isWhileStatement() || parent.isDoWhileStatement()
                    || parent.isForStatement() || parent.isForInStatement() || parent.isForOfStatement());
                if (!owner || owner.node !== value.node) return;
                let child: NodePath = p;
                let parent = p.parentPath;
                while (parent && parent.isBlockStatement()) {
                    child = parent;
                    parent = parent.parentPath;
                }
                if (!parent || !parent.isIfStatement() || parent.node.alternate
                    || child.node !== parent.node.consequent
                    || this.loopTestSimpleName(parent.node.test) !== testName) {
                    valid = false;
                    p.stop();
                }
            },
            BreakStatement: (p) => {
                const owner = p.findParent((parent) => parent.isWhileStatement() || parent.isDoWhileStatement()
                    || parent.isForStatement() || parent.isForInStatement() || parent.isForOfStatement()
                    || parent.isSwitchStatement());
                if (!owner || owner.node !== value.node) return;
                valid = false;
                p.stop();
            },
        });
        if (!valid) return false;

        // 只替换迭代器结果对象自己的 .value。
        body.traverse({
            MemberExpression: (path) => {
                if (path.node.computed) return;
                if (!isIdentifierNode(path.node.object) || path.node.object.name !== vv.name) return;
                if (!isIdentifierNode(path.node.property) || path.node.property.name !== "value") return;
                path.replaceWith(identifier(vv.name));
            },
        });

        const arr: TYPE.Statement[] = [];
        for (let i = 2; i < bodyStatements.length; i++) arr.push(bodyStatements[i].node);
        arr.push(TYPE.ifStatement(
            unaryExpressionBuilder("!", identifier(testName)),
            returnStatementBuilder(exitReturn)));
        const forOfStatement = forOfStatementBuilder(vv, iterable as TYPE.Expression, blockStatementBuilder(arr));

        for (const extra of extras) extra.remove();
        exitPath.remove();
        value.replaceWith(forOfStatement);
        value.insertAfter(returnStatementBuilder(doneReturn));
        initPath.remove();
        return true;
    }

    simplify(node: Program): boolean {
        let changed = false;
        traverse(file(node), {
            //transform while-statement to for-statement
            WhileStatement:(value)=>{
                if (this.checkAndTransformToForStatement(value)) changed = true;
                if (this.checkAndTransformToForInStatement(value)) changed = true;
                if (this.checkAndTransformToForOfStatement(value)) changed = true;
            },
            DoWhileStatement:{
                exit:(value)=>{
                    if (this.checkAndTransformDoWhileToForOfStatement(value)) changed = true;
                },
            },
            IfStatement:{
                // 用 exit 自底向上折叠:嵌套 if / else-if 先折成赋值语句,
                // 外层再与其合成三目(`if (!p2) {...} else if (B) { X = a } else { X = b }`)。
                exit:(value)=>{
                    if (this.checkAndTransformToConditionalExpression(value)) changed = true;
                },
            },
            ForInStatement:(value)=>{
                if (isIdentifierNode(value.node.right) && value.node.right.name === 'reserved'){
                    let node = value.getPrevSibling().node;
                    if (isExpressionStatementNode(node)){
                        node = node.expression
                    }
                    if(isAssignmentExpressionNode(node)){
                        node = node.right
                    }
                    if (this.isSymbolIteratorCall(node)){
                        const callee = (node as TYPE.CallExpression).callee
                        const callexp = (callee as TYPE.MemberExpression).object as TYPE.CallExpression
                        const id = callexp.arguments[0] as TYPE.Identifier
                        if (isIdentifierNode(id)) {
                            value.get('right').replaceWith(id)
                            value.getPrevSibling().remove();
                            changed = true;
                        }
                    }
                }
            },
            ConditionalExpression:(value)=>{
                // 把 `x == null ? undefined : x.prop` / `x === null || x === undefined ? undefined : x.prop`
                // 还原成 `x?.prop`。test 可能已被 SyntaxRewriteSimplify 合并成 `== null`。
                const conditionalNode = value.node;
                const target = this.nullishGuardTarget(conditionalNode.test);
                if (!target) return;
                const consequent = conditionalNode.consequent;
                if (!isIdentifierNode(consequent) || consequent.name !== 'undefined') return;
                const optionalChain = this.makeOptionalChain(conditionalNode.alternate, target.name);
                if (!optionalChain) return;
                value.replaceWith(optionalChain);
                changed = true;
            }
        })

        traverse(file(node), {
            IfStatement:(value)=>{
                // transform to switch case expression
                if (this.checkAndTransformToSwitchCase(value)) changed = true;
            }
        })
        return changed;
    }
}