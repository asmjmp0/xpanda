import { Program } from "@babel/types";
import { ISimplify } from "./ISimplify";
import traverse, { NodePath } from "@babel/traverse";
import * as TYPE from "@babel/types";
import { collectIdentifierNames, isPureExpression, walkNode } from "./AstUtils";


const {
    classDeclaration,
    classMethod,
    classProperty,
    file,
    identifier,
    isAssignmentExpression,
    isClassMethod,
    isExpressionStatement,
    isFunctionExpression,
    isIdentifier,
    isMemberExpression,
    isReturnStatement,
    isStringLiteral,
    isThisExpression,
    stringLiteral,
    isClassExpression: isClassExpressionNode,
} = TYPE;

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
    /**
     * callee.object 是 `<id>.prototype` 而不是裸标识符。
     * 复制传播把原型寄存器内联后(TempVariableSimplify 在 ClassSyntaxSimplify 之前跑),
     * `v7.__defineGetter__(...)` 会变成 `acc.prototype.__defineGetter__(...)`,
     * yourpipe 等新版本编译产物的访问器/原型方法都是这种形态。
     */
    public prototypeForm = false;
}

/**
 * `X.prototype` 形态(非计算成员、属性名 prototype、对象是标识符)。
 */
function isPrototypeMember(node: TYPE.Node): node is TYPE.MemberExpression & { object: TYPE.Identifier } {
    return isMemberExpression(node) && !node.computed
        && isIdentifier(node.property) && node.property.name === "prototype"
        && isIdentifier(node.object);
}

/**
 * 从语句位置向前解析 `<name>` 当前绑定的类表达式(X.prototype.M = fn / X.M = fn 的直接形态)。
 * 沿途遇到对 `<cur>` 的赋值:右值是类表达式 → 命中;右值是标识符 → 别名转发继续找;
 * 其它值说明 `<cur>` 已被改写成本对象之外的东西,保守放弃,避免把访问器/方法折进错误的类。
 * 其它标识符的赋值一律跳过(词法上不影响 `<cur>` 的值)。
 */
function resolveClassForTarget(name: string, statement: NodePath<TYPE.Statement>): TYPE.ClassExpression | null {
    let current = name;
    for (const pre of statement.getAllPrevSiblings()) {
        if (!isExpressionStatement(pre.node)) continue;
        const expression = pre.node.expression;
        if (!isAssignmentExpression(expression) || !isIdentifier(expression.left)) continue;
        if (expression.left.name !== current) continue;
        if (isClassExpressionNode(expression.right)) return expression.right;
        if (isIdentifier(expression.right)) {
            current = expression.right.name;
            continue;
        }
        return null;
    }
    return null;
}

export class ClassSyntaxSimplify implements ISimplify {
    private checkAssignLeftRight(node: TYPE.AssignmentExpression, ln: string, rn: string): boolean {
        const l = node.left;
        const r = node.right;
        return isIdentifier(l) && l.name === ln && isIdentifier(r) && r.name === rn;
    }

    private parseGetterSetterCallExpression(node: TYPE.CallExpression, gsd: GetterSetterDesc): "getter" | "setter" | null {
        const callee = node.callee;
        if (!isMemberExpression(callee) || !isIdentifier(callee.property)) return null;
        const kind = callee.property.name;
        if (kind !== "__defineGetter__" && kind !== "__defineSetter__") return null;
        if (node.arguments.length !== 2) return null;
        // 裸标识符:v1.__defineGetter__(...) ;或内联原型:acc.prototype.__defineGetter__(...)
        if (isIdentifier(callee.object)) {
            gsd.target = callee.object;
        } else if (isPrototypeMember(callee.object)) {
            gsd.target = callee.object.object;
            gsd.prototypeForm = true;
        } else {
            return null;
        }
        const name = node.arguments[0];
        if (!isStringLiteral(name)) return null;
        gsd.name = name.value;
        const value = node.arguments[1];
        if (isFunctionExpression(value)) {
            if (kind === "__defineGetter__") gsd.getterFunc = value;
            else gsd.setterFunc = value;
        } else if (isIdentifier(value)) {
            gsd.funcName = value.name;
        }
        return kind === "__defineGetter__" ? "getter" : "setter";
    }

