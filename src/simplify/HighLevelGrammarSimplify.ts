import { Program } from "@babel/types";
import {ISimplify} from "./ISimplify";
import * as TYPE from "@babel/types";
import traverse, {NodePath} from "@babel/traverse";
import {SyntaxRewriteSimplify} from "./SyntaxRewriteSimplify";
import {collectIdentifierNames, isDoneMember, isNextValue, isNodeEqual, isPureExpression, walkNode} from "./AstUtils";


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
    isDoWhileStatement: isDoWhileStatementNode,
    isExpressionStatement: isExpressionStatementNode,
    isForInStatement: isForInStatementNode,
    isForOfStatement: isForOfStatementNode,
    isForStatement: isForStatementNode,
    isIdentifier: isIdentifierNode,
    isIfStatement: isIfStatementNode,
    isLabeledStatement: isLabeledStatementNode,
    isNullLiteral: isNullLiteralNode,
    isReturnStatement: isReturnStatementNode,
    isSwitchStatement: isSwitchStatementNode,
    isTryStatement: isTryStatementNode,
    isVariableDeclaration: isVariableDeclarationNode,
    isWhileStatement: isWhileStatementNode,
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
     * makeOptionalChain 的按结构匹配版本:consequent 里与守卫表达式相同的链根
     * (不一定是标识符,如 `p0.contents`)变成可选访问。守卫与链根必须是
     * isNodeEqual 的同一段纯表达式,避免把不同求值合并到一起。
     */
    private makeGuardedOptionalChain(chain: TYPE.Expression, guard: TYPE.Expression): TYPE.Expression | null {
        if (!isMemberExpression(chain) || chain.optional) return null;
        if (isNodeEqual(chain.object, guard)) {
            return optionalMemberExpression(chain.object as TYPE.Expression, chain.property as TYPE.Expression, chain.computed, true);
        }
        const inner = this.makeGuardedOptionalChain(chain.object, guard);
        if (!inner) return null;
        return optionalMemberExpression(inner, chain.property as TYPE.Expression, chain.computed, false);
    }

    /** 可选链守卫候选:标识符,或各部分都纯的成员链(`p0.contents`)。 */
    private isOptionalChainGuard(expr: TYPE.Expression): boolean {
        if (isIdentifierNode(expr)) return true;
        if (!isMemberExpression(expr) || expr.optional) return false;
        return this.isSideEffectFreeExpression(expr.object)
            && (!expr.computed || this.isSideEffectFreeExpression(expr.property as TYPE.Expression));
    }

    /** 不含调用/赋值/函数等有副作用的子表达式(成员装载、字面量、普通运算都算纯)。 */
    private isSideEffectFreeExpression(expr: TYPE.Node): boolean {
        switch (expr.type) {
            case "CallExpression":
            case "NewExpression":
            case "AssignmentExpression":
            case "UpdateExpression":
            case "FunctionExpression":
            case "ArrowFunctionExpression":
            case "ClassExpression":
            case "AwaitExpression":
            case "YieldExpression":
            case "TaggedTemplateExpression":
            case "OptionalCallExpression":
                return false;
            case "UnaryExpression":
                return expr.operator !== "delete";
            case "MemberExpression":
                if (expr.optional) return false;
                break;
        }
        for (const key of TYPE.VISITOR_KEYS[expr.type] ?? []) {
            const child = (expr as unknown as Record<string, unknown>)[key];
            if (Array.isArray(child)) {
                for (const c of child) {
                    if (c && typeof (c as TYPE.Node).type === "string" && !this.isSideEffectFreeExpression(c as TYPE.Node)) return false;
                }
            } else if (child && typeof (child as TYPE.Node).type === "string") {
                if (!this.isSideEffectFreeExpression(child as TYPE.Node)) return false;
            }
        }
        return true;
    }

    /**
     * 把两类 nullish/真值守卫三目还原成可选链:
     *
     *   1. `x == null ? undefined : x.prop`(ArkTS 的 nullish lowering,或已被
     *      SyntaxRewriteSimplify 合并成 `x == null` 的形态)
     *   2. `guard ? guard.prop : undefined` —— ArkTS 编译器在类型系统保证守卫值
     *      是对象或 nullish 时,对 `?.` 使用的真值 lowering。此时两种写法对对象
     *      与 nullish 值严格等价;仅当守卫是假值原始数(0/""/false)且包装对象上
     *      恰好存在同名属性时有差异,恢复成 `?.` 同时把守卫的两次求值合并成一次。
     *
     * 该形态由结构化归约与尾部条件折叠在 HighLevelGrammarSimplify 主遍历之后
     * 才物化出来,simplifyTail() 会在流水线末尾再跑一次本方法。
     */
    private tryRestoreOptionalChain(value: NodePath<TYPE.ConditionalExpression>): boolean {
        const conditionalNode = value.node;
        const nullishTarget = this.nullishGuardTarget(conditionalNode.test);
        if (nullishTarget) {
            if (!isIdentifierNode(conditionalNode.consequent) || conditionalNode.consequent.name !== 'undefined') return false;
            const optionalChain = this.makeOptionalChain(conditionalNode.alternate, nullishTarget.name);
            if (!optionalChain) return false;
            value.replaceWith(optionalChain);
            return true;
        }
        if (!isIdentifierNode(conditionalNode.alternate) || conditionalNode.alternate.name !== 'undefined') return false;
        if (!this.isOptionalChainGuard(conditionalNode.test)) return false;
        const optionalChain = this.makeGuardedOptionalChain(conditionalNode.consequent, conditionalNode.test);
        if (!optionalChain) return false;
        value.replaceWith(optionalChain);
        return true;
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
    private hasNewerValueBefore(ref: NodePath, loop: NodePath<TYPE.Statement>, name: string): boolean {
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
        if (loopIndex < 0) return false;
        const refIndex = body.indexOf(refChild.node);
        // ref 所在语句已在此前的改写(如 foldHoistedIteratorNext / 死枢纽折叠)中
        // 删除:绑定里的 referencePaths 不会随之清理,但这条语句不会再执行,
        // 不影响“删除初始化后读取是否还可见”的判断。
        if (refIndex < 0) return true;
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

    /**
     * 归一化 ArkTS 对 for-of 的另一种 lowering:把 `it.next` 提升成临时方法量,
     * 循环里用 `next.call(it)` 调用:
     *
     *   v21 = acc;          // 迭代器别名(G = H)
     *   v20 = acc.next;     // 提升的方法量(F = H.next / G.next)
     *   while (true) { v22 = v20.call(v21); ... }
     *
     * → 删掉两条前置语句,循环首语句改写成 `v22 = H.next()`,
     *   让 checkAndTransformToForOfStatement 能按标准形态识别。
     *   F/G 在被删语句与该调用之外还有任何引用(如提前 return 分支内联的
     *   `it.return()`)时保持原样,避免悬空引用。
     */
    private foldHoistedIteratorNext(value: NodePath<TYPE.WhileStatement>): void {
        const body = value.get('body');
        if (!isBlockStatementNode(body.node)) return;
        const bodyStatements = (body as NodePath<TYPE.BlockStatement>).get('body');
        if (bodyStatements.length === 0) return;
        // 循环首语句必须是 `vv = F.call(G)`,F/G 都是标识符且互不相同。
        const first = bodyStatements[0].node;
        if (!isExpressionStatementNode(first) || !isAssignmentExpressionNode(first.expression)) return;
        const assign = first.expression;
        if (assign.operator !== "=" || !isIdentifierNode(assign.left)) return;
        const call = assign.right;
        if (!isCallExpression(call) || call.arguments.length !== 1) return;
        if (!isMemberExpression(call.callee) || call.callee.computed) return;
        if (!isIdentifierNode(call.callee.property) || call.callee.property.name !== "call") return;
        if (!isIdentifierNode(call.callee.object) || !isIdentifierNode(call.arguments[0])) return;
        const fnTemp = call.callee.object.name;
        const iterAlias = (call.arguments[0] as TYPE.Identifier).name;
        const vvName = assign.left.name;
        if (fnTemp === iterAlias || fnTemp === vvName || iterAlias === vvName) return;
        // 前一条:`F = G.next` 或 `F = H.next`(H 是迭代器本体)。
        const prevFn = value.getPrevSibling();
        if (!prevFn.isExpressionStatement() || !isAssignmentExpressionNode(prevFn.node.expression)) return;
        const fnAssign = prevFn.node.expression as TYPE.AssignmentExpression;
        if (fnAssign.operator !== "=" || !isIdentifierNode(fnAssign.left) || fnAssign.left.name !== fnTemp) return;
        if (!isMemberExpression(fnAssign.right) || fnAssign.right.computed) return;
        if (!isIdentifierNode(fnAssign.right.property) || fnAssign.right.property.name !== "next") return;
        if (!isIdentifierNode(fnAssign.right.object)) return;
        const nextObject = fnAssign.right.object.name;
        // 再前一条有两种形态:
        //   1) `G = H`,H 是标识符;再前一条是 `H = X[Symbol.iterator]()`;
        //   2) 别名已被累加器折叠:直接 `G = X[Symbol.iterator]()`(G 就是迭代器本体)。
        const prevAlias = prevFn.getPrevSibling();
        if (!prevAlias.isExpressionStatement() || !isAssignmentExpressionNode(prevAlias.node.expression)) return;
        const aliasAssign = prevAlias.node.expression as TYPE.AssignmentExpression;
        if (aliasAssign.operator !== "=" || !isIdentifierNode(aliasAssign.left) || aliasAssign.left.name !== iterAlias) return;
        let iterName: string;
        let aliasStatement: NodePath | null = prevAlias;
        if (isIdentifierNode(aliasAssign.right)) {
            iterName = aliasAssign.right.name;
            if (iterName === iterAlias || iterName === fnTemp || iterName === vvName) return;
            if (nextObject !== iterAlias && nextObject !== iterName) return;
            // 再前一条:`H = X[Symbol.iterator]()`。
            const init = prevAlias.getPrevSibling();
            if (!init.isExpressionStatement() || !isAssignmentExpressionNode(init.node.expression)) return;
            const initAssign = init.node.expression as TYPE.AssignmentExpression;
            if (initAssign.operator !== "=" || !isIdentifierNode(initAssign.left) || initAssign.left.name !== iterName) return;
            if (!this.iterableOfIteratorInit(initAssign.right as TYPE.Expression)) return;
        } else {
            // 折叠形态:G 直接由 `X[Symbol.iterator]()` 初始化,没有单独的别名语句可删。
            if (nextObject !== iterAlias) return;
            if (!this.iterableOfIteratorInit(aliasAssign.right as TYPE.Expression)) return;
            iterName = iterAlias;
            aliasStatement = null;
        }
        // F / G 除这里的定义与调用外不能再有其它引用,否则删除会破坏它们。
        const fnBinding = value.scope.getBinding(fnTemp);
        const aliasBinding = value.scope.getBinding(iterAlias);
        if (!fnBinding || !aliasBinding) return;
        for (const ref of fnBinding.referencePaths) {
            if (ref.node === call.callee.object) continue;
            return;
        }
        for (const violation of fnBinding.constantViolations) {
            if (violation.node === fnAssign || violation.node === prevFn.node) continue;
            return;
        }
        for (const ref of aliasBinding.referencePaths) {
            if (ref.node === call.arguments[0] || ref.node === fnAssign.right.object) continue;
            return;
        }
        for (const violation of aliasBinding.constantViolations) {
            if (violation.node === aliasAssign || violation.node === prevAlias.node) continue;
            return;
        }
        // `vv = F.call(G)` → `vv = H.next()`;删掉两条前置语句。
        bodyStatements[0].get('expression').replaceWith(
            assignmentExpressionBuilder(
                "=",
                TYPE.identifier(vvName),
                TYPE.callExpression(
                    TYPE.memberExpression(TYPE.identifier(iterName), TYPE.identifier("next")),
                    []
                )
            )
        );
        prevFn.remove();
        if (aliasStatement) aliasStatement.remove();
    }

    private checkAndTransformToForOfStatement(value:NodePath<TYPE.WhileStatement>){
        this.foldHoistedIteratorNext(value);
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
        // 绑定里的 referencePaths / constantViolations 可能指向早先被替换掉的表达式
        // (如 `v20.call(v21)` → `v21.next()`),这些节点的 parentPath 链是陈旧的,
        // findParent 会误判成“仍在循环体内”。按当前 AST 的实际节点集合判断:
        // 已经不在函数子树里的读写不会再执行,直接跳过。
        const functionRoot = value.getFunctionParent() ?? value;
        const liveNodes = new Set<TYPE.Node>();
        walkNode(functionRoot.node, (node) => {
            liveNodes.add(node);
            return true;
        });
        const loopNodes = new Set<TYPE.Node>();
        walkNode(value.node, (node) => {
            loopNodes.add(node);
            return true;
        });
        for (const ref of iterBinding.referencePaths) {
            if (!ref.node || ref.node === iterObjectNode) continue;
            if (!liveNodes.has(ref.node)) continue;
            if (loopNodes.has(ref.node)) return false;
            if (!this.hasNewerValueBefore(ref, value, init.left.name)) return false;
        }
        // 循环体内改写迭代器会改变下一次 next() 的对象,for-of 无法保留这种语义。
        for (const violation of iterBinding.constantViolations) {
            if (!violation.node || !liveNodes.has(violation.node)) continue;
            if (loopNodes.has(violation.node)) return false;
            if (violation.getFunctionParent() !== value.getFunctionParent()) return false;
        }
        const vv = nextAssign.left as TYPE.Identifier;
        if (vv.name === init.left.name) return false;
        // for-of 循环结束后循环变量留在“最后一个元素”上,而 while 形态停在 done 结果对象;
        // 循环外的读取必须是被后续 `vv = ...` 覆盖后的新值(同样支持临时变量复用)。
        const valueBinding = value.scope.getBinding(vv.name);
        if (valueBinding) {
            for (const ref of valueBinding.referencePaths) {
                if (!ref.node || !liveNodes.has(ref.node)) continue;
                if (loopNodes.has(ref.node)) continue;
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
        this.tryInlineForOfIterable(value);
        return true;
    }

    /**
     * for-of 还原后,若迭代器初始化前一条语句是 `X = E` 且 X 的值只为迭代器供值,
     * 把 E 内联进 for-of 头部并删掉该语句:
     *
     *   acc = v9 ? v9.contents : [];
     *   acc = acc[Symbol.iterator]();
     *   for (v22 of acc) ...
     * → for (v22 of v9 ? v9.contents : []) ...
     *
     * 要求:E 自身不读取 X;循环体内不读 X(写也不行,保守起见);循环外的读取
     * 必须先有新的 `X = ...` 覆盖(hasNewerValueBefore,含闭包外的语句序检查)。
     */
    private tryInlineForOfIterable(value: NodePath): void {
        const prev = value.getPrevSibling();
        if (!prev.isExpressionStatement() || !isAssignmentExpressionNode(prev.node.expression)) return;
        const assign = prev.node.expression as TYPE.AssignmentExpression;
        if (assign.operator !== "=" || !isIdentifierNode(assign.left)) return;
        const hub = assign.left.name;
        const right = value.get('right');
        if (!right.isIdentifier() || right.node.name !== hub) return;
        const binding = value.scope.getBinding(hub);
        if (!binding) return;
        const init = assign.right;
        // E 里不能读 X:删掉 `X = E` 后 for-of 头部读到的是旧值。
        let readsHub = false;
        walkNode(init as TYPE.Node, (node) => {
            if (isIdentifierNode(node) && node.name === hub) {
                readsHub = true;
                return false;
            }
            return true;
        });
        if (readsHub) return;
        const functionParent = value.getFunctionParent();
        for (const ref of binding.referencePaths) {
            if (!ref.node) continue;
            // for-of 头部自己的 `of X` 也是 X 的读取,内联后随之消失,不参与检查。
            if (ref.node === right.node) continue;
            if (ref.findParent((parent) => parent.node === value.node)) return;
            if (ref.getFunctionParent() !== functionParent) return;
            if (!this.hasNewerValueBefore(ref, value as NodePath<TYPE.Statement>, hub)) return;
        }
        for (const violation of binding.constantViolations) {
            if (!violation.node) continue;
            if (violation.findParent((parent) => parent.node === value.node)) return;
            if (violation.getFunctionParent() !== functionParent) return;
        }
        right.replaceWith(TYPE.cloneNode(init));
        prev.remove();
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

    /**
     * `X = E; Y = X` 死枢纽拷贝折叠:结构化归约以累加器为枢纽生成
     * `acc = <成员链>; v14 = acc; acc = v14?.tabs; v15 = acc; ...`,
     * 可选链还原后这些拷贝就是纯粹的死枢纽。仅当三条件成立时折叠成 `Y = E`:
     * E 纯(无调用/赋值/函数,搬移无副作用)、拷贝紧邻、且再下一条语句就是
     * 对 X 的无条件写入(保证 X 的旧值此后不会被读到,也不存在语句间的闭包触发)。
     */
    private foldDeadHubCopies(node: Program): boolean {
        let changed = false;
        const foldList = (body: TYPE.Statement[]) => {
            let i = 0;
            while (i + 2 < body.length) {
                const a = body[i];
                const b = body[i + 1];
                if (!isExpressionStatementNode(a) || !isAssignmentExpressionNode(a.expression)
                    || !isExpressionStatementNode(b) || !isAssignmentExpressionNode(b.expression)) {
                    i++;
                    continue;
                }
                const assignA = a.expression;
                const assignB = b.expression;
                if (assignA.operator !== "=" || assignB.operator !== "="
                    || !isIdentifierNode(assignA.left) || !isIdentifierNode(assignB.left)
                    || !isIdentifierNode(assignB.right)) {
                    i++;
                    continue;
                }
                const hub = assignA.left.name;
                if (assignB.right.name !== hub || assignB.left.name === hub) {
                    i++;
                    continue;
                }
                const next = body[i + 2];
                if (!next || !this.isDirectAssignmentTo(next, hub)) {
                    i++;
                    continue;
                }
                if (!this.isSideEffectFreeExpression(assignA.right)) {
                    i++;
                    continue;
                }
                // `X = E; Y = X;` → `Y = E;`(删掉 X 的死写入)
                body.splice(i, 1, expressionStatement(assignmentExpressionBuilder("=", assignB.left, assignA.right)));
                body.splice(i + 1, 1);
                changed = true;
                // 新语句还可能与后续构成新的拷贝对(连续枢纽),原地重查。
            }
        };
        traverse(file(node), {
            Program: (value) => foldList(value.node.body),
            BlockStatement: (value) => foldList(value.node.body),
        });
        return changed;
    }

    /**
     * 清理“整个作用域里只剩声明自身”的临时变量声明(`let v7, v8, ..., acc;`)。
     * TempVariableSimplify 的声明清理在定点迭代里执行,看不到 simplifyTail
     * 删除迭代器/枢纽拷贝后失去最后使用者的残留(如 for-of 还原后的
     * v20/v21/acc)。按整个函数子树(含嵌套函数,闭包里的同名出现会让声明
     * 被保守保留)统计出现次数,只有确实只剩声明本身、且无 init 或 init 纯
     * 时才删;只处理 `vN` / `acc` 这类反编译器生成的临时名。
     */
    private removeUnusedTempDeclarations(node: Program): void {
        const isTempName = (name: string): boolean => /^(v\d+|acc)$/.test(name);
        const cleanScope = (body: TYPE.Statement[]): void => {
            const nameCount = new Map<string, number>();
            for (const stmt of body) {
                walkNode(stmt, (n) => {
                    if (isIdentifierNode(n)) nameCount.set(n.name, (nameCount.get(n.name) ?? 0) + 1);
                    return true;
                });
            }
            const cleanList = (list: TYPE.Statement[]): void => {
                for (let i = 0; i < list.length; i++) {
                    const stmt = list[i];
                    if (isVariableDeclarationNode(stmt) && stmt.kind === "let") {
                        const kept = stmt.declarations.filter((declarator) => {
                            if (!isIdentifierNode(declarator.id)) return true;
                            const name = declarator.id.name;
                            if (!isTempName(name)) return true;
                            if ((nameCount.get(name) ?? 0) > 1) return true;
                            if (declarator.init && !isPureExpression(declarator.init)) return true;
                            return false;
                        });
                        if (kept.length === 0) {
                            list.splice(i--, 1);
                        } else if (kept.length !== stmt.declarations.length) {
                            stmt.declarations = kept;
                        }
                        continue;
                    }
                    // 只在同一作用域内下钻;嵌套函数是独立作用域,由各自的访问器入口处理。
                    if (isBlockStatementNode(stmt)) cleanList(stmt.body);
                    else if (isLabeledStatementNode(stmt)) cleanList([stmt.body]);
                    else if (isIfStatementNode(stmt)) {
                        if (isBlockStatementNode(stmt.consequent)) cleanList(stmt.consequent.body);
                        if (stmt.alternate && isBlockStatementNode(stmt.alternate)) cleanList(stmt.alternate.body);
                    } else if (isForOfStatementNode(stmt) || isForInStatementNode(stmt) || isForStatementNode(stmt)) {
                        if (isBlockStatementNode(stmt.body)) cleanList(stmt.body.body);
                    } else if (isWhileStatementNode(stmt)) {
                        if (isBlockStatementNode(stmt.body)) cleanList(stmt.body.body);
                    } else if (isDoWhileStatementNode(stmt)) {
                        if (isBlockStatementNode(stmt.body)) cleanList(stmt.body.body);
                    } else if (isTryStatementNode(stmt)) {
                        if (isBlockStatementNode(stmt.block)) cleanList(stmt.block.body);
                        if (stmt.handler && isBlockStatementNode(stmt.handler.body)) cleanList(stmt.handler.body.body);
                        if (stmt.finalizer && isBlockStatementNode(stmt.finalizer)) cleanList(stmt.finalizer.body);
                    } else if (isSwitchStatementNode(stmt)) {
                        for (const caseClause of stmt.cases) cleanList(caseClause.consequent);
                    }
                }
            };
            cleanList(body);
        };
        traverse(file(node), {
            Program: (path) => cleanScope(path.node.body),
            FunctionDeclaration: (path) => {
                if (path.node.body) cleanScope(path.node.body.body);
            },
            FunctionExpression: (path) => {
                if (path.node.body) cleanScope(path.node.body.body);
            },
            ArrowFunctionExpression: (path) => cleanScope([path.node.body]),
            ClassMethod: (path) => {
                if (path.node.body) cleanScope(path.node.body.body);
            },
            ObjectMethod: (path) => {
                if (path.node.body) cleanScope(path.node.body.body);
            },
        });
    }

    /**
     * 流水线末尾的二次语法还原。定点迭代与尾部条件折叠会把 `if (!T) { X = a }
     * else { X = undefined }` 物化成守卫三目、把累加器枢纽拷贝留在语句序列里,
     * 这些都发生在 simplify() 只跑一次的主遍历之后。这里只做四类安全且局部的
     * 还原:守卫三目 → 可选链、死枢纽拷贝折叠、while(true)+break 形态的 for-of
     * 还原(含 `it.next` 被提升为临时方法量的 lowering)、随之失去使用者的
     * 临时变量声明清理。
     * 必须在所有条件折叠之后调用(依赖 `!acc` 物化链已被折回标识符守卫)。
     */
    simplifyTail(node: Program): boolean {
        let changed = false;
        traverse(file(node), {
            ConditionalExpression: (value) => {
                if (this.tryRestoreOptionalChain(value)) changed = true;
            },
        });
        if (this.foldDeadHubCopies(node)) changed = true;
        traverse(file(node), {
            WhileStatement: (value) => {
                if (this.checkAndTransformToForOfStatement(value)) changed = true;
            },
        });
        this.removeUnusedTempDeclarations(node);
        return changed;
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
                if (this.tryRestoreOptionalChain(value)) changed = true;
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