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

        // null 的 case 必须为空,undefined 的 case 承载赋值(或反过来)
        const bodyCases = [nullCase, undefinedCase].filter((c) => c.consequent.length > 0);
        if (bodyCases.length !== 1) return false;
        const bodyCase = bodyCases[0];
        const body = bodyCase.consequent;
        if (body.length < 1 || body.length > 2) return false;
        if (body.length === 2 && !TYPE.isBreakStatement(body[1])) return false;
        const statement = body[0];
        if (!TYPE.isExpressionStatement(statement) || !TYPE.isAssignmentExpression(statement.expression)) return false;
        const assign = statement.expression;
        if (assign.operator !== "=" || !TYPE.isIdentifier(assign.left)) return false;
        const target = assign.left.name;

        const prev = path.getPrevSibling();
        if (!prev || !TYPE.isExpressionStatement(prev.node) || !TYPE.isAssignmentExpression(prev.node.expression)) return false;
        const prevAssign = prev.node.expression;
        if (prevAssign.operator !== "=" || !TYPE.isIdentifier(prevAssign.left) || prevAssign.left.name !== target) return false;

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
            TYPE.assignmentExpression("=", TYPE.identifier(target), TYPE.logicalExpression("??", value, assign.right)),
        );
        path.replaceWith(replacement);
        prev.remove();
        return true;
    }
}
