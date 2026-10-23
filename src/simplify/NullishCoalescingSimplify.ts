import { Program } from "@babel/types";
import traverse from "@babel/traverse";
import * as TYPE from "@babel/types";
import { isNodeEqual, isPureExpression } from "./AstUtils";

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
 * @Author: jmp0
 */
export class NullishCoalescingSimplify {
    simplify(node: Program): boolean {
        let changed = false;
        traverse(TYPE.file(node), {
            SwitchStatement: (path) => {
                if (this.foldSwitch(path)) changed = true;
            },
        });
        return changed;
    }

    private foldSwitch(path: any): boolean {
        const switchNode = path.node as TYPE.SwitchStatement;
        if (switchNode.cases.length !== 2) return false;

        const nullCase = switchNode.cases.find((c) => TYPE.isNullLiteral(c.test));
        const undefinedCase = switchNode.cases.find((c) => TYPE.isIdentifier(c.test, { name: "undefined" }));
        if (!nullCase || !undefinedCase || nullCase === undefinedCase) return false;

        const prev = path.getPrevSibling();
        if (!prev || !TYPE.isExpressionStatement(prev.node) || !TYPE.isAssignmentExpression(prev.node.expression)) return false;
        const prevAssign = prev.node.expression;
        if (prevAssign.operator !== "=" || !TYPE.isIdentifier(prevAssign.left)) return false;
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
        if (TYPE.isIdentifier(discriminant, { name: target })) {
            // switch 读的是刚赋给 target 的值
            value = prevAssign.right;
        } else if (isNodeEqual(discriminant, prevAssign.right) && isPureExpression(discriminant)) {
            // 复制传播把判别式换成了成员表达式;要求重复求值无副作用
            value = discriminant;
        } else {
            return false;
        }

        const replacement = TYPE.expressionStatement(
            TYPE.assignmentExpression("=", TYPE.identifier(target), TYPE.logicalExpression("??", value, fallback)),
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
        if (body.length === 2 && !TYPE.isBreakStatement(body[1])) return null;
        const statement = body[0];
        if (!TYPE.isExpressionStatement(statement) || !TYPE.isAssignmentExpression(statement.expression)) return null;
        const assign = statement.expression;
        if (assign.operator !== "=" || !TYPE.isIdentifier(assign.left) || assign.left.name !== target) return null;
        return assign.right;
    }
}
