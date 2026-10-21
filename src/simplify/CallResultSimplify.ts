import { Program } from "@babel/types";
import { ISimplify } from "./ISimplify";
import traverse from "@babel/traverse";
import * as TYPE from "@babel/types";
import { walkNode } from "./AstUtils";

/**
 * 处理 callIns 调用结果被立即覆盖的情况:
 *
 *   acc = acc.call(...);   ->   acc.call(...);
 *   acc = xxx;                  acc = xxx;
 *
 * 旧实现没有校验赋值左侧是否为 acc,可能把 `v = call()` 直接替换成 `call;`,
 * 丢掉 v 的赋值。这里只处理 callIns 固定生成的 `acc = call` 形式。
 *
 * @Author: jmp0
 * @Email: jmp0@qq.com
 */
export class CallResultSimplify implements ISimplify {
    private containsIdentifier(node: TYPE.Node | null | undefined, name: string): boolean {
        let found = false;
        walkNode(node, (n) => {
            if (found) return false;
            if (TYPE.isIdentifier(n) && n.name === name) {
                found = true;
                return false;
            }
            return true;
        });
        return found;
    }

    simplify(node: Program): boolean {
        let changed = false;
        traverse(TYPE.file(node), {
            CallExpression: (value) => {
                if (!value.node.extra || !value.node.extra["callIns"]) return;
                const parent = value.getStatementParent();
                if (!parent || !parent.isExpressionStatement()) return;
                const expression = parent.get("expression");
                if (!expression.isAssignmentExpression() || expression.node.operator !== "=") return;
                if (!TYPE.isIdentifier(expression.node.left) || expression.node.left.name !== "acc") return;
                const next = parent.getNextSibling();
                if (!next || !next.isExpressionStatement()) return;
                const nextExpression = next.get("expression");
                if (!nextExpression.isAssignmentExpression() || nextExpression.node.operator !== "=") return;
                if (!TYPE.isIdentifier(nextExpression.node.left) || nextExpression.node.left.name !== "acc") return;
                // 下一条语句如果读取旧的 acc,则调用结果仍在使用
                if (this.containsIdentifier(nextExpression.node.right, "acc")) return;

                parent.node.expression = value.node;
                changed = true;
            },
        });
        return changed;
    }
}
