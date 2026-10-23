import { Program } from "@babel/types";
import { ISimplify } from "./ISimplify";
import traverse, { NodePath } from "@babel/traverse";
import * as TYPE from "@babel/types";
import { collectIdentifierNames, isPureExpression, walkNode } from "./AstUtils";

/**
 * 处理 __defineGetter__ / __defineSetter__ 以及单表达式 class。
 *
 * 旧实现会删除 setter 调用之前直到 class 赋值之间的所有语句,可能误删构造函数体;
 * 这里只删除 getter/setter 调用本身和与之绑定的函数表达式赋值。
 *
 * @Author: jmp0
 * @Email: jmp0@qq.com
 */
class GetterSetterDesc {
    public target: TYPE.Identifier | null = null;
    public name = "";
    public getterFunc: TYPE.FunctionExpression | null = null;
    public setterFunc: TYPE.FunctionExpression | null = null;
    public clazz: TYPE.ClassExpression | null = null;
    public funcName: string | null = null;
}

export class ClassSyntaxSimplify implements ISimplify {
    private checkAssignLeftRight(node: TYPE.AssignmentExpression, ln: string, rn: string): boolean {
        const l = node.left;
        const r = node.right;
        return TYPE.isIdentifier(l) && l.name === ln && TYPE.isIdentifier(r) && r.name === rn;
    }

    private parseGetterSetterCallExpression(node: TYPE.CallExpression, gsd: GetterSetterDesc): "getter" | "setter" | null {
        const callee = node.callee;
        if (!TYPE.isMemberExpression(callee) || !TYPE.isIdentifier(callee.property)) return null;
        const kind = callee.property.name;
        if (kind !== "__defineGetter__" && kind !== "__defineSetter__") return null;
        if (!TYPE.isIdentifier(callee.object) || node.arguments.length !== 2) return null;
        gsd.target = callee.object;
        const name = node.arguments[0];
        if (!TYPE.isStringLiteral(name)) return null;
        gsd.name = name.value;
        const value = node.arguments[1];
        if (TYPE.isFunctionExpression(value)) {
            if (kind === "__defineGetter__") gsd.getterFunc = value;
            else gsd.setterFunc = value;
        } else if (TYPE.isIdentifier(value)) {
            gsd.funcName = value.name;
        }
        return kind === "__defineGetter__" ? "getter" : "setter";
    }

    private classWritesThisProperty(clazz: TYPE.ClassExpression, name: string): boolean {
        let found = false;
        walkNode(clazz.body, (node) => {
            if (found) return false;
            if (TYPE.isAssignmentExpression(node) && TYPE.isMemberExpression(node.left)
                && TYPE.isThisExpression(node.left.object)) {
                const property = node.left.property;
                if ((TYPE.isIdentifier(property) && property.name === name)
                    || (TYPE.isStringLiteral(property) && property.value === name)) {
                    found = true;
                    return false;
                }
            }
            return true;
        });
        return found;
    }

    private moveConstructorAssignmentToField(clazz: TYPE.ClassExpression, name: string): boolean {
        const constructor = clazz.body.body.find((member): member is TYPE.ClassMethod =>
            TYPE.isClassMethod(member) && member.kind === "constructor");
        if (!constructor || constructor.body.body.length !== 1) return false;
        const statement = constructor.body.body[0];
        if (!TYPE.isExpressionStatement(statement) || !TYPE.isAssignmentExpression(statement.expression)) return false;
        const assign = statement.expression;
        if (assign.operator !== "=" || !TYPE.isMemberExpression(assign.left)
            || !TYPE.isThisExpression(assign.left.object)) return false;
        const property = assign.left.property;
        const leftName = TYPE.isIdentifier(property) ? property.name
            : (TYPE.isStringLiteral(property) ? property.value : "");
        if (leftName !== name) return false;
        if (!isPureExpression(assign.right)) return false;
        if (collectIdentifierNames(assign.right).size > 0) return false;

        let hasThis = false;
        walkNode(assign.right, (node) => {
            if (TYPE.isThisExpression(node)) {
                hasThis = true;
                return false;
            }
            return true;
        });
        if (hasThis) return false;

        clazz.body.body.push(TYPE.classProperty(TYPE.identifier(name), assign.right));
        const index = clazz.body.body.indexOf(constructor);
        if (index >= 0) clazz.body.body.splice(index, 1);
        return true;
    }

