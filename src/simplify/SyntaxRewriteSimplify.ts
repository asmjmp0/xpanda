import { Program } from "@babel/types";
import { ISimplify } from "./ISimplify";
import traverse, { NodePath } from "@babel/traverse";
import * as TYPE from "@babel/types";
import { collectIdentifierNames, isDeclarationValue, isNodeEqual, isPureExpression, isTempName } from "./AstUtils";

/**
 * 通用语法重写:
 *   - 化简 if 条件里的 !/逻辑运算
 *   - if/else 结构归一化
 *   - 调用形式 a.call(b, ...) -> a(...)
 *   - 函数表达式 -> 函数声明
 *   - 删除重复 acc = undefined / 尾部 return undefined
 *
 * 所有变换都在节点上原地完成,不再在每个 visitor 里 scope.crawl()。
 *
 * @Author: jmp0
 * @Email: jmp0@qq.com
 */
export class SyntaxRewriteSimplify implements ISimplify {
    public static binaryInvert(node: TYPE.BinaryExpression): TYPE.BinaryExpression["operator"] | null {
        switch (node.operator) {
            case "!=": return "==";
            case "!==": return "===";
            case "<": return ">=";
            case "<=": return ">";
            case ">": return "<=";
            case "==": return "!=";
            case "===": return "!==";
            case ">=": return "<";
            default: return null;
        }
    }

    private invertOperand(node: TYPE.Expression): TYPE.Expression {
        if (TYPE.isBinaryExpression(node) || TYPE.isLogicalExpression(node)) {
            return this.invertExpression(node);
        }
        return TYPE.unaryExpression("!", node);
    }

    /** 对表达式取反(用于 if 分支交换)。 */
    private invertExpression(node: TYPE.Expression): TYPE.Expression {
        if (TYPE.isBinaryExpression(node)) {
            const invert = SyntaxRewriteSimplify.binaryInvert(node);
            if (invert == null) return TYPE.unaryExpression("!", node);
            node.operator = invert;
            return node;
        }
        if (TYPE.isLogicalExpression(node)) {
            node.left = this.invertOperand(node.left);
            node.right = this.invertOperand(node.right);
            node.operator = node.operator === "||" ? "&&" : "||";
            return node;
        }
        if (TYPE.isUnaryExpression(node) && node.operator === "!") {
            return node.argument;
        }
        return TYPE.unaryExpression("!", node);
    }

    /** 化简 if/while 的 test:!!a -> a,!a == b -> a != b,!a && !b -> ... */
    private simplifyTestNode(node: TYPE.Expression): TYPE.Expression {
        node = this.unwrapParens(node);
        // ConditionSimplify 删除序列中间元素后可能留下单元素序列
        while (TYPE.isSequenceExpression(node) && node.expressions.length === 1) {
            node = this.unwrapParens(node.expressions[0] as TYPE.Expression);
        }
        if (TYPE.isSequenceExpression(node)) {
            if (node.expressions.length > 0) {
                node.expressions[node.expressions.length - 1] =
                    this.simplifyTestNode(node.expressions[node.expressions.length - 1]);
            }
            return node;
        }
        if (TYPE.isLogicalExpression(node)) {
            node.left = this.simplifyTestNode(node.left);
            node.right = this.simplifyTestNode(node.right);
            const nullish = this.mergeNullishCheck(node);
            return nullish ?? node;
        }
        if (!TYPE.isUnaryExpression(node) || node.operator !== "!") return node;
        let arg = this.unwrapParens(node.argument as TYPE.Expression);
        while (TYPE.isSequenceExpression(arg) && arg.expressions.length === 1) {
            arg = this.unwrapParens(arg.expressions[0] as TYPE.Expression);
        }
        if (arg !== node.argument) node.argument = arg;
        if (TYPE.isUnaryExpression(arg) && arg.operator === "!") {
            return this.simplifyTestNode(arg.argument);
        }
        if (TYPE.isBinaryExpression(arg)) {
            const invert = SyntaxRewriteSimplify.binaryInvert(arg);
            if (invert != null) {
                arg.operator = invert;
                return this.simplifyTestNode(arg);
            }
        }
        if (TYPE.isLogicalExpression(arg)) {
            return this.simplifyTestNode(this.invertExpression(arg));
        }
        if (TYPE.isBooleanLiteral(arg)) {
            return TYPE.booleanLiteral(!arg.value);
        }
        return node;
    }