    /**
     * 构造器里是否写 `this.x = ...`。只有构造器里的这种赋值可能被当成 class field
     * 初始化;方法体里的 `this.x = ...` 本来就应该走原型 setter,不能因此放弃访问器转换。
     */
    private constructorWritesThisProperty(clazz: TYPE.ClassExpression, name: string): boolean {
        const constructor = clazz.body.body.find((member): member is TYPE.ClassMethod =>
            isClassMethod(member) && member.kind === "constructor");
        if (!constructor) return false;
        let found = false;
        walkNode(constructor.body, (node) => {
            if (found) return false;
            if (isAssignmentExpression(node) && isMemberExpression(node.left)
                && isThisExpression(node.left.object)) {
                const property = node.left.property;
                if ((isIdentifier(property) && property.name === name)
                    || (isStringLiteral(property) && property.value === name)) {
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
            isClassMethod(member) && member.kind === "constructor");
        if (!constructor || constructor.body.body.length !== 1) return false;
        const statement = constructor.body.body[0];
        if (!isExpressionStatement(statement) || !isAssignmentExpression(statement.expression)) return false;
        const assign = statement.expression;
        if (assign.operator !== "=" || !isMemberExpression(assign.left)
            || !isThisExpression(assign.left.object)) return false;
        const property = assign.left.property;
        const leftName = isIdentifier(property) ? property.name
            : (isStringLiteral(property) ? property.value : "");
        if (leftName !== name) return false;
        if (!isPureExpression(assign.right)) return false;
        if (collectIdentifierNames(assign.right).size > 0) return false;

        let hasThis = false;
        walkNode(assign.right, (node) => {
            if (isThisExpression(node)) {
                hasThis = true;
                return false;
            }
            return true;
        });
        if (hasThis) return false;

        clazz.body.body.push(classProperty(identifier(name), assign.right));
        const index = clazz.body.body.indexOf(constructor);
        if (index >= 0) clazz.body.body.splice(index, 1);
        return true;
    }

    private findClass(path: NodePath<TYPE.CallExpression>, gsd: GetterSetterDesc): void {
        const statement = path.getStatementParent();
        // acc.prototype.__defineGetter__(...) 直接形态:对象变量在定义点之后不允许被改写
        if (gsd.prototypeForm) {
            gsd.clazz = resolveClassForTarget(gsd.target!.name, statement);
            return;
        }
        for (const pre of statement.getAllPrevSiblings()) {
            if (!isExpressionStatement(pre.node)) continue;
            const expression = pre.node.expression;
            // 到达 __defineGetter__/__defineSetter__ 的作用域边界
            if (isAssignmentExpression(expression) && isClassExpressionNode(expression.right)) {
                gsd.clazz = expression.right;
                return;
            }
            if (isAssignmentExpression(expression) && this.checkAssignLeftRight(expression, "acc", gsd.target.name)) {
                continue;
            }
        }
    }

    private findFunctionStatement(path: NodePath<TYPE.CallExpression>, name: string): NodePath<TYPE.Statement> | null {
        for (const pre of path.getStatementParent().getAllPrevSiblings()) {
            if (!isExpressionStatement(pre.node) || !isAssignmentExpression(pre.node.expression)) continue;
            const expression = pre.node.expression;
            if (isIdentifier(expression.left) && expression.left.name === name
                && isFunctionExpression(expression.right)) {
                return pre as NodePath<TYPE.Statement>;
            }
        }
        return null;
    }

    private tryTransformPrototypeMethod(value: NodePath<TYPE.ExpressionStatement>): boolean {
        const expression = value.node.expression;
        if (!isAssignmentExpression(expression) || expression.operator !== "=") return false;
        const left = expression.left;
        const right = expression.right;
        if (!isMemberExpression(left) || !isFunctionExpression(right)) return false;
        if (left.computed && !isStringLiteral(left.property)) return false;
        if (!left.computed && !isIdentifier(left.property)) return false;
        const property = left.property as TYPE.Identifier | TYPE.StringLiteral;
        const methodName = isIdentifier(property) ? property.name : property.value;
        if (!methodName) return false;

        let clazz: TYPE.ClassExpression | null = null;
        if (isIdentifier(left.object)) {
            const objectName = left.object.name;
            let ownerName: string | null = null;
            for (const pre of value.getAllPrevSiblings()) {
                if (!isExpressionStatement(pre.node) || !isAssignmentExpression(pre.node.expression)) continue;
                const assign = pre.node.expression;
                if (assign.operator !== "=") continue;
                // P = Q.prototype
                if (ownerName === null && isIdentifier(assign.left) && assign.left.name === objectName
                    && isMemberExpression(assign.right) && !assign.right.computed
                    && isIdentifier(assign.right.property) && assign.right.property.name === "prototype"
                    && isIdentifier(assign.right.object)) {
                    ownerName = assign.right.object.name;
                    continue;
                }
                // Q = class ...
                if (ownerName !== null && isIdentifier(assign.left) && assign.left.name === ownerName) {
                    if (isClassExpressionNode(assign.right)) {
                        clazz = assign.right;
                    }
                    break;
                }
            }
        } else if (isPrototypeMember(left.object)) {
            // 直接形态:X.prototype.M = fn(原型寄存器被复制传播内联进对象位置)
            clazz = resolveClassForTarget(left.object.object.name, value);
        }
        if (!clazz) return false;
        const exists = clazz.body.body.some((member) => isClassMethod(member)
            && ((isIdentifier(member.key) && member.key.name === methodName)
                || (isStringLiteral(member.key) && member.key.value === methodName)));
        if (exists) return false;

        const key = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(methodName)
            ? identifier(methodName) : stringLiteral(methodName);
        clazz.body.body.push(classMethod(
            "method", key, right.params, right.body, false, false, right.generator, right.async));
        value.remove();
        return true;
    }

    /**
     * `X.M = function(){...}`(对象直接挂在类上)→ 类的 static 方法。
     * 必须在 tryTransformPrototypeMethod 之后调用:两步形态的 `P.M = fn` 已被前者
     * 消费;这里向前解析 X 时遇到 `P = Q.prototype`(右值非类/标识符)会直接放弃,
     * 不会把实例方法重复折成静态。
     */
    private tryTransformStaticMethod(value: NodePath<TYPE.ExpressionStatement>): boolean {
        const expression = value.node.expression;
        if (!isAssignmentExpression(expression) || expression.operator !== "=") return false;
        const left = expression.left;
        const right = expression.right;
        if (!isMemberExpression(left) || !isIdentifier(left.object) || !isFunctionExpression(right)) return false;
        if (left.computed && !isStringLiteral(left.property)) return false;
        if (!left.computed && !isIdentifier(left.property)) return false;
        const property = left.property as TYPE.Identifier | TYPE.StringLiteral;
        const methodName = isIdentifier(property) ? property.name : property.value;
        if (!methodName) return false;
        const clazz = resolveClassForTarget(left.object.name, value);
        if (!clazz) return false;
        const exists = clazz.body.body.some((member) => isClassMethod(member)
            && member.static
            && ((isIdentifier(member.key) && member.key.name === methodName)
                || (isStringLiteral(member.key) && member.key.value === methodName)));
        if (exists) return false;

        const key = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(methodName)
            ? identifier(methodName) : stringLiteral(methodName);
        clazz.body.body.push(classMethod(
            "method", key, right.params, right.body, false, true, right.generator, right.async));
        value.remove();
        return true;
    }

    simplify(node: Program): boolean {
        let changed = false;
        traverse(file(node), {
            // 只用到祖先关系,不需要 scope:跳过 Babel 的逐作用域 crawl
            noScope: true,
            ClassMethod: (value: NodePath<TYPE.ClassMethod>) => {
                if (value.node.kind !== "constructor") return;
                const body = value.node.body.body;
                const last = body[body.length - 1];
                if (isReturnStatement(last) && isThisExpression(last.argument)) {
                    body.pop();
                    changed = true;
                }
            },
            ClassExpression: (value: NodePath<TYPE.ClassExpression>) => {
                if (isIdentifier(value.node.superClass) && value.node.superClass.name === "hole") {
                    value.node.superClass = null;
                    changed = true;
                }
            },
            ClassDeclaration: (value: NodePath<TYPE.ClassDeclaration>) => {
                // 无 extends 的 class 表达式在 ArkTS 13 里父类是 hole 哨兵;
                // 类表达式被提升成类声明后同样要清掉,否则输出 `class X extends hole`
                if (isIdentifier(value.node.superClass) && value.node.superClass.name === "hole") {
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
                // 否则保守跳过访问器转换。方法体里的 this.x = ... 会走 setter,不构成冲突。
                if (this.constructorWritesThisProperty(gsd.clazz, gsd.name)
                    && !this.moveConstructorAssignmentToField(gsd.clazz, gsd.name)) return;

                const functionStatement = gsd.funcName ? this.findFunctionStatement(value, gsd.funcName) : null;
                const func = functionStatement && isExpressionStatement(functionStatement.node)
                    && isAssignmentExpression(functionStatement.node.expression)
                    ? functionStatement.node.expression.right : null;

                let added = false;
                if (kind === "getter" && (gsd.getterFunc || isFunctionExpression(func))) {
                    const fn = gsd.getterFunc || func as TYPE.FunctionExpression;
                    gsd.clazz.body.body.push(classMethod("get", identifier(gsd.name), [], fn.body));
                    added = true;
                } else if (kind === "setter" && (gsd.setterFunc || isFunctionExpression(func))) {
                    const fn = gsd.setterFunc || func as TYPE.FunctionExpression;
                    gsd.clazz.body.body.push(classMethod("set", identifier(gsd.name), fn.params, fn.body));
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
                if (this.tryTransformStaticMethod(value)) {
                    changed = true;
                    return;
                }
                // 单表达式 class -> class 声明
                const expression = value.get("expression");
                if (expression.isClassExpression()) {
                    const classExp = expression.node;
                    if (!classExp.id) return;
                    value.replaceWith(classDeclaration(classExp.id, classExp.superClass, classExp.body, classExp.decorators));
                    changed = true;
                }
            }
        });
        return changed;
    }
}
