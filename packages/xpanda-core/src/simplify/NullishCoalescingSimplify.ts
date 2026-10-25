import { Program } from "@babel/types";
import traverse from "@babel/traverse";
import * as TYPE from "@babel/types";
import { collectReadNames, isNodeEqual, isPureExpression } from "./AstUtils";


const {
    assignmentExpression,
    expressionStatement,
    file,
    identifier,
    isAssignmentExpression,
    isBinaryExpression,
    isBlockStatement,
    isBreakStatement,
    isExpressionStatement,
    isIdentifier,
    isLogicalExpression,
    isNullLiteral,
    isStatement,
    logicalExpression,
} = TYPE;

/**
 * 还原 nullish coalescing 的 switch lowering:
 *
 *   v8 = obj.contentId;
 *   switch (obj.contentId) {
 *     case null:
 *     case undefined:
 *       v8 = "";
 *       break;
 *   }
 *   =>
 *   v8 = obj.contentId ?? "";
 *
 * 另一种形态是两个 case 各自赋值同一个默认值(编译器把 `a ?? b` 展开成
 * `if (a === null) b = d; else if (a === undefined) b = d`):
 *
 *   v0 = v0 == null ? undefined : v0.voteupCount;
 *   switch (v0) {
 *     case null:
 *       v0 = 0;
 *       break;
 *     case undefined:
 *       v0 = 0;
 *       break;
 *   }
 *   =>
 *   v0 = (v0 == null ? undefined : v0.voteupCount) ?? 0;
 *
 * HighLevelGrammarSimplify 会把 `if (x === null || x === undefined) x = default`
 * 合成 switch；当判别式和赋值目标不是同一个临时变量（判别式已被复制传播成成员表达式）
 * 时，现有的 canTransform2questionMarkStatement 无法还原，这里在流水线末尾补一轮。
 *
 * 没有走 switch 的形态也在这里还原（见 foldIf / foldConditional）：
 *
 *   v8 = v6?.text;
 *   acc = v8?.runs;
 *   if (acc == null) { acc = []; }
 *   return acc;
 *   =>
 *   v8 = v6?.text;
 *   return v8?.runs ?? [];
 *
 * @Author: jmp0
 */
export class NullishCoalescingSimplify {
    simplify(node: Program): boolean {
        let changed = false;
        traverse(file(node), {
            noScope: true,
            SwitchStatement: (path) => {
                if (this.foldSwitch(path)) changed = true;
            },
            IfStatement: (path) => {
                if (this.foldIf(path)) changed = true;
            },
            ConditionalExpression: (path) => {
                if (this.foldConditional(path)) changed = true;
            },
        });
        return changed;
    }

    /**
     * `X = E; if (X == null) { X = D }` → `X = E ?? D`。
     *
     * 这是 `a ?? d` 最常见的 lowering(判别式在被赋值的临时量上):
     *
     *   v8 = v6?.text;
     *   acc = v8?.runs;
     *   if (acc == null) {
     *     acc = [];
     *   }
     *   return acc;
     * =>
     *   return v8?.runs ?? [];
     *
     * 也接受未合并的严格形态(`X === null || X === undefined`)与取反形态
     * (`X != null` / `X !== null && X !== undefined`)——后者的 nullish 分支在 else。
     * 必须是紧邻的一条 `X = E`(E 的求值次数与顺序在 ?? 里完全一致)、分支体只有
     * `X = D` 一条语句(另一分支为空),且 D 不读取 X(?? 的右值读到的仍是合并前的值)。
     * 放在 foldReturnAssignments 之前执行,`X = E ?? D; return X` 才能继续折成
     * `return E ?? D`。
     */
    private foldIf(path: any): boolean {
        const ifNode = path.node as TYPE.IfStatement;
        const check = this.nullishTarget(ifNode.test);
        if (!check) return false;
        const nullishBranch = check.truthyIsNullish ? ifNode.consequent : ifNode.alternate;
        const otherBranch = check.truthyIsNullish ? ifNode.alternate : ifNode.consequent;
        if (!nullishBranch || (otherBranch && !this.isEmptyBranch(otherBranch))) return false;

        const prev = path.getPrevSibling();
        if (!prev || !isExpressionStatement(prev.node) || !isAssignmentExpression(prev.node.expression)) return false;
        const prevAssign = prev.node.expression;
        if (prevAssign.operator !== "=" || !isIdentifier(prevAssign.left)) return false;
        const target = prevAssign.left.name;

        const defaultValue = this.nullishAssignment(nullishBranch, target);
        if (!defaultValue) return false;
        // ?? 的右值读到的是 X 的旧值(此时为 null/undefined),不能依赖它。
        if (collectReadNames(defaultValue).has(target)) return false;
        // 判别式要么就是被赋值的临时量,要么与右值完全相同(复制传播把临时量换成了
        // 纯成员表达式,switch 形态的 foldSwitch 也走同样的判定)。
        const matchesTemp = isIdentifier(check.target) && check.target.name === target;
        const matchesValue = isNodeEqual(check.target, prevAssign.right) && isPureExpression(check.target);
        if (!matchesTemp && !matchesValue) return false;

        prev.replaceWith(expressionStatement(
            assignmentExpression("=", identifier(target), logicalExpression("??", prevAssign.right, defaultValue)),
        ));
        path.remove();
        return true;
    }