    /**
     * 三元表达式的布尔分支化简(分支是 true/false 时,三元本质上就是逻辑运算):
     *   !T ? A : B    -> T ? B : A   (严格等价)
     *   T ? false : B -> !T && B     (严格等价)
     *   T ? B : false -> T && B
     *   T ? true : B  -> T || B
     *   T ? B : true  -> !T || B
     * 后三条把 T 当布尔值使用,与 HighLevelGrammarSimplify 里
     * `T ? true : false -> T` 的既有约定保持一致。
     *
     * 返回 null 表示没有变化;返回 node 本身表示原地修改(可继续化简);返回其他节点表示需要替换。
     */
    private foldBooleanConditional(node: TYPE.ConditionalExpression): TYPE.Expression | null {
        const test = node.test;
        if (TYPE.isUnaryExpression(test) && test.operator === "!") {
            node.test = test.argument;
            const consequent = node.consequent;
            node.consequent = node.alternate;
            node.alternate = consequent;
            return node;
        }
        const consequent = node.consequent;
        const alternate = node.alternate;
        const consequentBool = TYPE.isBooleanLiteral(consequent) ? consequent.value : null;
        const alternateBool = TYPE.isBooleanLiteral(alternate) ? alternate.value : null;
        if (consequentBool === true && alternateBool === false) return test;
        if (consequentBool === false && alternateBool === true) return this.invertExpression(test);
        if (consequentBool === false) return TYPE.logicalExpression("&&", this.invertExpression(test), alternate);
        if (alternateBool === false) return TYPE.logicalExpression("&&", test, consequent);
        if (consequentBool === true) return TYPE.logicalExpression("||", test, alternate);
        if (alternateBool === true) return TYPE.logicalExpression("||", this.invertExpression(test), consequent);
        return null;
    }

    private unwrapParens(node: TYPE.Expression): TYPE.Expression {
        let current = node;
        while (TYPE.isParenthesizedExpression(current)) current = (current as any).expression;
        return current;
    }

    private isUndefinedNode(node: TYPE.Node): boolean {
        if (TYPE.isIdentifier(node) && node.name === "undefined") return true;
        return TYPE.isUnaryExpression(node) && node.operator === "void"
            && TYPE.isNumericLiteral(node.argument) && node.argument.value === 0;
    }

    /** 返回 `x === null` / `x !== undefined` 这类比较里的 x;不是该形式则返回 null。 */
    private nullishCheckTarget(node: TYPE.Expression, operator: "===" | "!==", kind: "null" | "undefined"): TYPE.Identifier | null {
        node = this.unwrapParens(node);
        if (!TYPE.isBinaryExpression(node) || node.operator !== operator) return null;
        if (!TYPE.isIdentifier(node.left)) return null;
        const right = this.unwrapParens(node.right as TYPE.Expression);
        const matched = kind === "null" ? TYPE.isNullLiteral(right) : this.isUndefinedNode(right);
        return matched ? node.left : null;
    }

    /** x === null || x === undefined -> x == null;x !== null && x !== undefined -> x != null */
    private mergeNullishCheck(node: TYPE.LogicalExpression): TYPE.BinaryExpression | null {
        const isOr = node.operator === "||";
        const isAnd = node.operator === "&&";
        if (!isOr && !isAnd) return null;
        const operator = isOr ? "===" : "!==";
        const left = this.unwrapParens(node.left as TYPE.Expression);
        const right = this.unwrapParens(node.right as TYPE.Expression);
        const leftNull = this.nullishCheckTarget(left, operator, "null");
        const leftUndefined = this.nullishCheckTarget(left, operator, "undefined");
        const rightNull = this.nullishCheckTarget(right, operator, "null");
        const rightUndefined = this.nullishCheckTarget(right, operator, "undefined");
        const target = leftNull && rightUndefined && leftNull.name === rightUndefined.name
            ? leftNull
            : leftUndefined && rightNull && leftUndefined.name === rightNull.name
                ? leftUndefined
                : null;
        if (!target) return null;
        return TYPE.binaryExpression(isOr ? "==" : "!=", target, TYPE.nullLiteral());
    }

