import { Program } from "@babel/types";
import { ISimplify } from "./ISimplify";
import traverse, { NodePath } from "@babel/traverse";
import * as TYPE from "@babel/types";
import { collectIdentifierNames, isDeclarationValue, isNodeEqual, isPureExpression } from "./AstUtils";

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
            return node;
        }
        if (!TYPE.isUnaryExpression(node) || node.operator !== "!") return node;
        const arg = node.argument;
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
            && TYPE.isBinaryExpression(node.test)) {
            if (node.test.operator === "!==") node.test.operator = "===";
            else if (node.test.operator === "!=") node.test.operator = "==";
            else return false;
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
