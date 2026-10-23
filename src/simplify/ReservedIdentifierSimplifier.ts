import { Program } from "@babel/types";
import { ISimplify } from "./ISimplify";
import traverse, { NodePath } from "@babel/traverse";
import * as TYPE from "@babel/types";
import { walkNode } from "./AstUtils";


const {
    file,
    identifier,
    isClass,
    isFunctionExpression,
    isIdentifier,
    memberExpression,
    isClassExpression: isClassExpressionNode,
    isClassMethod: isClassMethodNode,
} = TYPE;

/**
 * 还原编译器保留标识符:
 *   panda_jmp0_reserved_param_p0 -> this / 函数名 / 类名
 *   panda_jmp0_reserved_param_p1 -> new.target
 *   panda_jmp0_reserved_lex_begin -> 删除
 *   panda_jmp0_reserved_export_name_* -> 还原导出名
 *
 * @Author: jmp0
 * @Email: jmp0@qq.com
 */
export class ReservedIdentifierSimplifier implements ISimplify {
    simplify(node: Program): boolean {
        let changed = false;
        // export_name 还原依赖 Babel binding(需要整棵树 crawl)。先做一次纯 AST 扫描,
        // 没有这类标识符时跳过带 scope 的第二遍;主遍历只用到祖先关系,设 noScope。
        const hasExportName = this.hasExportNameBinding(node);
        if (hasExportName) {
            traverse(file(node), {
                Program: (path) => {
                    changed = this.rewriteExportNames(path) || changed;
                },
            });
        }
        traverse(file(node), {
            noScope: true,
            Identifier: (path) => {
                // 先按名字过滤:绝大多数标识符都不是保留名,避免对每个节点都做 findParent
                const name = path.node.name;
                const reservedParam = name.startsWith("panda_jmp0_reserved_param");
                if (!reservedParam && name !== "panda_jmp0_reserved_sendable_class"
                    && name !== "panda_jmp0_reserved_lex_begin") return;
                // babel 的 Import/Export Declaration 不属于 Statement,
                // 模块声明内的标识符找不到 statement parent,直接跳过
                const statementParent = path.findParent((p) => p.isStatement());
                if (statementParent == null) return;
                if (statementParent.node.type === "VariableDeclaration") return;

                if (reservedParam) {
                    if (name.endsWith("p0")) {
                        const func = path.getFunctionParent();
                        if (func == null) {
                            const statement = path.getStatementParent();
                            if (statement) statement.remove();
                            path.skip();
                            changed = true;
                            return;
                        }
                        if (isFunctionExpression(func.node)) {
                            if (func.node.id == null) {
                                const statement = path.getStatementParent();
                                if (statement) statement.remove();
                                path.skip();
                                changed = true;
                                return;
                            }
                            path.node.name = func.node.id.name;
                            changed = true;
                        }
                        if (isClassMethodNode(func.node)) {
                            if (func.node.kind === "constructor") {
                                const clazzNode = func.findParent((p) => p.isClassExpression());
                                if (clazzNode && isClassExpressionNode(clazzNode.node) && clazzNode.node.id) {
                                    path.node.name = clazzNode.node.id.name;
                                    changed = true;
                                }
                            } else if (isIdentifier(func.node.key)) {
                                path.node.name = func.node.key.name;
                                changed = true;
                            }
                        }
                        path.skip();
                        return;
                    }
                    if (path.node.name.endsWith("p1")) {
                        path.replaceWith(memberExpression(identifier("new"), identifier("target"), false));
                        path.skip();
                        changed = true;
                        return;
                    }
                }
                if (path.node.name === "panda_jmp0_reserved_sendable_class") {
                    const func = path.getFunctionParent();
                    if (func && func.isClassMethod()) {
                        const clazz = func.parentPath?.parentPath;
                        if (clazz && isClass(clazz.node) && clazz.node.id) {
                            path.replaceWith(clazz.node.id);
                            changed = true;
                        }
                    }
                }
                if (path.node.name === "panda_jmp0_reserved_lex_begin") {
                    const statement = path.getStatementParent();
                    if (statement) {
                        statement.remove();
                        changed = true;
                    }
                }
            },
        });
        return changed;
    }

    /** AST 里是否存在 panda_jmp0_reserved_export_name_* 标识符(纯 AST 扫描,不建 NodePath)。 */
    private hasExportNameBinding(node: Program): boolean {
        let found = false;
        walkNode(node, (n) => {
            if (found) return false;
            if (isIdentifier(n) && n.name.startsWith("panda_jmp0_reserved_export_name_")) {
                found = true;
                return false;
            }
            return true;
        });
        return found;
    }

    private rewriteExportNames(path: NodePath<Program>): boolean {
        let changed = false;
        const bindings = path.scope.getAllBindings();
        for (const bindingsKey in bindings) {
            if (!bindingsKey.startsWith("panda_jmp0_reserved_export_name_")) continue;
            const binding = bindings[bindingsKey];
            const keyName = bindingsKey.substring("panda_jmp0_reserved_export_name_".length);
            if (path.scope.references[keyName] === true) {
                for (const referencePath of binding.referencePaths) {
                    referencePath.replaceWith(identifier(keyName));
                }
                for (const constantViolation of binding.constantViolations) {
                    constantViolation.remove();
                    constantViolation.skip();
                }
                binding.path.remove();
                binding.path.skip();
                changed = true;
            }
        }
        return changed;
    }
}