    /** 供流水线末尾调用:HighLevelGrammarSimplify 可能新生成 if/三元,需要再归一化一次 test。 */
    public static normalizeConditionTests(node: Program): void {
        const pass = new SyntaxRewriteSimplify();
        traverse(TYPE.file(node), {
            IfStatement: (path) => {
                for (let i = 0; i < 4; i++) {
                    path.node.test = pass.simplifyTestNode(path.node.test);
                    if (!pass.transformIfOnce(path)) break;
                }
            },
            WhileStatement: (path) => {
                path.node.test = pass.simplifyTestNode(path.node.test);
            },
            DoWhileStatement: (path) => {
                path.node.test = pass.simplifyTestNode(path.node.test);
            },
            ConditionalExpression: (path) => {
                let test = pass.simplifyTestNode(path.node.test);
                if (test !== path.node.test) path.node.test = test;
                for (let i = 0; i < 4; i++) {
                    const folded = pass.foldBooleanConditional(path.node);
                    if (!folded) break;
                    if (folded === path.node) continue;
                    path.replaceWith(folded);
                    break;
                }
            },
        });
    }

    /**
     * 把 `if (A || (v1 = 0, v2 = 2, B)) return;` 里只给临时变量赋常量字面量的
     * 前缀语句提到 if 前面:
     *   v1 = 0;
     *   v2 = 2;
     *   if (A || B) return;
     * 只有短路分支直接 return/throw、且不读取这些临时变量时才安全
     * (短路时原本不会执行前缀,提到前面后会在 A 为真时也执行;
     * 分支直接退出且不读取,就不会观察到这个差异)。
     */
    public static hoistTestPrefixes(node: Program): void {
        const isHoistableValue = (expr: TYPE.Node | null | undefined): boolean => {
            if (!expr) return false;
            if (TYPE.isNumericLiteral(expr) || TYPE.isStringLiteral(expr)
                || TYPE.isBooleanLiteral(expr) || TYPE.isNullLiteral(expr)) return true;
            if (TYPE.isIdentifier(expr) && expr.name === "undefined") return true;
            if (TYPE.isUnaryExpression(expr)) {
                if (expr.operator === "void") return TYPE.isNumericLiteral(expr.argument);
                return (expr.operator === "-" || expr.operator === "+") && TYPE.isNumericLiteral(expr.argument);
            }
            return false;
        };
        const alwaysExits = (stmt: TYPE.Statement | null | undefined): boolean => {
            if (!stmt) return false;
            if (TYPE.isReturnStatement(stmt) || TYPE.isThrowStatement(stmt)) return true;
            if (TYPE.isBlockStatement(stmt)) return stmt.body.some(alwaysExits);
            if (TYPE.isIfStatement(stmt)) {
                return stmt.alternate != null && alwaysExits(stmt.consequent) && alwaysExits(stmt.alternate);
            }
            return false;
        };
        traverse(TYPE.file(node), {
            IfStatement: (path) => {
                const test = path.node.test;
                if (!TYPE.isLogicalExpression(test) || test.operator !== "||") return;
                const right = test.right;
                if (!TYPE.isSequenceExpression(right) || right.expressions.length < 2) return;
                const prefix: TYPE.ExpressionStatement[] = [];
                const names = new Set<string>();
                for (let i = 0; i < right.expressions.length - 1; i++) {
                    const expr = right.expressions[i];
                    if (!TYPE.isAssignmentExpression(expr) || expr.operator !== "=") return;
                    if (!TYPE.isIdentifier(expr.left) || !isTempName(expr.left.name)) return;
                    if (!isHoistableValue(expr.right)) return;
                    names.add(expr.left.name);
                    prefix.push(TYPE.expressionStatement(expr));
                }
                if (prefix.length === 0) return;
                // A 侧不能读写这些临时变量(提到前面会改变 A 看到的值)
                for (const name of names) {
                    if (collectIdentifierNames(test.left).has(name)) return;
                }
                // 短路分支必须直接退出,且不读取这些临时变量
                const consequent = path.node.consequent;
                if (!alwaysExits(consequent)) return;
                for (const name of names) {
                    if (collectIdentifierNames(consequent).has(name)) return;
                }
                // finally 能观察到提前赋值后的值
                if (path.findParent((p) => p.isTryStatement() && p.node.finalizer != null)) return;
                path.insertBefore(prefix);
                test.right = right.expressions[right.expressions.length - 1] as TYPE.Expression;
            },
        });
    }