    private findClass(path: NodePath<TYPE.CallExpression>, gsd: GetterSetterDesc): void {
        for (const pre of path.getStatementParent().getAllPrevSiblings()) {
            if (!TYPE.isExpressionStatement(pre.node)) continue;
            const expression = pre.node.expression;
            // 到达 __defineGetter__/__defineSetter__ 的作用域边界
            if (TYPE.isAssignmentExpression(expression) && TYPE.isClassExpression(expression.right)) {
                gsd.clazz = expression.right;
                return;
            }
            if (this.checkAssignLeftRight(expression, "acc", gsd.target.name)) {
                continue;
            }
        }
    }

    private findFunctionStatement(path: NodePath<TYPE.CallExpression>, name: string): NodePath<TYPE.Statement> | null {
        for (const pre of path.getStatementParent().getAllPrevSiblings()) {
            if (!TYPE.isExpressionStatement(pre.node) || !TYPE.isAssignmentExpression(pre.node.expression)) continue;
            const expression = pre.node.expression;
            if (TYPE.isIdentifier(expression.left) && expression.left.name === name
                && TYPE.isFunctionExpression(expression.right)) {
                return pre;
            }
        }
        return null;
    }

    private tryTransformPrototypeMethod(value: NodePath<TYPE.ExpressionStatement>): boolean {
        const expression = value.node.expression;
        if (!TYPE.isAssignmentExpression(expression) || expression.operator !== "=") return false;
        const left = expression.left;
        const right = expression.right;
        if (!TYPE.isMemberExpression(left) || !TYPE.isIdentifier(left.object)) return false;
        if (!TYPE.isFunctionExpression(right)) return false;
        if (left.computed && !TYPE.isStringLiteral(left.property)) return false;
        if (!left.computed && !TYPE.isIdentifier(left.property)) return false;
        const objectName = left.object.name;
        const property = left.property as TYPE.Identifier | TYPE.StringLiteral;
        const methodName = TYPE.isIdentifier(property) ? property.name : property.value;
        if (!methodName) return false;

        let ownerName: string | null = null;
        let clazz: TYPE.ClassExpression | null = null;
        for (const pre of value.getAllPrevSiblings()) {
            if (!TYPE.isExpressionStatement(pre.node) || !TYPE.isAssignmentExpression(pre.node.expression)) continue;
            const assign = pre.node.expression;
            if (assign.operator !== "=") continue;
            // P = Q.prototype
            if (ownerName === null && TYPE.isIdentifier(assign.left) && assign.left.name === objectName
                && TYPE.isMemberExpression(assign.right) && !assign.right.computed
                && TYPE.isIdentifier(assign.right.property) && assign.right.property.name === "prototype"
                && TYPE.isIdentifier(assign.right.object)) {
                ownerName = assign.right.object.name;
                continue;
            }
            // Q = class ...
            if (ownerName !== null && TYPE.isIdentifier(assign.left) && assign.left.name === ownerName) {
                if (TYPE.isClassExpression(assign.right)) {
                    clazz = assign.right;
                }
                break;
            }
        }
        if (!clazz) return false;
        const exists = clazz.body.body.some((member) => TYPE.isClassMethod(member)
            && ((TYPE.isIdentifier(member.key) && member.key.name === methodName)
                || (TYPE.isStringLiteral(member.key) && member.key.value === methodName)));
        if (exists) return false;

        const key = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(methodName)
            ? TYPE.identifier(methodName) : TYPE.stringLiteral(methodName);
        clazz.body.body.push(TYPE.classMethod(
            "method", key, right.params, right.body, false, false, right.generator, right.async));
        value.remove();
        return true;
    }