    /**
     * `X == null ? D : X`(`X === null || X === undefined ? D : X`)→ `X ?? D`。
     * 条件为真时 X 一定是 null/undefined,两分支与 ?? 逐一对应;判别式必须与
     * 非 nullish 分支是同一个表达式。
     */
    private foldConditional(path: any): boolean {
        const node = path.node as TYPE.ConditionalExpression;
        const check = this.nullishTarget(node.test);
        if (!check) return false;
        const value = check.truthyIsNullish ? node.alternate : node.consequent;
        const defaultValue = check.truthyIsNullish ? node.consequent : node.alternate;
        if (!isNodeEqual(check.target, value as TYPE.Expression) || !isPureExpression(check.target)) return false;
        path.replaceWith(logicalExpression("??", check.target, defaultValue));
        return true;
    }

    /** 分支是否为空(空块 / 空语句 / `X = X` 自赋值)。 */
    private isEmptyBranch(branch: TYPE.Node): boolean {
        if (isBlockStatement(branch)) {
            return branch.body.every((stmt) => isStatement(stmt) && this.isNoOpStatement(stmt));
        }
        return isStatement(branch) && this.isNoOpStatement(branch);
    }

    private isNoOpStatement(stmt: TYPE.Statement): boolean {
        if (stmt.type === "EmptyStatement") return true;
        if (!isExpressionStatement(stmt) || !isAssignmentExpression(stmt.expression)) return false;
        const assign = stmt.expression;
        return assign.operator === "=" && isIdentifier(assign.left) && isIdentifier(assign.right)
            && assign.left.name === assign.right.name;
    }

    /** 分支体只含 `name = value;` 时返回 value。 */
    private nullishAssignment(branch: TYPE.Node, name: string): TYPE.Expression | null {
        const body = isBlockStatement(branch) ? branch.body : [branch as TYPE.Statement];
        if (body.length !== 1) return null;
        const stmt = body[0];
        if (!isExpressionStatement(stmt) || !isAssignmentExpression(stmt.expression)) return null;
        const assign = stmt.expression;
        if (assign.operator !== "=" || !isIdentifier(assign.left) || assign.left.name !== name) return null;
        return assign.right;
    }

    /**
     * 识别 nullish 判断:返回被判断的变量名,以及“test 为真时是 nullish 分支”。
     *   X == null / X === null || X === undefined          → true
     *   X != null / X !== null && X !== undefined          → false
     */
    private nullishTarget(test: TYPE.Expression): { target: TYPE.Expression; truthyIsNullish: boolean } | null {
        if (isBinaryExpression(test) && (test.operator === "==" || test.operator === "!=")) {
            if (!isNullLiteral(test.right)) return null;
            return { target: test.left as TYPE.Expression, truthyIsNullish: test.operator === "==" };
        }
        if (isBinaryExpression(test) && (test.operator === "==" || test.operator === "!=") && isNullLiteral(test.left)) {
            return { target: test.right as TYPE.Expression, truthyIsNullish: test.operator === "==" };
        }
        if (isLogicalExpression(test) && (test.operator === "||" || test.operator === "&&")) {
            const isOr = test.operator === "||";
            const left = test.left as TYPE.Expression;
            const right = test.right as TYPE.Expression;
            const leftTarget = isOr ? this.strictCheck(left, "===", "null") : this.strictCheck(left, "!==", "null");
            const rightTarget = isOr
                ? this.strictCheck(right, "===", "undefined")
                : this.strictCheck(right, "!==", "undefined");
            if (!leftTarget || !rightTarget || !isNodeEqual(leftTarget, rightTarget)) return null;
            return { target: leftTarget, truthyIsNullish: isOr };
        }
        return null;
    }