    private checkIsAccUndefined(stmt: TYPE.Statement): boolean {
        return TYPE.isExpressionStatement(stmt)
            && TYPE.isAssignmentExpression(stmt.expression)
            && TYPE.isIdentifier(stmt.expression.left) && stmt.expression.left.name === "acc"
            && TYPE.isIdentifier(stmt.expression.right) && stmt.expression.right.name === "undefined";
    }

    private removeFunctionReturnUndefined(body: TYPE.BlockStatement): boolean {
        const statements = body.body;
        if (statements.length < 2) return false;
        const last = statements[statements.length - 1];
        const last2 = statements[statements.length - 2];
        if (this.checkIsAccUndefined(last2)
            && TYPE.isReturnStatement(last) && last.argument == null) {
            statements.pop();
            statements.pop();
            return true;
        }
        return false;
    }

    private duplicateAccUndefined(block: TYPE.BlockStatement): boolean {
        let changed = false;
        for (let i = block.body.length - 1; i > 0; i--) {
            if (this.checkIsAccUndefined(block.body[i]) && this.checkIsAccUndefined(block.body[i - 1])) {
                block.body.splice(i, 1);
                changed = true;
            }
        }
        return changed;
    }

    private changeCallExpression(node: TYPE.CallExpression): boolean {
        const callee = node.callee;
        if (!TYPE.isMemberExpression(callee) || callee.computed) return false;
        if (!TYPE.isIdentifier(callee.property) || callee.property.name !== "call") return false;
        if (node.arguments.length === 0) return false;

        const fn = callee.object;
        const receiver = node.arguments[0];
        // 只有 receiver 明确是 null/undefined,或 fn 就是 receiver.method 时,
        // fn.call(receiver, ...) 才能安全地写成 fn(...)
        const receiverIsNullish = TYPE.isNullLiteral(receiver)
            || (TYPE.isIdentifier(receiver) && receiver.name === "undefined")
            || (TYPE.isUnaryExpression(receiver) && receiver.operator === "void");
        const receiverMatchesObject = TYPE.isMemberExpression(fn)
            && (isNodeEqual(fn.object as TYPE.Node, receiver as TYPE.Node)
                || (TYPE.isSuper(fn.object) && TYPE.isThisExpression(receiver)));
        if (!receiverIsNullish && !receiverMatchesObject) return false;

        let object = fn;
        if (TYPE.isMemberExpression(object) && object.computed && TYPE.isStringLiteral(object.property)) {
            object.property = TYPE.identifier(object.property.value);
            object.computed = false;
        }
        node.callee = object as TYPE.Expression;
        node.arguments.shift();
        return true;
    }

    private isDiscardableExpression(node: TYPE.Expression): boolean {
        if (isDeclarationValue(node)) return false;
        if (TYPE.isMemberExpression(node) || TYPE.isOptionalMemberExpression(node)
            || TYPE.isCallExpression(node) || TYPE.isNewExpression(node)
            || TYPE.isAssignmentExpression(node) || TYPE.isUpdateExpression(node)
            || TYPE.isAwaitExpression(node) || TYPE.isYieldExpression(node)
            || TYPE.isTaggedTemplateExpression(node)) {
            return false;
        }
        return isPureExpression(node);
    }

