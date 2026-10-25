import { Program } from "@babel/types";
import {ISimplify} from "./ISimplify";
import * as TYPE from "@babel/types";
import traverse, {NodePath} from "@babel/traverse";
import {SyntaxRewriteSimplify} from "./SyntaxRewriteSimplify";
import {
    addPatternNames, collectAssignedNames, collectIdentifierNames, collectReadNames,
    isClassLike as isClassLikeNode, isDoneMember,
    isFunctionLike as isFunctionLikeNode, isNextValue, isNodeEqual, isPureExpression, isTempName, walkNode
} from "./AstUtils";


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
    throwStatement: throwStatementBuilder,
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

    /**
     * `X = E; <不读写 X 的语句>; if (C) { X = F }` -> `X = C ? F : E`。
     *
     * ArkTS 把 `topInsetVp: immersiveReading ? 0 : OFFSET` 这类对象字段 lowering 成
     * 先给临时变量赋初值,再在对象字面量之后用一个只有 then 分支的 if 覆盖:
     *
     *   v0 = 0;
     *   acc = { ..., "topInsetVp": null, ... };
     *   if (!this.immersiveReading) { v0 = OFFSET; }
     *   acc.topInsetVp = v0;
     *
     * 折成 `v0 = !this.immersiveReading ? OFFSET : 0` 后,ObjectLiteralSimplify 才能
     * 把字段并进对象字面量。要求 E 纯(它从 if 之前移到三目分支里),跨过的语句与 C
     * 都不读写 X,且 C/F 不读取 X(三目在赋值前求值,读到的是旧值)。
     */
    private checkAndTransformToConditionalAssignment(value: NodePath<TYPE.IfStatement>): boolean {
        const alternate = value.node.alternate;
        if (alternate && !(isBlockStatementNode(alternate) && alternate.body.length === 0)) return false;
        let consequent = value.node.consequent;
        if (isBlockStatementNode(consequent)) {
            if (consequent.body.length !== 1) return false;
            consequent = consequent.body[0];
        }
        if (!isExpressionStatementNode(consequent) || !isAssignmentExpressionNode(consequent.expression)) return false;
        const branchAssign = consequent.expression;
        if (branchAssign.operator !== "=" || !isIdentifierNode(branchAssign.left)) return false;
        const name = branchAssign.left.name;
        if (!isTempName(name)) return false;
        // 条件本身是 `&&` / `||` 时(典型是 `ok = A; if (B && C) ok = D`),
        // 保持 if 形式更接近源码;否则会被折成很长的三目再并成逻辑链。
        if (isLogicalExpression(value.node.test)) return false;
        if (collectReadNames(value.node.test).has(name)) return false;
        if (collectReadNames(branchAssign.right).has(name)) return false;
        if (collectAssignedNames(branchAssign.right).has(name)) return false;

        // 向前跨过不读写 X 的语句,找 `X = E`(对象字面量构造正好夹在中间)
        let prev = value.getPrevSibling() as NodePath<TYPE.Statement> | null;
        let init: NodePath<TYPE.Statement> | null = null;
        const skipped: TYPE.Statement[] = [];
        while (prev && prev.node && skipped.length < 64) {
            const node = prev.node;
            if (isExpressionStatementNode(node) && isAssignmentExpressionNode(node.expression)
                && node.expression.operator === "=" && isIdentifierNode(node.expression.left)
                && node.expression.left.name === name) {
                init = prev;
                break;
            }
            if (collectReadNames(node).has(name) || collectAssignedNames(node).has(name)) return false;
            skipped.push(node);
            prev = prev.getPrevSibling() as NodePath<TYPE.Statement> | null;
        }
        if (!init) return false;
        const initAssign = (init.node as TYPE.ExpressionStatement).expression as TYPE.AssignmentExpression;
        const initial = initAssign.right;
        if (!isPureExpression(initial)) return false;
        // 条件与初值相同(或其否定)时是短路链 `X = E; if (X/!X) { X = B }`,
        // 交给 foldShortCircuitChains 折成 `X = E &&/|| B`;提前合成三目会把它拆散,
        // 后面的返回折叠就只剩 `return acc ? B : acc`。
        if (isNodeEqual(value.node.test, initial) || this.isComplementaryTest(value.node.test, initial)) {
            return false;
        }
        // E 从 if 之前移到三目分支里:跨过的语句和 C 都不能改写 E 依赖的名字
        const deps = collectIdentifierNames(initial);
        if (deps.size > 0) {
            for (const node of skipped) {
                const assigned = collectAssignedNames(node);
                for (const dep of deps) if (assigned.has(dep)) return false;
            }
            const testAssigned = collectAssignedNames(value.node.test);
            for (const dep of deps) if (testAssigned.has(dep)) return false;
        }

        const conditional = conditionalExpressionBuilder(
            value.node.test, branchAssign.right, initial);
        init.remove();
        value.replaceWith(expressionStatement(
            assignmentExpressionBuilder("=", identifier(name), conditional)));
        return true;
    }

    /** test 是否正好是 initial 的否定(用于识别短路链 `if (X)` / `if (!X)`)。 */
    private isComplementaryTest(test: TYPE.Expression, initial: TYPE.Expression): boolean {
        if (TYPE.isUnaryExpression(test) && test.operator === "!") {
            return isNodeEqual(test.argument as TYPE.Expression, initial);
        }
        if (TYPE.isUnaryExpression(initial) && initial.operator === "!") {
            return isNodeEqual(initial.argument as TYPE.Expression, test);
        }
        if (isBinaryExpressionNode(test) && isBinaryExpressionNode(initial)) {
            const inverted = SyntaxRewriteSimplify.binaryInvert(test);
            return inverted != null && inverted === initial.operator
                && isNodeEqual(test.left, initial.left)
                && isNodeEqual(test.right, initial.right);
        }
        return false;
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

    /** case 标签恰好是 null / undefined 两个(顺序不限):`??` 的 switch lowering。 */
    private isNullishCasePair(rawSwitchCase:Array<SwitchCaseDesc>):boolean{
        if (rawSwitchCase.length !== 2) return false;
        const isNull = (desc:SwitchCaseDesc) => desc.right.isNullLiteral();
        const isUndefined = (desc:SwitchCaseDesc) =>
            isIdentifierNode(desc.right.node) && desc.right.node.name === 'undefined';
        return (isNull(rawSwitchCase[0]) && isUndefined(rawSwitchCase[1]))
            || (isUndefined(rawSwitchCase[0]) && isNull(rawSwitchCase[1]));
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
        // 至少 3 个 case 标签才合成 switch;只有 null/undefined 对例外——它要
        // 先合成 switch,再由 NullishCoalescingSimplify 还原成 `??`。
        if (rawSwitchCase.length < 3 && !this.isNullishCasePair(rawSwitchCase)) return false;
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

    /**
     * 拆分 `disc === value` / `disc === v1 || disc === v2` 形态的 test;
     * 只接受严格相等,因为 switch 的 case 用 `===` 比较(`==` 会把 `x == 1`
     * 与字符串 "1" 之类的情况合并,语义不同)。
     * 返回 false 表示整棵 test 不能完整拆成同一判别式的比较,调用方必须放弃。
     */
    private collectStrictEqualityCases(test:TYPE.Expression,arr:Array<[TYPE.Expression,TYPE.Expression]>):boolean{
        if (isBinaryExpressionNode(test)){
            if (test.operator !== '===') return false;
            if (TYPE.isPrivateName(test.left)) return false;
            arr.push([test.left as TYPE.Expression,test.right]);
            return true;
        }
        if (isLogicalExpression(test) && test.operator === '||'){
            if (!this.collectStrictEqualityCases(test.left,arr)) return false;
            return this.collectStrictEqualityCases(test.right,arr);
        }
        return false;
    }

    /**
     * 分支体能否直接作为 switch case 体:必须以 return/throw 结尾(否则匹配后
     * 仍会继续检查后面的 if,switch 跳出 switch 的语义不等价);而且不能含
     * 会绑定到外层循环的裸 break(进了 switch 会被 switch 截获)。
     */
    private isTerminatingSwitchCaseBody(statements:TYPE.Statement[]):boolean{
        if (statements.length === 0) return false;
        const last = statements[statements.length - 1];
        if (!isReturnStatementNode(last) && last.type !== 'ThrowStatement') return false;
        for (const statement of statements){
            if (this.hasUnboundBreak(statement)) return false;
        }
        return true;
    }

    private hasUnboundBreak(node:TYPE.Node):boolean{
        let found = false;
        walkNode(node,(n)=>{
            if (found) return false;
            switch (n.type){
                case 'BreakStatement':
                    if (!(n as TYPE.BreakStatement).label) found = true;
                    return false;
                // 函数/类体与循环/switch 会重新绑定 break,内部的 break 不受影响
                case 'FunctionDeclaration':
                case 'FunctionExpression':
                case 'ArrowFunctionExpression':
                case 'ClassDeclaration':
                case 'ClassExpression':
                case 'ClassMethod':
                case 'ClassPrivateMethod':
                case 'ObjectMethod':
                case 'ForStatement':
                case 'ForInStatement':
                case 'ForOfStatement':
                case 'WhileStatement':
                case 'DoWhileStatement':
                case 'SwitchStatement':
                    return false;
            }
            return true;
        });
        return found;
    }

    private getSwitchCaseBody(ifNode:TYPE.IfStatement):TYPE.Statement[]|null{
        const consequent = ifNode.consequent;
        if (isBlockStatementNode(consequent)) return consequent.body;
        if (isReturnStatementNode(consequent) || consequent.type === 'ThrowStatement') return [consequent];
        return null;
    }

    /** case 体顶层有块级声明时包一层块,避免多个 case 共享同一作用域重复声明。 */
    private wrapCaseBody(statements:TYPE.Statement[]):TYPE.Statement[]{
        const hasLexical = statements.some((statement) =>
            (isVariableDeclarationNode(statement) && statement.kind !== 'var')
            || statement.type === 'ClassDeclaration'
            || statement.type === 'FunctionDeclaration');
        return hasLexical ? [blockStatementBuilder(statements)] : statements;
    }

    /**
     * 把同一语句列表里连续的守卫链还原成 switch:
     *
     *   if (p0.name === A || p0.name === B) { return E1; }
     *   if (p0.name === C) { return E2; }
     *   return p0.name;
     *   =>
     *   switch (p0.name) {
     *     case A:
     *     case B:
     *       return E1;
     *     case C:
     *       return E2;
     *     default:
     *       return p0.name;
     *   }
     *
     * ArkTS 会把源码 switch 折成逐条没有 else 的守卫(每个分支以 return/throw
     * 结束),default 变成链尾的 return。与 if/else 链的 checkAndTransformToSwitchCase
     * 分开处理:这里只认同一个语句列表里连续的 if,case 标签(含 `A || B` 拆出的
     * fallthrough 标签)至少 3 个才合成 switch,2 个标签的短链保持 if 形式;
     * 判别式与 case 值都必须无副作用(switch 只求值一次判别式),链尾的
     * return/throw 折成 default。
     */
    private foldIfReturnChainToSwitch(body:TYPE.Statement[]):boolean{
        let changed = false;
        let index = 0;
        while (index < body.length){
            const folded = this.matchIfReturnChain(body,index);
            if (folded === null){
                index++;
                continue;
            }
            body.splice(index,folded.consumed,switchStatementBuilder(folded.discriminant,folded.cases));
            index++;
            changed = true;
        }
        return changed;
    }

    private matchIfReturnChain(body:TYPE.Statement[],start:number):{discriminant:TYPE.Expression,cases:TYPE.SwitchCase[],consumed:number}|null{
        if (start >= body.length) return null;
        const first = body[start];
        if (!isIfStatementNode(first) || first.alternate) return null;
        let discriminant:TYPE.Expression = null;
        const rawCases:Array<{values:TYPE.Expression[],body:TYPE.Statement[]}> = [];
        let labelCount = 0;
        let index = start;
        while (index < body.length){
            const current = body[index];
            if (!isIfStatementNode(current) || current.alternate) break;
            const comparisons:Array<[TYPE.Expression,TYPE.Expression]> = [];
            if (!this.collectStrictEqualityCases(current.test,comparisons) || comparisons.length === 0) break;
            const disc = comparisons[0][0];
            if (discriminant === null){
                if (!this.isSideEffectFreeExpression(disc)) return null;
                discriminant = disc;
            }
            let same = true;
            for (const [left] of comparisons){
                if (!isNodeEqual(discriminant,left)){
                    same = false;
                    break;
                }
            }
            if (!same) break;
            const caseBody = this.getSwitchCaseBody(current);
            if (caseBody === null || !this.isTerminatingSwitchCaseBody(caseBody)) break;
            rawCases.push({values:comparisons.map(([,right]) => right),body:caseBody});
            labelCount += comparisons.length;
            index++;
        }
        // 单个 if 保持守卫子句;不足 3 个 case 标签的短链(两条各一个值)也保持 if 形式
        if (rawCases.length < 1 || labelCount < 3) return null;
        const cases:TYPE.SwitchCase[] = [];
        for (const rawCase of rawCases){
            const caseBody = this.wrapCaseBody(rawCase.body);
            rawCase.values.forEach((value,i) => {
                cases.push(switchCase(value,i === rawCase.values.length - 1 ? caseBody : []));
            });
        }
        // 紧跟链尾的 return/throw 是源码 switch 的 default
        const next = body[index];
        if (next && (isReturnStatementNode(next) || next.type === 'ThrowStatement')){
            cases.push(switchCase(null,[next]));
            index++;
        }
        return {discriminant,cases,consumed:index - start};
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

    /** iterator close 的守卫:`it.return != undefined` / `it.return !== undefined`。 */
    private isIteratorReturnGuard(test: TYPE.Expression, itName: string): boolean {
        if (!isBinaryExpressionNode(test)) return false;
        if (test.operator !== "!=" && test.operator !== "!==") return false;
        const left = test.left;
        if (!isMemberExpression(left) || left.computed) return false;
        if (!isIdentifierNode(left.object) || left.object.name !== itName) return false;
        if (!isIdentifierNode(left.property) || left.property.name !== "return") return false;
        return isIdentifierNode(test.right) && test.right.name === "undefined";
    }

    /** `it.return();`(iterator close 调用)。 */
    private isIteratorReturnCall(stmt: TYPE.Statement, itName: string): boolean {
        if (!isExpressionStatementNode(stmt)) return false;
        const call = stmt.expression;
        if (!isCallExpression(call) || call.arguments.length !== 0) return false;
        const callee = call.callee;
        if (!isMemberExpression(callee) || callee.computed) return false;
        if (!isIdentifierNode(callee.object) || callee.object.name !== itName) return false;
        return isIdentifierNode(callee.property) && callee.property.name === "return";
    }

    /**
     * 收集循环体提前退出分支里内联的 iterator close:
     *
     *   if (cond) { if (it.return != undefined) { it.return() } return E; }
     *
     * 这是 ArkTS 对 `while (true)` 形态 for-of 的 lowering 残留:源码的 for...of 在
     * return/throw 退出时由运行时自动 close。删除后这些读取不再阻止 for-of 还原。
     * 只接受紧跟“确定离开函数”的语句(return/throw,含其块/if 形态)的 close;
     * break/continue 不处理(break 可能属于外层结构,continue 不会 close)。
     */
    private collectInlinedIteratorCloses(loop: NodePath<TYPE.WhileStatement>, itName: string): NodePath<TYPE.Statement>[] {
        const closes: NodePath<TYPE.Statement>[] = [];
        const body = loop.get('body');
        if (!isBlockStatementNode(body.node)) return closes;
        body.traverse({
            Function: (path) => path.skip(),
            IfStatement: (path) => {
                if (path.node.alternate) return;
                if (!this.isIteratorReturnGuard(path.node.test, itName)) return;
                const consequent = path.node.consequent;
                const statements = isBlockStatementNode(consequent)
                    ? (consequent as TYPE.BlockStatement).body
                    : [consequent as TYPE.Statement];
                if (statements.length !== 1 || !this.isIteratorReturnCall(statements[0], itName)) return;
                const next = path.getNextSibling();
                if (!next.node || !this.statementAlwaysExits(next.node as TYPE.Statement)) return;
                closes.push(path as NodePath<TYPE.Statement>);
            },
        });
        return closes;
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
     * ref 所在语句是否整体位于 loop 之后(同层或外层语句列表里)。循环之后的写入
     * 与本循环无关:删除迭代器初始化不会影响它们。
     */
    private isStatementAfterLoop(ref: NodePath, loop: NodePath<TYPE.Statement>): boolean {
        let current: NodePath = ref;
        while (current.parentPath) {
            const parent = current.parentPath;
            if (current.node === loop.node) return false;
            if (!parent.node) return false;
            const siblings = (parent.node as { body?: TYPE.Node[] }).body;
            if (Array.isArray(siblings)) {
                const refIndex = siblings.indexOf(current.node);
                const loopIndex = siblings.indexOf(loop.node);
                if (refIndex >= 0 && loopIndex >= 0) return refIndex > loopIndex;
            }
            current = parent;
        }
        return false;
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
        // 循环出口紧接着 return/throw 时,common 之后(含外层分支之后)的读取
        // 根本执行不到;这类“读取排在循环后面”只是语句顺序上的,不是执行顺序。
        if (this.loopExitSkipsCommonTail(loop, common)) return true;

        // 从读取处向上逐层看同一语句块里是否有前置的直接赋值;
        // 最外层只认循环之后的赋值(循环前的会被本轮迭代覆盖)。
        let current: NodePath | null = ref;
        while (current && current.node !== common.node) {
            const parent = current.parentPath;
            if (!parent) return false;
            // 读取位于 for-of/for-in/for 的循环体里:循环头在每轮 body 之前写入
            // 循环变量/init,读到的是新值(同一个临时量被后续循环复用)。
            if ((parent.node as { body?: TYPE.Node }).body === current.node) {
                const loopNode = parent.node as TYPE.ForOfStatement | TYPE.ForInStatement | TYPE.ForStatement;
                if (isForOfStatementNode(loopNode) || isForInStatementNode(loopNode)) {
                    const bound = new Set<string>();
                    addPatternNames(loopNode.left, bound);
                    if (bound.has(name)) return true;
                } else if (isForStatementNode(loopNode)) {
                    const bound = new Set<string>();
                    if (loopNode.init) addPatternNames(loopNode.init, bound);
                    if (bound.has(name)) return true;
                }
            }
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
     * 循环正常结束后是否立即离开函数(同层下一条语句就是 return/throw)。
     * 若是,循环出口之后排在相同语句块/外层分支后面的读取不会被执行到,
     * 删除循环前的迭代器初始化或提升方法量不会影响它们。
     */
    private loopExitSkipsCommonTail(loop: NodePath, common: NodePath): boolean {
        if (!(loop.isWhileStatement() || loop.isDoWhileStatement() || loop.isForStatement()
            || loop.isForOfStatement() || loop.isForInStatement())) return false;
        let current: NodePath = loop;
        while (current.parentPath && current.parentPath.node !== common.node) {
            const parent = current.parentPath;
            if (!isBlockStatementNode(parent.node) && !isProgram(parent.node)) return false;
            const body = (parent.node as { body?: TYPE.Node[] }).body;
            if (!body) return false;
            const index = body.indexOf(current.node);
            if (index < 0) return false;
            if (index + 1 < body.length) {
                return this.statementAlwaysExits(body[index + 1] as TYPE.Statement);
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
    /** `X = <字面量>` 这类不读取任何名字的临时初始化。 */
    private isConstantInitStatement(node: TYPE.Node): boolean {
        if (!isExpressionStatementNode(node) || !isAssignmentExpressionNode(node.expression)) return false;
        const assign = node.expression;
        if (assign.operator !== "=" || !isIdentifierNode(assign.left)) return false;
        const right = assign.right;
        return isBooleanLiteral(right) || isNullLiteralNode(right)
            || TYPE.isStringLiteral(right) || TYPE.isNumericLiteral(right)
            || (isIdentifierNode(right) && right.name === "undefined");
    }

    /**
     * 上一条语句,跳过 `X = <字面量>` 形式的临时初始化。
     * do-while 形态的 for-of 在迭代器初始化与循环之间常夹着 `acc = false`
     * (test 物化的初值),提升的 `it.next` 临时量在它前面。
     */
    private prevSignificantSibling(path: NodePath): NodePath<TYPE.Statement> | null {
        let prev = path.getPrevSibling();
        while (prev.node && this.isConstantInitStatement(prev.node)) prev = prev.getPrevSibling();
        return prev.node ? prev as NodePath<TYPE.Statement> : null;
    }

    private foldHoistedIteratorNext(value: NodePath<TYPE.WhileStatement | TYPE.DoWhileStatement>): void {
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
        const prevFn = this.prevSignificantSibling(value);
        if (!prevFn || !prevFn.isExpressionStatement() || !isAssignmentExpressionNode(prevFn.node.expression)) return;
        const fnAssign = prevFn.node.expression as TYPE.AssignmentExpression;
        if (fnAssign.operator !== "=" || !isIdentifierNode(fnAssign.left) || fnAssign.left.name !== fnTemp) return;
        if (!isMemberExpression(fnAssign.right) || fnAssign.right.computed) return;
        if (!isIdentifierNode(fnAssign.right.property) || fnAssign.right.property.name !== "next") return;
        if (!isIdentifierNode(fnAssign.right.object)) return;
        const nextObject = fnAssign.right.object.name;
        // 再前一条有两种形态:
        //   1) `G = H`,H 是标识符;再前一条是 `H = X[Symbol.iterator]()`;
        //   2) 别名已被累加器折叠:直接 `G = X[Symbol.iterator]()`(G 就是迭代器本体)。
        const prevAlias = this.prevSignificantSibling(prevFn);
        if (!prevAlias || !prevAlias.isExpressionStatement() || !isAssignmentExpressionNode(prevAlias.node.expression)) return;
        const aliasAssign = prevAlias.node.expression as TYPE.AssignmentExpression;
        if (aliasAssign.operator !== "=" || !isIdentifierNode(aliasAssign.left) || aliasAssign.left.name !== iterAlias) return;
        let iterName: string;
        let aliasStatement: NodePath<TYPE.Statement> | null = prevAlias;
        if (isIdentifierNode(aliasAssign.right)) {
            iterName = aliasAssign.right.name;
            if (iterName === iterAlias || iterName === fnTemp || iterName === vvName) return;
            if (nextObject !== iterAlias && nextObject !== iterName) return;
            // 再前一条:`H = X[Symbol.iterator]()`。
            const init = this.prevSignificantSibling(prevAlias);
            if (!init || !init.isExpressionStatement() || !isAssignmentExpressionNode(init.node.expression)) return;
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
        // F 除这里的定义与调用外不能再有其它读取,否则删掉 `F = G.next` 会破坏它们。
        // 反编译器会复用同一个临时量(前面的循环也写过 F):只要读取发生在被删语句
        // 之前、或之前还有新的赋值覆盖,就与这次删除无关。
        const fnBinding = value.scope.getBinding(fnTemp);
        if (!fnBinding) return;
        for (const ref of fnBinding.referencePaths) {
            if (!ref.node || ref.node === call.callee.object) continue;
            if (this.hasNewerValueBefore(ref, prevFn, fnTemp)) continue;
            return;
        }
        for (const violation of fnBinding.constantViolations) {
            if (!violation.node || violation.node === fnAssign || violation.node === prevFn.node) continue;
            if (this.hasNewerValueBefore(violation, prevFn, fnTemp)) continue;
            return;
        }
        // 形式 1 会删掉别名语句 `G = H`,要求 G 除定义与该调用外没有会受影响的引用/写入。
        // 形式 2 不动 G(迭代器初始化由调用方自己决定是否删除),因此不做限制:
        // done 分支里往往还有内层循环复用同一个迭代器临时量。
        if (aliasStatement) {
            const aliasBinding = value.scope.getBinding(iterAlias);
            if (!aliasBinding) return;
            for (const ref of aliasBinding.referencePaths) {
                if (!ref.node || ref.node === call.arguments[0] || ref.node === fnAssign.right.object) continue;
                if (this.hasNewerValueBefore(ref, aliasStatement, iterAlias)) continue;
                return;
            }
            for (const violation of aliasBinding.constantViolations) {
                if (!violation.node || violation.node === aliasAssign || violation.node === prevAlias.node) continue;
                if (this.hasNewerValueBefore(violation, aliasStatement, iterAlias)) continue;
                return;
            }
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
        // 提前退出分支里内联的 `if (it.return != undefined) it.return();` 在转换后
        // 由 for...of 自己 close;收集起来供下面忽略其读取,并在全部校验通过后删除。
        const inlinedCloses = this.collectInlinedIteratorCloses(value, init.left.name);
        const insideInlinedClose = (path: NodePath) =>
            inlinedCloses.some((close) => path.findParent((parent) => parent.node === close.node));

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
            // 内联的 close 语句(及其守卫)稍后会随转换删除,不算循环体内的读取。
            if (insideInlinedClose(ref)) continue;
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

        // 全部校验通过后才删除内联 close,避免中途放弃时留下未收尾的迭代器。
        for (const close of inlinedCloses) close.remove();

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
        const name = this.stripNegations(test);
        return name && name.negated === false ? name.name : null;
    }

    /** test 去掉任意个 `!` 后是标识符时返回名字与取反奇偶性。 */
    private loopTestOperand(test: TYPE.Expression): { name: string; negated: boolean } | null {
        return this.stripNegations(test);
    }

    private stripNegations(test: TYPE.Expression): { name: string; negated: boolean } | null {
        let expr: TYPE.Expression = test;
        let negated = false;
        while (TYPE.isUnaryExpression(expr) && expr.operator === "!") {
            negated = !negated;
            expr = expr.argument as TYPE.Expression;
        }
        return isIdentifierNode(expr) ? { name: expr.name, negated } : null;
    }

    /** 按 `!` 的奇偶性取反表达式本身(`!!X` → `!X`,`!X` → `X`)。 */
    private negateLoopTest(test: TYPE.Expression): TYPE.Expression {
        const operand = this.stripNegations(test);
        if (!operand) return this.negateCondition(test);
        let expr: TYPE.Expression = identifier(operand.name);
        if (!operand.negated) expr = unaryExpressionBuilder("!", expr);
        return expr;
    }

    /**
     * 还原“提前退出(+ return/break)的 for...of”被 lower 成的 do-while:
     *
     *   it = arr[Symbol.iterator]();
     *   do {
     *     v = it.next();
     *     if (v.done) { DONE }       // 循环耗尽后的代码,所有路径都离开函数
     *     ...;                       // 含 if (acc) continue;
     *     acc = ...;                 // 循环 test 的物化
     *   } while (acc);
     *   close(it);
     *   return E;                    // A: test 为假时提前 return / throw E
     *   // 或 break 形态:B: EXIT 是 break 路径的前缀,EXIT 之后是 close,
     *   // close 之后是循环耗尽与 break 共用的续接代码(AFTER)
     *   // 循环体没有提前退出时编译器不生成 close:A 形态的出口语句直接跟在
     *   // 循环之后,且是语句列表的最后一条。
     *
     * → for (const v of arr) {
     *     ...;
     *     if (!TEST) return E;       // A:原来的提前 return / throw
     *     if (TEST) { EXIT; break; } // B:原来的 break
     *   }
     *   DONE                        // 仅 A:DONE 搬到 for-of 之后
     *   AFTER                       // 仅 B:DONE 是 AFTER 的副本,直接丢弃
     *
     * 与 while(true)+break 形态不同,这里的 done 分支 return 的是循环正常结束值;
     * 循环 test 为假则走循环后的出口。只有 continue 的守卫能保证 test 在
     * continue 路径上为真时才转换,否则 for-of 的 continue 会跳过附加的出口判断。
     */
    private checkAndTransformDoWhileToForOfStatement(value: NodePath<TYPE.DoWhileStatement>): boolean {
        const testOperand = this.loopTestOperand(value.node.test);
        if (!testOperand) return false;
        const testName = testOperand.name;
        // 已折平的 test(如 `while (!v3)`)没有物化赋值语句,出口条件直接按取反
        // 奇偶性计算;物化形态(`acc = T; while (acc)`)由下面的 lastAssignsTest 处理。
        const loopTest = value.node.test;

        // 提升成临时方法量的 lowering(`v12 = v13.next; ... v12.call(v13)`)先归一化,
        // 否则初始化查找会先撞上这条 `F = it.next` 而找不到迭代器初始化。
        this.foldHoistedIteratorNext(value);

        // 循环前紧邻的可能还有不读取迭代器的临时初始化(如 `acc = false`),
        // 向后找到真正的 `it = arr[Symbol.iterator]()` 即可。
        let initPath: NodePath | null = value.getPrevSibling();
        let init: TYPE.AssignmentExpression | null = null;
        let iterable: TYPE.Expression | null = null;
        const skippedInits: NodePath<TYPE.Statement>[] = [];
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
            if (this.isConstantInitStatement(initPath.node)) {
                skippedInits.push(initPath as NodePath<TYPE.Statement>);
                initPath = initPath.getPrevSibling();
                continue;
            }
            break;
        }
        if (!init || !iterable || !initPath) return false;
        const iterName = (init.left as TYPE.Identifier).name;
        const iterBinding = value.scope.getBinding(iterName);
        if (!iterBinding) return false;
        // 被跨过的常量初始化会在 for-of 头部之前执行:迭代器表达式读取的名字
        // 不能在这里被覆盖(否则头部读到的是新值)。testName 的初值例外——
        // do-while 至少执行一次 body,它永远不会被读,转换后直接删掉。
        const iterableReads = collectReadNames(iterable);
        const deadInits: NodePath<TYPE.Statement>[] = [];
        let mustDropTestInit = false;
        for (const skipped of skippedInits) {
            const assign = (skipped.node as TYPE.ExpressionStatement).expression as TYPE.AssignmentExpression;
            const name = (assign.left as TYPE.Identifier).name;
            if (name === testName) {
                deadInits.push(skipped);
                if (iterableReads.has(testName)) mustDropTestInit = true;
                continue;
            }
            if (iterableReads.has(name)) return false;
        }

        // 循环之后有两种出口形态:
        //   A) iterator.close 之后紧跟 `return E` / `throw E`:循环体里是提前 return;
        //   B) iterator.close 之前是 break 路径的前缀语句(EXIT),close 之后是
        //      循环耗尽与 break 共用的续接代码。DONE 是同一块的副本:break
        //      还原后直接落到续接代码,耗尽路径也走续接代码,因此 DONE 丢弃。
        //      (典型: for (const x of xs) { ...; if (cond) { A = x; break; } })
        // 循环体里没有任何提前退出时,编译器不生成 iterator close:循环之后直接
        // 就是 test 为假时的出口语句,没有 close、也没有 EXIT 前缀。
        // getNextSibling() 在列表末尾返回 node 为 null 的 NodePath(对象本身非空),
        // 必须按 node 判空,否则循环永远前进不了、exitPaths 无限增长(直接 OOM)。
        let cursor = value.getNextSibling();
        const exitPaths: NodePath<TYPE.Statement>[] = [];
        while (cursor.node && !collectIdentifierNames(cursor.node).has(iterName)) {
            exitPaths.push(cursor as NodePath<TYPE.Statement>);
            cursor = cursor.getNextSibling();
        }
        const extras: NodePath<TYPE.Statement>[] = [];
        while (cursor.node && cursor.isIfStatement() && collectIdentifierNames(cursor.node).has(iterName)) {
            extras.push(cursor as NodePath<TYPE.Statement>);
            cursor = cursor.getNextSibling();
        }
        let exitPath: NodePath<TYPE.ReturnStatement | TYPE.ThrowStatement> | null = null;
        let exitValue: TYPE.Expression | null = null;
        let breakPath: TYPE.Statement[] | null = null;
        if (extras.length === 0) {
            // 没有 close:出口语句就是循环之后的第一条,且必须是该语句列表的最后
            // 一条(出口之后不会再有可执行语句,否则说明这不是该形态)。
            if (exitPaths.length !== 1 || cursor.node) return false;
            const only = exitPaths.pop() as NodePath<TYPE.ReturnStatement | TYPE.ThrowStatement>;
            if ((!only.isReturnStatement() && !only.isThrowStatement()) || !only.node.argument) return false;
            exitPath = only;
        } else if (exitPaths.length === 0) {
            const candidate = cursor as NodePath<TYPE.ReturnStatement | TYPE.ThrowStatement>;
            if ((!candidate.isReturnStatement() && !candidate.isThrowStatement()) || !candidate.node.argument) {
                return false;
            }
            exitPath = candidate;
        } else {
            // break 路径:close 之后必须还有共享续接代码,前缀语句必须是直线代码
            // (搬进新循环的 if 分支后,声明会换作用域,break/continue/label 会
            // 绑定到新循环)。
            if (!cursor.node) return false;
            for (const prefix of exitPaths) {
                if (!this.isBreakPathStatement(prefix.node)) return false;
            }
            breakPath = exitPaths.map((prefix) => prefix.node);
        }
        if (exitPath) {
            exitValue = exitPath.node.argument;
            // E 会被搬进循环体按当前元素求值:搬移不能引入副作用,且不能读取迭代器
            // 临时量(for-of 里迭代器已不存在)。`throw new Error(...)` 的 `new` 不算
            // 纯表达式,但出口表达式只在 test 为假时求值一次,搬进循环体不改变求值
            // 顺序与次数,因此 throw 只检查迭代器临时量。
            if ((exitPath.isReturnStatement() && !isPureExpression(exitValue))
                || collectIdentifierNames(exitValue).has(iterName)) return false;
        }

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

        // body[1]: if (vv.done) { DONE };DONE 在循环耗尽时执行,搬到 for-of 之后。
        const doneStmt = bodyStatements[1];
        if (!doneStmt.isIfStatement() || doneStmt.node.alternate) return false;
        const doneTest = doneStmt.get('test');
        if (!isDoneMember(doneTest.node)) return false;
        const doneObject = (doneTest.node as TYPE.MemberExpression).object;
        if (!isIdentifierNode(doneObject) || doneObject.name !== vv.name) return false;
        const doneConsequent = doneStmt.get('consequent');
        let doneStatements: TYPE.Statement[];
        if (doneConsequent.isBlockStatement()) doneStatements = doneConsequent.node.body;
        else if (isReturnStatementNode(doneConsequent.node) || doneConsequent.node.type === "ThrowStatement") {
            doneStatements = [doneConsequent.node as TYPE.Statement];
        } else return false;
        if (doneStatements.length === 0) return false;
        // 循环耗尽分支必须自己离开函数(return/throw):它要么搬到 for-of 之后
        // (变体 A),要么是 close 之后续接代码的副本(变体 B)。
        if (!this.statementAlwaysExits(doneStatements[doneStatements.length - 1])) return false;
        if (exitValue) {
            // 循环耗尽时 vv 还是上一轮的值(do-while 里刚赋的是 done 结果对象),
            // 搬到 for-of 之后 vv 停在最后一个元素上:要求 DONE 先写 vv 再读。
            if (!this.readsNameOnlyAfterWrite(doneStatements, vv.name)) return false;
        }

        // 转换后 it/vv 都不再存在:it 只能出现在 init/next()/close 里,
        // vv 只能在循环体内或提前退出路径 E 里使用。
        const iterObjectNode = ((nextAssign.right as TYPE.CallExpression).callee as TYPE.MemberExpression).object;
        const nextStatementNode = bodyStatements[0].node;
        for (const ref of iterBinding.referencePaths) {
            if (!ref.node || ref.node === iterObjectNode) continue;
            // foldHoistedIteratorNext 改写了 `F.call(it)` → `it.next()`,绑定里的
            // referencePaths 还是改写前的节点:按语句归属再认一次首条 next()。
            if (ref.getStatementParent()?.node === nextStatementNode) continue;
            if (extras.some((e) => ref.findParent((parent) => parent.node === e.node))) continue;
            // break 形态下 DONE 整块丢弃,里面的引用(通常是被复制进来的续接
            // 代码又复用了同一个迭代器临时量)不再影响本循环。
            if (!exitValue && ref.findParent((parent) => parent.node === doneStmt.node)) continue;
            // 循环之前的读取、以及同一个临时迭代器被后面的循环复用(done 分支里
            // 重新 `it = x[Symbol.iterator]()` 后内层循环再读 it)都不受删除初始化影响。
            if (this.hasNewerValueBefore(ref, value, iterName)) continue;
            if (this.hasPriorAssignmentInAncestors(ref, value, iterName)) continue;
            return false;
        }
        for (const violation of iterBinding.constantViolations) {
            if (!violation.node || violation.node === init) continue;
            // done 分支里的重新初始化随分支一起搬走,不再影响本循环。
            if (violation.findParent((parent) => parent.node === doneStmt.node)) continue;
            // 循环之后的重新初始化(内层循环的 `it = xs[Symbol.iterator]()`)在本循环
            // 之外,删除初始化不影响它,也不需要它来“覆盖”循环里的读取。
            if (this.isStatementAfterLoop(violation, value)) continue;
            if (this.hasNewerValueBefore(violation, value, iterName)) continue;
            return false;
        }
        const valueBinding = value.scope.getBinding(vv.name);
        if (valueBinding) {
            for (const ref of valueBinding.referencePaths) {
                if (!ref.node) continue;
                // `for (vv of xs)` 的循环变量是写入位置,不是对旧值的读取。
                const refParent = ref.parentPath?.node;
                if (refParent && (isForOfStatementNode(refParent) || isForInStatementNode(refParent))
                    && refParent.left === ref.node) continue;
                if (ref.findParent((parent) => parent.node === value.node)) continue;
                if (exitPath && ref.findParent((parent) => parent.node === exitPath.node)) continue;
                // break 路径前缀会被搬进循环体,那里 vv 仍是当前元素。
                if (exitPaths.some((prefix) => ref.findParent((parent) => parent.node === prefix.node))) continue;
                // break 形态下 DONE 整块丢弃,里面的读取随块一起消失。
                if (!exitValue && ref.findParent((parent) => parent.node === doneStmt.node)) continue;
                // 循环之前的读取不受影响(外层循环还原后,内层循环的变量读取落在
                // 它前面);循环之后的读取必须能看到后续赋值。
                if (this.hasNewerValueBefore(ref, value, vv.name)) continue;
                return false;
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
                if (!this.continueHoldsLoopTest(
                    p as NodePath<TYPE.ContinueStatement>, testName, loopTest, testOperand.negated)) {
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

        // `vv = vv.value` 由 for-of 的循环变量赋值替代。先判定再替换,
        // 否则 `vv.value` 已被改写后这条赋值就认不出来了。
        const skipSelfValueAssignment = this.isSelfValueAssignment(bodyStatements[2].node, vv.name);
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
        for (let i = 2; i < bodyStatements.length; i++) {
            if (i === 2 && skipSelfValueAssignment) continue;
            arr.push(bodyStatements[i].node);
        }
        // 循环 test 的物化赋值 `testName = T` 直接变成出口判断的条件,避免输出里
        // 留下只给 while test 用的 acc 赋值。取反奇偶性作用在 T 上:
        //   while (acc) + acc = T        -> if (!T)
        //   while (!acc) + acc = T       -> if (T)
        let exitTest: TYPE.Expression = this.negateLoopTest(loopTest);
        const testAssign = arr[arr.length - 1];
        const lastAssignsTest = isExpressionStatementNode(testAssign) && isAssignmentExpressionNode(testAssign.expression)
            && testAssign.expression.operator === "=" && isIdentifierNode(testAssign.expression.left)
            && testAssign.expression.left.name === testName;
        if (lastAssignsTest) {
            const testExpr = (testAssign as TYPE.ExpressionStatement).expression as TYPE.AssignmentExpression;
            const testValue = testExpr.right as TYPE.Expression;
            // 出口路径(return E / break 前缀)不能在删掉物化赋值后还读 testName。
            const exitConsumers: TYPE.Node[] = exitValue ? [exitValue] : (breakPath ?? []);
            const exitReadsTest = exitConsumers.some((node) => collectReadNames(node).has(testName));
            if (!collectReadNames(testValue).has(testName)
                && !this.readsName(doneStatements, testName)
                && !exitReadsTest) {
                arr.pop();
                exitTest = testOperand.negated ? testValue : this.negateCondition(testValue);
            }
        }
        // test 的常量初值只有在 body 末尾确实重写 test 时才可以删;它还可能覆盖
        // for-of 头部仍要读取的迭代器表达式(`acc = false; for (v of acc)`),
        // 那种情况下不删就会读错,直接放弃转换。
        if (!lastAssignsTest && mustDropTestInit) return false;
        if (exitValue) {
            arr.push(TYPE.ifStatement(exitTest, exitPath!.isReturnStatement()
                ? returnStatementBuilder(exitValue) : throwStatementBuilder(exitValue)));
        } else {
            // 源码形态:if (cond) { <break 路径前缀> break; }
            arr.push(TYPE.ifStatement(exitTest, blockStatementBuilder([...(breakPath ?? []), breakStatement()])));
        }
        const forOfStatement = forOfStatementBuilder(vv, iterable as TYPE.Expression, blockStatementBuilder(arr));
        for (const extra of extras) extra.remove();
        for (const prefix of exitPaths) prefix.remove();
        if (exitPath) exitPath.remove();
        value.replaceWith(forOfStatement);
        if (exitValue) {
            // DONE 里可能有块级声明,包一层块避免与外部同名声明冲突。
            const hasDeclaration = doneStatements.some((stmt) =>
                isVariableDeclarationNode(stmt) || stmt.type === "FunctionDeclaration" || stmt.type === "ClassDeclaration");
            value.insertAfter(hasDeclaration ? [blockStatementBuilder(doneStatements)] : doneStatements);
        }
        // break 形态下 DONE 是 close 之后续接代码的副本:耗尽和 break 都走续接代码,
        // 保留 DONE 会让 break 落到耗尽分支上。
        initPath.remove();
        if (lastAssignsTest) {
            for (const dead of deadInits) dead.remove();
        }
        return true;
    }

    /** break 路径前缀能否搬进 for-of 的 if 分支(直线代码,无声明与跳转)。 */
    private isBreakPathStatement(stmt: TYPE.Statement): boolean {
        let valid = true;
        walkNode(stmt, (node) => {
            if (!valid) return false;
            if (isVariableDeclarationNode(node) || isFunctionLikeNode(node) || isClassLikeNode(node)
                || isBreakStatement(node) || node.type === "ContinueStatement" || isLabeledStatementNode(node)) {
                valid = false;
                return false;
            }
            return true;
        });
        return valid;
    }

    /** 语句是否所有执行路径都会离开(return / throw)。 */
    private statementAlwaysExits(stmt: TYPE.Statement): boolean {
        if (isReturnStatementNode(stmt) || stmt.type === "ThrowStatement") return true;
        if (isBlockStatementNode(stmt)) {
            const body = (stmt as TYPE.BlockStatement).body;
            return body.length > 0 && this.statementAlwaysExits(body[body.length - 1]);
        }
        if (isIfStatementNode(stmt)) {
            return !!stmt.alternate
                && this.statementAlwaysExits(stmt.consequent)
                && this.statementAlwaysExits(stmt.alternate);
        }
        return false;
    }

    /** 语句列表里是否至少有一次“先写 name 再读”。 */
    private writesNameBeforeReadInList(list: TYPE.Statement[], name: string): boolean {
        for (const stmt of list) {
            if (collectReadNames(stmt).has(name) && !this.writesNameFirst(stmt, name)) return false;
            if (this.writesNameFirst(stmt, name)) return true;
        }
        return false;
    }

    /** 语句列表是否只在写入过 name 之后才读取它。 */
    private readsNameOnlyAfterWrite(list: TYPE.Statement[], name: string): boolean {
        let written = false;
        for (const stmt of list) {
            if (!written && collectReadNames(stmt).has(name) && !this.writesNameFirst(stmt, name)) return false;
            if (this.writesNameFirst(stmt, name)) written = true;
        }
        return true;
    }

    /** 语句是否在读取 name 之前就无条件写入 name(直接赋值、for-of/for-in 绑定、do-while body)。 */
    private writesNameFirst(stmt: TYPE.Statement, name: string): boolean {
        // do-while 的 body 至少执行一次:body 先写后读时,循环之后读到的是新值。
        if (isDoWhileStatementNode(stmt)) {
            const body = stmt.body;
            return isBlockStatementNode(body)
                ? this.writesNameBeforeReadInList(body.body, name)
                : this.writesNameFirst(body as TYPE.Statement, name);
        }
        if (isForOfStatementNode(stmt) || isForInStatementNode(stmt)) {
            const left = (stmt as TYPE.ForOfStatement | TYPE.ForInStatement).left;
            return isIdentifierNode(left) && left.name === name
                && !collectReadNames((stmt as TYPE.ForOfStatement | TYPE.ForInStatement).right).has(name);
        }
        if (isExpressionStatementNode(stmt) && isAssignmentExpressionNode(stmt.expression)) {
            const assign = stmt.expression;
            return assign.operator === "=" && isIdentifierNode(assign.left) && assign.left.name === name
                && !collectReadNames(assign.right).has(name);
        }
        return false;
    }

    /** 语句列表里是否有读取 name。 */
    private readsName(list: TYPE.Statement[], name: string): boolean {
        return list.some((stmt) => collectReadNames(stmt).has(name));
    }

    /** 读取之前是否在某个祖先语句块里已经直接给 name 赋值(语句顺序上一定先执行)。 */
    private hasPriorAssignmentInAncestors(ref: NodePath, stop: NodePath, name: string): boolean {
        // 闭包里的读取可能在循环执行期间被调用,无法按语句顺序判断。
        if (ref.getFunctionParent() !== stop.getFunctionParent()) return false;
        let current: NodePath | null = ref;
        while (current && current.node !== stop.node) {
            const parent = current.parentPath;
            if (!parent) return false;
            const siblings = (parent.node as { body?: TYPE.Node[] }).body;
            if (Array.isArray(siblings)) {
                const index = siblings.indexOf(current.node);
                for (let i = index - 1; i >= 0; i--) {
                    if (this.isDirectAssignmentTo(siblings[i], name)) return true;
                }
            }
            current = parent;
        }
        return false;
    }

    /**
     * continue 路径上循环 test 是否一定为真。接受两种 lowering:
     *   `if (acc) continue;`(守卫就是 test 本身)
     *   `if (!x) continue;` 且紧邻前一条是 `acc = !x;`(continue 前刚物化过 test)
     * 后者保证 continue 时 test 为真,跳过的出口判断本来也不会触发。
     */
    private continueHoldsLoopTest(
        value: NodePath<TYPE.ContinueStatement>,
        testName: string,
        loopTest: TYPE.Expression,
        testNegated: boolean,
    ): boolean {
        let child: NodePath = value;
        let parent = value.parentPath;
        while (parent && (parent.isBlockStatement() || parent.isLabeledStatement())) {
            child = parent;
            parent = parent.parentPath;
        }
        if (!parent || !parent.isIfStatement() || parent.node.alternate
            || child.node !== parent.node.consequent) return false;
        const guard = parent.node.test;
        // 守卫和循环 test 逐字相同(取反形态 `while (!x)` 也成立)。
        if (isNodeEqual(guard, loopTest)) return true;
        if (!testNegated && this.loopTestSimpleName(guard) === testName) return true;
        const prev = parent.getPrevSibling();
        if (!prev.node || !this.isDirectAssignmentTo(prev.node, testName)) return false;
        const rhs = ((prev.node as TYPE.ExpressionStatement).expression as TYPE.AssignmentExpression).right;
        return isNodeEqual(rhs, guard);
    }

    /** 条件取反:去掉一层 `!`,否则补一个。 */
    private negateCondition(expr: TYPE.Expression): TYPE.Expression {
        if (TYPE.isUnaryExpression(expr) && expr.operator === "!") {
            return (expr as TYPE.UnaryExpression).argument as TYPE.Expression;
        }
        return unaryExpressionBuilder("!", expr);
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
            ArrowFunctionExpression: (path) => {
                // 表达式体的箭头函数没有语句列表,只清理块状体(伪语句本就不会命中清理模式,行为等价)
                if (isBlockStatementNode(path.node.body)) cleanScope(path.node.body.body);
            },
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
     * 这些都发生在 simplify() 只跑一次的主遍历之后。这里只做五类安全且局部的
     * 还原:守卫三目 → 可选链、死枢纽拷贝折叠、while(true)+break 形态的 for-of
     * 还原(含 `it.next` 被提升为临时方法量的 lowering)、do-while 形态的 for-of
     * 还原(提前 return / break 两种出口)、连续 if 守卫链 →
     * switch(else-if 块已被 flattenElseAfterExit 展开成守卫子句)、随之失去
     * 使用者的临时变量声明清理。
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
        if (this.restoreIteratorLoops(node)) changed = true;
        // 同一语句列表里的连续 `if (disc === v) { return ...; }` 守卫链是
        // ArkTS 对源码 switch 的 lowering(else-if 块先由 flattenElseAfterExit
        // 展开成守卫子句),在流水线末尾按语句列表整体还原。
        if (this.foldIfReturnChains(node)) changed = true;
        this.removeUnusedTempDeclarations(node);
        return changed;
    }

    /**
     * 把迭代器 lowering 还原成 for-of:while(true)+break 形态与 do-while 形态
     * (提前 return / break 两种出口)。只有到尾部(可选链/条件物化折叠完、close 块
     * 归一化成 `if (it.return != undefined)`)之后才能识别,循环体的出口判断也要等
     * 测试序列清理后才是 `testName = T`,因此也由 SimplifyExport 在哨兵守卫清理后
     * 再调用一次 —— `hole` finally 残留会把 close 包成
     * `if (false) {} else if (it.return != undefined) { ... }`,那时才露出标准形态。
     */
    public restoreIteratorLoops(node: Program): boolean {
        let changed = false;
        traverse(file(node), {
            WhileStatement: (value) => {
                if (this.checkAndTransformToForOfStatement(value)) changed = true;
            },
        });
        for (let round = 0; round < 8; round++) {
            let roundChanged = false;
            traverse(file(node), {
                DoWhileStatement: (value) => {
                    if (this.checkAndTransformDoWhileToForOfStatement(value)) {
                        roundChanged = true;
                        changed = true;
                    }
                },
            });
            if (!roundChanged) break;
        }
        this.removeUnusedTempDeclarations(node);
        return changed;
    }

    /** 在 Program/块/case 体的语句列表里还原连续守卫链(见 foldIfReturnChainToSwitch)。 */
    private foldIfReturnChains(node: Program): boolean {
        let changed = false;
        traverse(file(node), {
            Program:(value)=>{
                if (this.foldIfReturnChainToSwitch(value.node.body)) changed = true;
            },
            BlockStatement:(value)=>{
                if (this.foldIfReturnChainToSwitch(value.node.body)) changed = true;
            },
            SwitchCase:(value)=>{
                if (this.foldIfReturnChainToSwitch(value.node.consequent)) changed = true;
            },
        });
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
            DoWhileStatement:(value)=>{
                // 自顶向下:do-while 的 done 分支会搬到循环之后,内层循环随之外移;
                // 外层先还原,内层在下面的重复扫描里再处理。内层先还原时,它的
                // done 分支还嵌在外层里,循环变量的读取会跨出本循环而无法判定。
                if (this.checkAndTransformDoWhileToForOfStatement(value)) changed = true;
            },
            IfStatement:{
                // 用 exit 自底向上折叠:嵌套 if / else-if 先折成赋值语句,
                // 外层再与其合成三目(`if (!p2) {...} else if (B) { X = a } else { X = b }`)。
                exit:(value)=>{
                    if (this.checkAndTransformToConditionalAssignment(value)) {
                        changed = true;
                        return;
                    }
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

        // do-while 还原会把内层循环随 done 分支搬到循环之后(内层循环已不在
        // 本次遍历的队列里),重新扫描直到没有新的可还原形态。
        for (let guard = 0; guard < 32; guard++) {
            let round = false;
            traverse(file(node), {
                DoWhileStatement:(value)=>{
                    if (this.checkAndTransformDoWhileToForOfStatement(value)) {
                        round = true;
                        changed = true;
                    }
                },
            });
            if (!round) break;
        }

        // 同一语句列表里的连续 `if (disc === v) { return ...; }` 守卫链是
        // ArkTS 对源码 switch 的 lowering。先于 checkAndTransformToSwitchCase
        // 处理,避免链首 `if (A || B) { return ... }` 被单独折成只有两个 case
        // 的 switch、后面的守卫无法再合并;else-if 形态要等 flattenElseAfterExit
        // 展开后才出现,由 simplifyTail 再补一次。
        if (this.foldIfReturnChains(node)) changed = true;

        traverse(file(node), {
            IfStatement:(value)=>{
                // transform to switch case expression
                if (this.checkAndTransformToSwitchCase(value)) changed = true;
            }
        })
        return changed;
    }
}