    simplify(node: Program): boolean {
        let changed = false;
        traverse(TYPE.file(node), {
            ClassMethod: (value: NodePath<TYPE.ClassMethod>) => {
                if (value.node.kind !== "constructor") return;
                const body = value.node.body.body;
                const last = body[body.length - 1];
                if (TYPE.isReturnStatement(last) && TYPE.isThisExpression(last.argument)) {
                    body.pop();
                    changed = true;
                }
            },
            ClassExpression: (value: NodePath<TYPE.ClassExpression>) => {
                if (TYPE.isIdentifier(value.node.superClass) && value.node.superClass.name === "hole") {
                    value.node.superClass = null;
                    changed = true;
                }
            },
            ClassDeclaration: (value: NodePath<TYPE.ClassDeclaration>) => {
                // 无 extends 的 class 表达式在 ArkTS 13 里父类是 hole 哨兵;
                // 类表达式被提升成类声明后同样要清掉,否则输出 `class X extends hole`
                if (TYPE.isIdentifier(value.node.superClass) && value.node.superClass.name === "hole") {
                    value.node.superClass = null;
                    changed = true;
                }
            },
            CallExpression: (value: NodePath<TYPE.CallExpression>) => {
                const gsd = new GetterSetterDesc();
                const kind = this.parseGetterSetterCallExpression(value.node, gsd);
                if (kind === null || !gsd.target || !gsd.name) return;
                // __defineGetter__/__defineSetter__(name, undefined) 在标准 JS 中会直接抛错,
                // 等价于没有定义访问器,删除调用。
                if (gsd.funcName === "undefined") {
                    value.getStatementParent().remove();
                    changed = true;
                    return;
                }

                this.findClass(value, gsd);
                if (!gsd.clazz) return;
                // 构造器里 this.x = ... 与 class getter 冲突时,能安全改写为 class field 就改写;
                // 否则保守跳过访问器转换。
                if (this.classWritesThisProperty(gsd.clazz, gsd.name)
                    && !this.moveConstructorAssignmentToField(gsd.clazz, gsd.name)) return;

                const functionStatement = gsd.funcName ? this.findFunctionStatement(value, gsd.funcName) : null;
                const func = functionStatement && TYPE.isExpressionStatement(functionStatement.node)
                    && TYPE.isAssignmentExpression(functionStatement.node.expression)
                    ? functionStatement.node.expression.right : null;

                let added = false;
                if (kind === "getter" && (gsd.getterFunc || TYPE.isFunctionExpression(func))) {
                    const fn = gsd.getterFunc || func as TYPE.FunctionExpression;
                    gsd.clazz.body.body.push(TYPE.classMethod("get", TYPE.identifier(gsd.name), [], fn.body));
                    added = true;
                } else if (kind === "setter" && (gsd.setterFunc || TYPE.isFunctionExpression(func))) {
                    const fn = gsd.setterFunc || func as TYPE.FunctionExpression;
                    gsd.clazz.body.body.push(TYPE.classMethod("set", TYPE.identifier(gsd.name), fn.params, fn.body));
                    added = true;
                } else if (gsd.funcName === "undefined") {
                    // __defineGetter__/__defineSetter__(name, undefined) 等价于未定义,调用本身可删
                    added = true;
                }
                if (!added) return;

                value.getStatementParent().remove();
                functionStatement?.remove();
                changed = true;
            },
            ExpressionStatement: (value: NodePath<TYPE.ExpressionStatement>) => {
                if (this.tryTransformPrototypeMethod(value)) {
                    changed = true;
                    return;
                }
                // 单表达式 class -> class 声明
                const expression = value.get("expression");
                if (expression.isClassExpression()) {
                    const classExp = expression.node;
                    if (!classExp.id) return;
                    value.replaceWith(TYPE.classDeclaration(classExp.id, classExp.superClass, classExp.body, classExp.decorators));
                    changed = true;
                }
            }
        });
        return changed;
    }
}