    /** X = [a]; X[1] = b; X[2] = c; -> X = [a, b, c]; */
    private foldArrayAssignments(stmts: TYPE.Statement[]): boolean {
        let changed = false;
        for (let i = 0; i < stmts.length; i++) {
            const statement = stmts[i];
            if (!TYPE.isExpressionStatement(statement) || !TYPE.isAssignmentExpression(statement.expression)) continue;
            const init = statement.expression;
            if (init.operator !== "=" || !TYPE.isIdentifier(init.left) || !TYPE.isArrayExpression(init.right)) continue;
            const name = init.left.name;
            const array = init.right;
            if (array.elements.some((e) => TYPE.isSpreadElement(e))) continue;

            let j = i + 1;
            for (; j < stmts.length; j++) {
                const next = stmts[j];
                if (!TYPE.isExpressionStatement(next) || !TYPE.isAssignmentExpression(next.expression)) break;
                const assign = next.expression;
                if (assign.operator !== "=" || !TYPE.isMemberExpression(assign.left)) break;
                const member = assign.left;
                if (!member.computed || !TYPE.isIdentifier(member.object) || member.object.name !== name) break;
                const indexNode = member.property;
                const index = TYPE.isNumericLiteral(indexNode) ? indexNode.value
                    : (TYPE.isStringLiteral(indexNode) && /^\d+$/.test(indexNode.value) ? Number(indexNode.value) : NaN);
                if (!Number.isInteger(index) || index < 0 || index !== array.elements.length) break;
                if (collectIdentifierNames(assign.right).has(name)) break;
                array.elements.push(assign.right);
                changed = true;
            }
            if (j > i + 1) {
                stmts.splice(i + 1, j - (i + 1));
                i--;
            }
        }
        return changed;
    }

    private invertTestNode(node: TYPE.Expression): TYPE.Expression {
        if (TYPE.isUnaryExpression(node) && node.operator === "!") return node.argument;
        if (TYPE.isBinaryExpression(node)) {
            const op = SyntaxRewriteSimplify.binaryInvert(node);
            if (op == null) return TYPE.unaryExpression("!", node);
            node.operator = op;
            return node;
        }
        return TYPE.unaryExpression("!", node);
    }

    /** 只做一次结构变换;返回是否发生变化。 */
    private transformIfOnce(value: NodePath<TYPE.IfStatement>): boolean {
        const node = value.node;
        const consequent = node.consequent;
        const alternate = node.alternate;

        // else { if (...) ... } -> else if (...)
        if (TYPE.isBlockStatement(alternate) && alternate.body.length === 1
            && TYPE.isIfStatement(alternate.body[0])) {
            node.alternate = alternate.body[0];
            return true;
        }
        // if (test) { if (test2) ... } else {...}
        if (TYPE.isBlockStatement(consequent) && consequent.body.length === 1
            && TYPE.isIfStatement(consequent.body[0]) && alternate != null) {
            node.test = this.invertTestNode(node.test);
            node.consequent = alternate;
            node.alternate = consequent.body[0];
            return true;
        }
        // if (a !== b) A else B -> if (a === b) B else A
        if (TYPE.isBlockStatement(consequent) && TYPE.isBlockStatement(alternate)
            && TYPE.isBinaryExpression(node.test)
            && (node.test.operator === "!==" || node.test.operator === "!=")) {
            node.test.operator = node.test.operator === "!==" ? "===" : "==";
            node.consequent = alternate;
            node.alternate = consequent;
            return true;
        }
        // 空 else
        if (TYPE.isBlockStatement(alternate) && alternate.body.length === 0) {
            node.alternate = null;
            return true;
        }
        // 空 if 分支
        if (TYPE.isBlockStatement(consequent) && consequent.body.length === 0
            && TYPE.isBlockStatement(alternate)) {
            node.test = this.invertExpression(node.test);
            node.consequent = alternate;
            node.alternate = null;
            return true;
        }
        return false;
    }

    /** 定点迭代稳定后执行:x = x op y -> x op= y(避免提前改写干扰复制传播/活跃性) */
    public static foldCompoundAssignments(node: Program): void {
        traverse(TYPE.file(node), {
            AssignmentExpression: (value) => {
                const assign = value.node;
                if (assign.operator !== "=" || !TYPE.isIdentifier(assign.left)) return;
                const right = assign.right;
                if (!TYPE.isBinaryExpression(right)) return;
                if (!TYPE.isIdentifier(right.left) || right.left.name !== assign.left.name) return;
                switch (right.operator) {
                    case "+": case "-": case "*": case "/": case "%":
                    case "<<": case ">>": case ">>>": case "&": case "|": case "^": case "**":
                        break;
                    default:
                        return;
                }
                assign.operator = (right.operator + "=") as TYPE.AssignmentExpression["operator"];
                assign.right = right.right;
            },
        });
    }