    private strictCheck(node: TYPE.Node, operator: string, kind: "null" | "undefined"): TYPE.Expression | null {
        if (!isBinaryExpression(node) || node.operator !== operator) return null;
        const matched = kind === "null" ? isNullLiteral(node.right) : isIdentifier(node.right, { name: "undefined" });
        return matched ? node.left as TYPE.Expression : null;
    }

    private foldSwitch(path: any): boolean {
        const switchNode = path.node as TYPE.SwitchStatement;
        if (switchNode.cases.length !== 2) return false;

        const nullCase = switchNode.cases.find((c) => isNullLiteral(c.test));
        const undefinedCase = switchNode.cases.find((c) => isIdentifier(c.test, { name: "undefined" }));
        if (!nullCase || !undefinedCase || nullCase === undefinedCase) return false;

        const prev = path.getPrevSibling();
        if (!prev || !isExpressionStatement(prev.node) || !isAssignmentExpression(prev.node.expression)) return false;
        const prevAssign = prev.node.expression;
        if (prevAssign.operator !== "=" || !isIdentifier(prevAssign.left)) return false;
        const target = prevAssign.left.name;

        // 每个 case 要么为空(fallthrough),要么是 `target = value; [break;]`。
        // 两个 case 都赋值时,右值必须完全相同。
        const nullValue = this.caseAssignedValue(nullCase, target);
        const undefinedValue = this.caseAssignedValue(undefinedCase, target);
        if (nullValue === null || undefinedValue === null) return false;
        if (nullValue === undefined && undefinedValue === undefined) return false;
        if (nullValue !== undefined && undefinedValue !== undefined && !isNodeEqual(nullValue, undefinedValue)) return false;
        // 只有一个 case 赋值时依赖 fallthrough:有值的 case 必须排在后面,
        // 否则判别式为较早 case 的值时不会执行赋值(例如 null 有值、undefined 为空)。
        if ((nullValue === undefined) !== (undefinedValue === undefined)) {
            const bodyCase = nullValue !== undefined ? nullCase : undefinedCase;
            if (switchNode.cases[switchNode.cases.length - 1] !== bodyCase) return false;
        }
        const fallback = nullValue !== undefined ? nullValue : undefinedValue!;

        const discriminant = switchNode.discriminant;
        let value: TYPE.Expression;
        if (isIdentifier(discriminant, { name: target })) {
            // switch 读的是刚赋给 target 的值
            value = prevAssign.right;
        } else if (isNodeEqual(discriminant, prevAssign.right) && isPureExpression(discriminant)) {
            // 复制传播把判别式换成了成员表达式;要求重复求值无副作用
            value = discriminant;
        } else {
            return false;
        }

        const replacement = expressionStatement(
            assignmentExpression("=", identifier(target), logicalExpression("??", value, fallback)),
        );
        path.replaceWith(replacement);
        prev.remove();
        return true;
    }

    /**
     * 读取 case 体的赋值右值:
     *   - 空 case(靠 fallthrough)返回 undefined;
     *   - 不是 `target = value; [break;]` 返回 null。
     */
    private caseAssignedValue(caseNode: TYPE.SwitchCase, target: string): TYPE.Expression | null | undefined {
        const body = caseNode.consequent;
        if (body.length === 0) return undefined;
        if (body.length > 2) return null;
        if (body.length === 2 && !isBreakStatement(body[1])) return null;
        const statement = body[0];
        if (!isExpressionStatement(statement) || !isAssignmentExpression(statement.expression)) return null;
        const assign = statement.expression;
        if (assign.operator !== "=" || !isIdentifier(assign.left) || assign.left.name !== target) return null;
        return assign.right;
    }
}
