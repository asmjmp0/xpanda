import * as TYPE from '@babel/types';
import traverse, { NodePath } from '@babel/traverse'
import { ISimplify } from "./ISimplify";
import { isDeclarationValue, isPureExpression, walkNode } from "./AstUtils";


const {
    file,
    isAssignmentExpression,
    isAwaitExpression,
    isCallExpression,
    isIdentifier,
    isMemberExpression,
    isNewExpression,
    isOptionalMemberExpression,
    isReferenced,
    isTaggedTemplateExpression,
    isUpdateExpression,
    isYieldExpression,
} = TYPE;

/**
 * 兜底清理:删除没有任何读取的变量声明与无效果表达式语句。
 *
 * 主流程中临时变量的死存储/未使用声明已经由 TempVariableSimplify 处理,这个 pass 不再依赖
 * Babel scope(避免重复声明导致的 crawl 异常),只用全文件标识符读取集合判断。
 *
 * @Author: jmp0
 * @Email: jmp0@qq.com
 */
export class UnusedCleanupSimplify implements ISimplify {
    private isDiscardableExpression(node: TYPE.Expression): boolean {
        if (isDeclarationValue(node)) return false;
        if (isMemberExpression(node) || isOptionalMemberExpression(node)
            || isCallExpression(node) || isNewExpression(node)
            || isAssignmentExpression(node) || isUpdateExpression(node)
            || isAwaitExpression(node) || isYieldExpression(node)
            || isTaggedTemplateExpression(node)) {
            return false;
        }
        return isPureExpression(node);
    }

    simplify(node: TYPE.Program): boolean {
        let changed = false;
        const readNames = new Set<string>();
        walkNode(node, (n, parent) => {
            if (isIdentifier(n) && parent && isReferenced(n, parent)) {
                readNames.add(n.name);
            }
        });

        const noScopeTraverse = (traverse as any);
        noScopeTraverse(file(node), {
            noScope: true,
            VariableDeclarator: (value: NodePath<TYPE.VariableDeclarator>) => {
                if (!isIdentifier(value.node.id)) return;
                if (readNames.has(value.node.id.name)) return;
                value.remove();
                changed = true;
            },
            AssignmentExpression: (value: NodePath<TYPE.AssignmentExpression>) => {
                if (!isIdentifier(value.node.left)) return;
                if (readNames.has(value.node.left.name)) return;
                const right = value.node.right;
                const statement = value.getStatementParent();
                const statementLevel = !!statement && statement.isExpressionStatement()
                    && (statement.node as TYPE.ExpressionStatement).expression === value.node;
                if (isDeclarationValue(right)) {
                    if (statementLevel) {
                        (statement.node as TYPE.ExpressionStatement).expression = right;
                    } else {
                        value.replaceWith(right);
                    }
                } else if (isPureExpression(right)) {
                    if (statementLevel) statement.remove();
                    else value.replaceWith(right);
                } else {
                    value.replaceWith(right);
                }
                changed = true;
            },
            ExpressionStatement: (value: NodePath<TYPE.ExpressionStatement>) => {
                if (value.node.directive) return;
                if (this.isDiscardableExpression(value.node.expression)) {
                    value.remove();
                    changed = true;
                }
            },
        });
        return changed;
    }
}