    simplify(node: Program): boolean {
        let changed = false;
        traverse(TYPE.file(node), {
            IfStatement: (value) => {
                const simplified = this.simplifyTestNode(value.node.test);
                if (simplified !== value.node.test) {
                    value.node.test = simplified;
                    changed = true;
                }
                for (let i = 0; i < 8; i++) {
                    if (!this.transformIfOnce(value)) break;
                    changed = true;
                }
            },
            ConditionalExpression: (value) => {
                for (let i = 0; i < 4; i++) {
                    const folded = this.foldBooleanConditional(value.node);
                    if (!folded) break;
                    changed = true;
                    if (folded === value.node) continue;
                    value.replaceWith(folded);
                    break;
                }
            },
            UpdateExpression: (value) => {
                const parent = value.getStatementParent();
                if (!parent || !parent.isExpressionStatement()) return;
                const expression = parent.node.expression;
                if (!TYPE.isAssignmentExpression(expression) || expression.right !== value.node) return;
                const left = expression.left;
                const right = value.node.argument;
                if (TYPE.isIdentifier(left) && TYPE.isIdentifier(right) && left.name === right.name) {
                    parent.node.expression = expression.right;
                    changed = true;
                }
            },
            BlockStatement: (value) => {
                if (this.duplicateAccUndefined(value.node)) changed = true;
            },
            Function: (value) => {
                if (!TYPE.isBlockStatement(value.node.body)) return;
                if (this.removeFunctionReturnUndefined(value.node.body)) {
                    changed = true;
                }
                // 末尾的裸 return; 等价于自然结束
                const body = value.node.body.body;
                const last = body[body.length - 1];
                if (TYPE.isReturnStatement(last) && last.argument == null) {
                    body.pop();
                    changed = true;
                }
            },
            MemberExpression: (value) => {
                if (value.node.computed && TYPE.isStringLiteral(value.node.property)) {
                    const name = value.node.property.value;
                    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) {
                        value.node.property = TYPE.identifier(name);
                        value.node.computed = false;
                        changed = true;
                    }
                }
                if (!TYPE.isIdentifier(value.node.object) || value.node.object.name !== "arguments") return;
                if (!TYPE.isNumericLiteral(value.node.property)) return;
                const functionParent = value.getFunctionParent();
                if (!functionParent) return;
                const paramsLength = functionParent.node.params.length;
                const memNum = value.node.property.value;
                if (memNum < paramsLength) {
                    value.replaceWith(TYPE.identifier("p" + memNum));
                    changed = true;
                }
            },
            CallExpression: (value) => {
                if (this.changeCallExpression(value.node)) changed = true;
            },
            FunctionExpression: (value) => {
                const statement = value.getStatementParent();
                if (!statement || !statement.isExpressionStatement()) return;
                if (statement.node.expression !== value.node) return;
                const fn = value.node;
                // 匿名函数表达式不能转成函数声明(声明必须有名字)
                if (!fn.id) return;
                statement.replaceWith(TYPE.functionDeclaration(fn.id, fn.params, fn.body, fn.generator, fn.async));
                changed = true;
            },
            UnaryExpression: (value) => {
                if (value.node.operator !== "!") return;
                const arg = value.node.argument;
                if (TYPE.isNumericLiteral(arg)) {
                    value.replaceWith(TYPE.booleanLiteral(arg.value === 0));
                    changed = true;
                } else if (TYPE.isBooleanLiteral(arg)) {
                    value.replaceWith(TYPE.booleanLiteral(!arg.value));
                    changed = true;
                }
            },
            ExpressionStatement: (value) => {
                if (value.node.directive) return;
                if (this.isDiscardableExpression(value.node.expression)) {
                    value.remove();
                    changed = true;
                }
            },
            SpreadElement: (value) => {
                if (TYPE.isArrayExpression(value.node.argument) && value.node.argument.elements.length === 1) {
                    value.replaceWith(value.node.argument.elements[0]);
                    changed = true;
                }
            },
        });

        traverse(TYPE.file(node), {
            Program: (value) => {
                if (this.foldArrayAssignments(value.node.body)) changed = true;
            },
            BlockStatement: (value) => {
                if (this.foldArrayAssignments(value.node.body)) changed = true;
            },
        });
        return changed;
    }
}
