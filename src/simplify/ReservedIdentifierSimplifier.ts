import { Program } from "@babel/types";
import { ISimplify } from "./ISimplify";
import traverse from "@babel/traverse";
import * as TYPE from "@babel/types";

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
        traverse(TYPE.file(node), {
            Identifier: (path) => {
                // babel 的 Import/Export Declaration 不属于 Statement,
                // 模块声明内的标识符找不到 statement parent,直接跳过
                const statementParent = path.findParent((p) => p.isStatement());
                if (statementParent == null) return;
                if (statementParent.node.type === "VariableDeclaration") return;

                if (path.node.name.startsWith("panda_jmp0_reserved_param")) {
                    if (path.node.name.endsWith("p0")) {
                        const func = path.getFunctionParent();
                        if (func == null) {
                            const statement = path.getStatementParent();
                            if (statement) statement.remove();
                            path.skip();
                            changed = true;
                            return;
                        }
                        if (TYPE.isFunctionExpression(func.node)) {
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
                        if (TYPE.isClassMethod(func.node)) {
                            if (func.node.kind === "constructor") {
                                const clazzNode = func.findParent((p) => p.isClassExpression());
                                if (clazzNode && TYPE.isClassExpression(clazzNode.node) && clazzNode.node.id) {
                                    path.node.name = clazzNode.node.id.name;
                                    changed = true;
                                }
                            } else if (TYPE.isIdentifier(func.node.key)) {
                                path.node.name = func.node.key.name;
                                changed = true;
                            }
                        }
                        path.skip();
                        return;
                    }
                    if (path.node.name.endsWith("p1")) {
                        path.replaceWith(TYPE.memberExpression(TYPE.identifier("new"), TYPE.identifier("target"), false));
                        path.skip();
                        changed = true;
                        return;
                    }
                }
                if (path.node.name === "panda_jmp0_reserved_sendable_class") {
                    const func = path.getFunctionParent();
                    if (func && func.isClassMethod()) {
                        const clazz = func.parentPath?.parentPath;
                        if (clazz && TYPE.isClass(clazz.node) && clazz.node.id) {
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
            Program: (path) => {
                const bindings = path.scope.getAllBindings();
                for (const bindingsKey in bindings) {
                    if (!bindingsKey.startsWith("panda_jmp0_reserved_export_name_")) continue;
                    const binding = bindings[bindingsKey];
                    const keyName = bindingsKey.substring("panda_jmp0_reserved_export_name_".length);
                    if (path.scope.references[keyName] === true) {
                        for (const referencePath of binding.referencePaths) {
                            referencePath.replaceWith(TYPE.identifier(keyName));
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
            }
        });
        return changed;
    }
}
