import { Program } from "@babel/types";
import { ISimplify } from "./ISimplify";
import traverse, { NodePath } from "@babel/traverse";
import * as TYPE from "@babel/types";
import { collectIdentifierNames, isPureExpression, isTempName, walkNode } from "./AstUtils";


const {
    VISITOR_KEYS,
    classDeclaration,
    classMethod,
    classProperty,
    file,
    identifier,
    isEmptyStatement,
    isAssignmentExpression,
    isBlockStatement,
    isClassExpression,
    isClassMethod,
    isClassProperty,
    isExpressionStatement,
    isForInStatement,
    isForOfStatement,
    isFunctionExpression,
    isIdentifier,
    isMemberExpression,
    isObjectMethod,
    isObjectProperty,
    isOptionalMemberExpression,
    isReturnStatement,
    isStringLiteral,
    isThisExpression,
    isUpdateExpression,
    isVariableDeclaration,
    isVariableDeclarator,
    stringLiteral,
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
        if (isClassExpression(expression.right)) return expression.right;
        if (isIdentifier(expression.right)) {
            current = expression.right.name;
            continue;
        }
        return null;
    }
    return null;
}

/**
 * 静态初始化折叠专用的接收者解析:从 `.call(接收者)` 语句向前找 `current` 的
 * 最后一次赋值(getAllPrevSiblings 按最近优先返回),沿途只允许不影响 `current`
 * 取值的语句:
 *  - 写到链外名字的纯标识符拷贝(`local_1_0 = acc`,编译器的 lexenv/寄存器搬运),
 *  - 无初始化的 `let X;` 声明 / 空语句。
 * 出现任何潜在副作用语句(调用、有初始化的声明、非赋值表达式)一律放弃——
 * 这保证类定义与调用之间没有副作用,右值(可以不纯,如 `new Set()`)搬进
 * 类体后求值顺序不变。
 * chainOut 收集链上全部名字(接收者 + 别名),用于右值引用检查。
 */
function resolveStaticInitReceiver(
    name: string, statement: NodePath<TYPE.Statement>, chainOut: Set<string>,
): TYPE.ClassExpression | null {
    let current = name;
    chainOut.add(current);
    for (const pre of statement.getAllPrevSiblings()) {
        const node = pre.node;
        if (node == null) break;
        if (isEmptyStatement(node)) continue;
        if (isVariableDeclaration(node)) {
            if (node.declarations.some((d) => d.init != null)) return null;
            continue;
        }
        if (!isExpressionStatement(node)) return null;
        const expression = node.expression;
        if (!isAssignmentExpression(expression) || expression.operator !== "="
            || !isIdentifier(expression.left)) return null;
        if (expression.left.name !== current) {
            // 写到链外名字:只有纯标识符拷贝才不影响 current 的取值
            if (!isIdentifier(expression.right)) return null;
            continue;
        }
        if (isClassExpression(expression.right)) return expression.right;
        if (isIdentifier(expression.right)) {
            current = expression.right.name;
            chainOut.add(current);
            continue;
        }
        // current 被覆盖成其它值,接收者不再是类
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
            if (isAssignmentExpression(expression) && isClassExpression(expression.right)) {
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
                    if (isClassExpression(assign.right)) {
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

    /**
     * 类静态字段初始化还原:defineclasswithbuffer 之后,编译器把源码的静态字段
     * 初始化收集成 #static_initializer 方法,用 callthis0 以类为 this 调用:
     *
     *   acc = class R{...}; local_1_0 = acc;
     *   (function () { this.dir = ""; this.tags = new Set(); ... }).call(acc);
     *
     * 函数体只含 `this.NAME = 右值` 时还原成类的 static 字段并删除调用。
     * 这条调用插在类定义与模块名赋值之间,不是别名赋值,会让模块级类定义折叠
     * (foldModuleClassDeclarations)的别名链扫描失败;先折掉它,后面才能把
     * `class R{}` + `Name = acc` 折叠成 `class Name {}`。
     */
    public static foldClassStaticInitializers(program: Program): boolean {
        let changed = false;
        traverse(file(program), {
            // 只用到祖先关系,不需要 scope:跳过 Babel 的逐作用域 crawl
            noScope: true,
            CallExpression: (value: NodePath<TYPE.CallExpression>) => {
                const call = value.node;
                if (!isMemberExpression(call.callee) || call.callee.computed) return;
                if (!isIdentifier(call.callee.property) || call.callee.property.name !== "call") return;
                if (!isFunctionExpression(call.callee.object)) return;
                if (call.arguments.length !== 1 || !isIdentifier(call.arguments[0])) return;
                const statement = value.getStatementParent();
                if (!statement.isExpressionStatement()
                    || (statement.node as TYPE.ExpressionStatement).expression !== call) return;
                // 接收者必须向前解析到类表达式,且沿途只有纯别名拷贝/声明
                // (保证类定义与调用之间没有副作用语句,右值搬进类体后求值顺序不变)。
                const receiverNames = new Set<string>();
                const clazz = resolveStaticInitReceiver(call.arguments[0].name, statement, receiverNames);
                if (!clazz) return;
                const props = this.buildStaticInitProperties(clazz, call.callee.object, receiverNames);
                if (!props) return;
                clazz.body.body.unshift(...props);
                statement.remove();
                changed = true;
            },
        });
        return changed;
    }

    /**
     * 静态初始化函数体 → static 字段列表。每个语句都必须是 `this.NAME = 右值`;
     * 右值不能引用 this(保守)、类接收者链上的名字(搬进类体后读到正在初始化的
     * 类绑定,TDZ/undefined 语义会变)、arguments 与 new.target(函数体内的绑定,
     * 字段初始化器里语义不同);与类体已有成员同名时保守放弃。
     * 右值允许不纯:解析器已保证求值位置与原调用一致,副作用顺序不变。
     */
    private static buildStaticInitProperties(
        clazz: TYPE.ClassExpression,
        fn: TYPE.FunctionExpression,
        receiverNames: Set<string>,
    ): TYPE.ClassProperty[] | null {
        const props: TYPE.ClassProperty[] = [];
        for (const stmt of fn.body.body) {
            if (!isExpressionStatement(stmt) || !isAssignmentExpression(stmt.expression)
                || stmt.expression.operator !== "=") return null;
            const left = stmt.expression.left;
            if (!isMemberExpression(left) || !isThisExpression(left.object) || left.computed) return null;
            const property = left.property;
            const name = isIdentifier(property) ? property.name
                : (isStringLiteral(property) ? property.value : null);
            if (name === null || name === "") return null;
            const rhs = stmt.expression.right;
            let blocked = false;
            walkNode(rhs, (node) => {
                if (isThisExpression(node) || node.type === "MetaProperty"
                    || (isIdentifier(node) && node.name === "arguments")) {
                    blocked = true;
                    return false;
                }
                return true;
            });
            if (blocked) return null;
            for (const ref of collectIdentifierNames(rhs)) {
                if (receiverNames.has(ref)) return null;
            }
            const exists = clazz.body.body.some((member) => {
                if (!isClassProperty(member) && !isClassMethod(member)) return false;
                const key = member.key;
                const keyName = isIdentifier(key) ? key.name : (isStringLiteral(key) ? key.value : null);
                return keyName === name;
            });
            if (exists) return null;
            const key = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)
                ? identifier(name) : stringLiteral(name);
            const prop = classProperty(key, rhs);
            prop.static = true;
            props.push(prop);
        }
        return props.length > 0 ? props : null;
    }

    /**
     * 把模块级类定义的寄存器/别名链折叠回 `class Name {}` 声明(见文件尾部的形态说明)。
     * 在管线尾部调用:此时 acc 枢纽、原型装载残留已被定点迭代清干净,定义语句与
     * 目标赋值之间只剩别名搬运语句,链上出现任何其它语句都保守放弃。
     */
    public static foldModuleClassDeclarations(program: Program): boolean {
        let changed = false;
        // 每次折叠都会移除一个定义语句(替换成类声明),类声明不会再被匹配,循环必然终止
        while (true) {
            const contexts = new Map<TYPE.Node, StatementListContext>();
            buildListContexts(program.body, program, null, contexts);
            let folded = false;
            for (const [owner, ctx] of contexts) {
                for (let i = 0; i < ctx.list.length; i++) {
                    const fold = buildFold(program, contexts, owner, ctx, i);
                    if (!fold) continue;
                    applyFold(program, contexts, fold);
                    folded = true;
                    changed = true;
                    break;
                }
                if (folded) break;
            }
            if (!folded) break;
        }
        return changed;
    }
}

// ---------------------------------------------------------------- 模块级类声明还原
//
// ArkTS 把源码的 `class Name {}` 编译成「匿名类表达式 + 寄存器/词法环境搬运」:
//
//   { let local_1_0; acc = class <匿名>{}; local_1_0 = acc; }   // lexenv 自引用槽
//   Name = acc;                                                 // stmodulevar
//   export { Name };
//
// 复制传播后还会出现 `T = class <匿名>{}; Name = T;`(T 为 lexenv 临时)、
// `Name = class <匿名>{};`(模块名直赋)与 `let Name = class <匿名>{};` 三种变体。
// 这里在管线尾部把它们统一折叠回 `class Name {}` 类声明,类方法里对
// lexenv 自引用槽的读取同步改名为 Name。
//
// 语义等价性:`let Name;` + `Name = class{}` 与 `class Name {}` 一样都是
// 块级 TDZ 绑定,类头(extends)仍在原执行位置求值;改名后类体内部的自引用
// 从外部槽读取变成类名绑定,取值相同。

/** 语句列表上下文:只登记「作为列表元素出现的块」(lexenv 块的形态),链扫描只沿它们跨越作用域 */
interface StatementListContext {
    list: TYPE.Statement[];
    parent: { owner: TYPE.Node; index: number } | null;
}

/** 类定义落点描述与折叠所需信息 */
interface ModuleClassFold {
    stmt: TYPE.Statement;
    list: TYPE.Statement[];
    listOwner: TYPE.Node;
    listParent: { owner: TYPE.Node; index: number } | null;
    classExpr: TYPE.ClassExpression;
    /** 定义语句的赋值目标(可能是 acc/lexenv 临时/模块名) */
    holder: string;
    /** 别名链上的临时名(不含 acc),读取要改名为 target */
    aliases: string[];
    /** 要删除的别名赋值语句及其所在列表 */
    chain: Array<{ stmt: TYPE.Statement; list: TYPE.Statement[] }>;
    /** 最终模块级绑定名 */
    target: string;
    /** 用类声明替换的目标语句;null 表示直接在 stmt 原位替换 */
    targetStmt: TYPE.Statement | null;
    targetList: TYPE.Statement[] | null;
    /** 目标语句所在列表的宿主节点(targetStmt 为 null 时是 listOwner) */
    targetOwner: TYPE.Node;
    /**
     * 非 null 时类声明插到 program.body 中该块元素之后(锚点在块内,类绑定必须落到
     * 模块作用域);null 时锚点本身就在 program.body,原位替换即可。
     */
    programInsertAfter: TYPE.Node | null;
    /** 校验阶段收集的待删 no-init declarator(别名槽 + 目标模块名的 `let` 声明) */
    declarators: TYPE.VariableDeclarator[];
}

function isValidBindingName(name: string): boolean {
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) && !isTempName(name)
        && !name.startsWith("panda_jmp0_reserved_");
}

function buildListContexts(
    list: TYPE.Statement[],
    owner: TYPE.Node,
    parent: StatementListContext["parent"],
    contexts: Map<TYPE.Node, StatementListContext>,
): void {
    contexts.set(owner, { list, parent });
    for (let i = 0; i < list.length; i++) {
        const stmt = list[i];
        if (isBlockStatement(stmt)) buildListContexts(stmt.body, stmt, { owner, index: i }, contexts);
    }
}

/** 从 (owner, index) 之后按执行顺序枚举语句,只经由「列表元素块」向上跨越作用域 */
function* forwardStatements(
    contexts: Map<TYPE.Node, StatementListContext>,
    startOwner: TYPE.Node,
    startIndex: number,
): Generator<{ stmt: TYPE.Statement; owner: TYPE.Node }> {
    let owner: TYPE.Node | null = startOwner;
    let index = startIndex;
    while (owner) {
        const ctx = contexts.get(owner);
        if (!ctx) return;
        while (index < ctx.list.length) {
            yield { stmt: ctx.list[index], owner };
            index++;
        }
        owner = ctx.parent ? ctx.parent.owner : null;
        index = ctx.parent ? ctx.parent.index + 1 : 0;
    }
}

interface NameUsage {
    total: number;
    declaratorsNoInit: TYPE.VariableDeclarator[];
    declaratorsWithInit: number;
    writes: number;
    /** 自增/复合赋值/for-in-of 头部等非普通赋值写入 */
    otherWrites: number;
    /** 参数/函数·类名/import 本地名/catch 参数/标签等绑定位置 */
    bindings: number;
    /** export specifier 引用(对目标模块名合法) */
    exportSpecs: number;
}

function scanNameUsage(program: TYPE.Program, name: string, skipNode: TYPE.Node): NameUsage {
    const usage: NameUsage = {
        total: 0, declaratorsNoInit: [], declaratorsWithInit: 0,
        writes: 0, otherWrites: 0, bindings: 0, exportSpecs: 0,
    };
    walkNode(program, (node, parent, key) => {
        if (node === skipNode) return false;
        if (!isIdentifier(node) || node.name !== name) return true;
        usage.total++;
        const p = parent as TYPE.Node | null;
        if (p && isVariableDeclarator(p) && key === "id") {
            if (p.init == null) usage.declaratorsNoInit.push(p);
            else usage.declaratorsWithInit++;
            return true;
        }
        if (p && isAssignmentExpression(p) && p.left === node) {
            if (p.operator === "=") usage.writes++;
            else usage.otherWrites++;
            return true;
        }
        if (p && isUpdateExpression(p)) { usage.otherWrites++; return true; }
        if (p && (isForInStatement(p) || isForOfStatement(p)) && p.left === node) { usage.otherWrites++; return true; }
        if (p && (p.type === "LabeledStatement" || p.type === "BreakStatement" || p.type === "ContinueStatement") && key === "label") {
            usage.bindings++;
            return true;
        }
        if (p && (p.type === "ImportSpecifier" || p.type === "ImportDefaultSpecifier" || p.type === "ImportNamespaceSpecifier")) {
            usage.bindings++;
            return true;
        }
        if (p && p.type === "ExportSpecifier") { usage.exportSpecs++; return true; }
        if (p && (p.type === "FunctionDeclaration" || p.type === "FunctionExpression"
            || p.type === "ArrowFunctionExpression" || p.type === "ObjectMethod" || p.type === "ClassMethod")
            && key === "params") {
            usage.bindings++;
            return true;
        }
        if (p && (p.type === "FunctionDeclaration" || p.type === "FunctionExpression"
            || p.type === "ClassDeclaration" || p.type === "ClassExpression") && key === "id") {
            usage.bindings++;
            return true;
        }
        if (p && p.type === "CatchClause" && key === "param") { usage.bindings++; return true; }
        return true;
    });
    return usage;
}

function countPlainWrites(stmts: TYPE.Statement[], name: string): number {
    let count = 0;
    for (const stmt of stmts) {
        walkNode(stmt, (node) => {
            if (isAssignmentExpression(node) && node.operator === "=" && isIdentifier(node.left) && node.left.name === name) count++;
            return true;
        });
    }
    return count;
}

/** 匹配 `X = class R{}` / 单 declarator `let X = class R{}`;返回 null 表示不是定义点 */
function matchClassDeclSite(stmt: TYPE.Statement): { classExpr: TYPE.ClassExpression; holder: string } | null {
    if (isExpressionStatement(stmt) && isAssignmentExpression(stmt.expression)
        && stmt.expression.operator === "=" && isIdentifier(stmt.expression.left)
        && isClassExpression(stmt.expression.right)) {
        return { classExpr: stmt.expression.right, holder: stmt.expression.left.name };
    }
    if (isVariableDeclaration(stmt) && stmt.declarations.length === 1) {
        const declarator = stmt.declarations[0];
        if (isIdentifier(declarator.id) && isClassExpression(declarator.init)) {
            return { classExpr: declarator.init, holder: declarator.id.name };
        }
    }
    return null;
}

function buildFold(
    program: TYPE.Program,
    contexts: Map<TYPE.Node, StatementListContext>,
    owner: TYPE.Node,
    ctx: StatementListContext,
    index: number,
): ModuleClassFold | null {
    const site = matchClassDeclSite(ctx.list[index]);
    if (!site) return null;
    const fold: ModuleClassFold = {
        stmt: ctx.list[index],
        list: ctx.list,
        listOwner: owner,
        listParent: ctx.parent,
        classExpr: site.classExpr,
        holder: site.holder,
        aliases: [],
        chain: [],
        target: "",
        targetStmt: null,
        targetList: null,
        targetOwner: owner,
        programInsertAfter: null,
        declarators: [],
    };
    if (!isValidBindingName(site.holder)) {
        // holder 是临时名:沿执行顺序向后收集别名链,直到第一个非临时赋值目标
        const holders = new Set<string>([site.holder]);
        if (site.holder !== "acc") fold.aliases.push(site.holder);
        for (const { stmt, owner: stepOwner } of forwardStatements(contexts, owner, index + 1)) {
            const expression = isExpressionStatement(stmt) ? stmt.expression : null;
            if (!expression || !isAssignmentExpression(expression) || expression.operator !== "="
                || !isIdentifier(expression.left) || !isIdentifier(expression.right)
                || !holders.has(expression.right.name)) return null;
            const left = expression.left;
            if (holders.has(left.name)) {
                // 冗余枢纽恢复(`acc = v1`):链上没有其它读取,一并删除
                fold.chain.push({ stmt, list: contexts.get(stepOwner)!.list });
                continue;
            }
            if (isTempName(left.name) && !left.name.startsWith("panda_jmp0_reserved_")) {
                holders.add(left.name);
                fold.aliases.push(left.name);
                fold.chain.push({ stmt, list: contexts.get(stepOwner)!.list });
                continue;
            }
            if (!isValidBindingName(left.name)) return null;
            fold.target = left.name;
            fold.targetStmt = stmt;
            fold.targetList = contexts.get(stepOwner)!.list;
            fold.targetOwner = stepOwner;
            break;
        }
        if (!fold.target) return null;
    } else {
        // holder 本身就是模块级绑定名(`Name = class R{}` / `let Name = class R{}`):原位替换
        fold.target = site.holder;
    }
    // 类声明必须落到模块作用域(program.body)。锚点在块内时沿块链向上攀升:
    // 每一层「锚点之后」的语句只允许是本折叠的链上语句(它们会被删除,等效于
    // 锚点就是该块的结尾);攀升成功后类声明插到最外层块元素之后。
    const anchorOwner = fold.targetStmt ? fold.targetOwner : fold.listOwner;
    if (anchorOwner !== program) {
        const chainSet = new Set(fold.chain.map((c) => c.stmt));
        let ownerNode: TYPE.Node = anchorOwner;
        let ctx = contexts.get(ownerNode)!;
        let idx = ctx.list.indexOf(fold.targetStmt ?? fold.stmt);
        for (;;) {
            for (let j = idx + 1; j < ctx.list.length; j++) {
                if (!chainSet.has(ctx.list[j])) return null;
            }
            if (!ctx.parent || ctx.parent.owner === program) break;
            idx = ctx.parent.index;
            ownerNode = ctx.parent.owner;
            ctx = contexts.get(ownerNode)!;
        }
        fold.programInsertAfter = ownerNode;
    }
    return validateFold(program, fold) ? fold : null;
}

function validateFold(program: TYPE.Program, fold: ModuleClassFold): boolean {
    const chainStmts = fold.chain.map((c) => c.stmt);
    // 目标名:至多一个 no-init `let` 声明(折叠后删掉),不得与 import/参数/标签等绑定冲突;
    // 对它的其它赋值(`Name = other`)在类声明下仍然合法,不检查
    const targetUsage = scanNameUsage(program, fold.target, fold.stmt);
    if (targetUsage.declaratorsWithInit > 0 || targetUsage.declaratorsNoInit.length > 1) return false;
    if (targetUsage.bindings > 0 || targetUsage.otherWrites > 0) return false;
    fold.declarators.push(...targetUsage.declaratorsNoInit);
    // 别名槽:唯一 no-init 声明;全部写入都在链上;无其它绑定;无自增/for-of 头等写入
    for (const alias of fold.aliases) {
        const usage = scanNameUsage(program, alias, fold.stmt);
        if (usage.declaratorsWithInit > 0 || usage.declaratorsNoInit.length !== 1) return false;
        if (usage.bindings > 0 || usage.otherWrites > 0) return false;
        if (usage.writes !== countPlainWrites(chainStmts, alias)) return false;
        fold.declarators.push(...usage.declaratorsNoInit);
    }
    // 编译器生成的类名(匿名/保留名):类体之外的引用无法随之改名,保守放弃
    const classId = fold.classExpr.id;
    if (classId && isIdentifier(classId) && scanNameUsage(program, classId.name, fold.stmt).total > 0) return false;
    return true;
}

/** 整棵树内把名为 name 的引用标识符替换为 replacement(跳过非引用的 key/label 位置) */
function replaceNameRefs(node: TYPE.Node, name: string, replacement: TYPE.Identifier): void {
    const keys = (VISITOR_KEYS as any)[node.type] as string[] | undefined;
    if (!keys) return;
    for (const k of keys) {
        const value = (node as any)[k];
        if (Array.isArray(value)) {
            for (let i = 0; i < value.length; i++) {
                const child = value[i];
                if (!child || typeof child.type !== "string") continue;
                if (isReferenceIdentifier(child, node, k, name)) {
                    value[i] = identifier(replacement.name);
                    continue;
                }
                replaceNameRefs(child, name, replacement);
            }
        } else if (value && typeof value.type === "string") {
            if (isReferenceIdentifier(value, node, k, name)) {
                (node as any)[k] = identifier(replacement.name);
                continue;
            }
            replaceNameRefs(value, name, replacement);
        }
    }
}

function isReferenceIdentifier(child: TYPE.Node, parent: TYPE.Node, key: string, name: string): boolean {
    if (!isIdentifier(child) || child.name !== name) return false;
    // 非计算成员/属性 key 不是变量引用
    if ((isMemberExpression(parent) || isOptionalMemberExpression(parent)) && key === "property" && !parent.computed) return false;
    if ((isObjectProperty(parent) || isObjectMethod(parent) || isClassProperty(parent)) && key === "key" && !parent.computed) return false;
    // `{alias}` 简写:保留旧 key,只改值(`{alias: Name}`)
    if (isObjectProperty(parent) && parent.shorthand) {
        parent.shorthand = false;
        return false;
    }
    if (key === "label") return false;
    return true;
}

function removeFromList(list: TYPE.Statement[], stmt: TYPE.Statement): void {
    const index = list.indexOf(stmt);
    if (index >= 0) list.splice(index, 1);
}

/** 从整棵树里删掉指定 declarator;声明清空且宿主是语句列表时整条删除 */
function removeFromListsRecursively(node: TYPE.Node, set: Set<TYPE.VariableDeclarator>): void {
    const keys = (VISITOR_KEYS as any)[node.type] as string[] | undefined;
    if (!keys) return;
    for (const k of keys) {
        const value = (node as any)[k];
        if (!Array.isArray(value)) {
            if (value && typeof value.type === "string") removeFromListsRecursively(value, set);
            continue;
        }
        for (let i = 0; i < value.length; i++) {
            const child = value[i];
            if (!child || typeof child.type !== "string") continue;
            if (isVariableDeclaration(child) && child.declarations.some((d) => set.has(d))) {
                child.declarations = child.declarations.filter((d) => !set.has(d));
                // for 头部等非语句列表位置只能保留空声明(实际不会出现)
                if (child.declarations.length === 0
                    && ((node.type === "Program" || node.type === "BlockStatement") && k === "body"
                        || (node.type === "SwitchCase" && k === "consequent"))) {
                    value.splice(i, 1);
                    i--;
                    continue;
                }
            }
            removeFromListsRecursively(child, set);
        }
    }
}

function applyFold(program: TYPE.Program, contexts: Map<TYPE.Node, StatementListContext>, fold: ModuleClassFold): void {
    const classExpr = fold.classExpr;
    // 无 extends 的类表达式父类是 hole 哨兵,转声明时一并清掉
    if (classExpr.superClass && isIdentifier(classExpr.superClass) && classExpr.superClass.name === "hole") {
        classExpr.superClass = null;
    }
    const reservedIdName = classExpr.id && isIdentifier(classExpr.id) ? classExpr.id.name : null;
    classExpr.id = identifier(fold.target);
    const classDecl = classDeclaration(classExpr.id, classExpr.superClass, classExpr.body, classExpr.decorators);
    if (fold.programInsertAfter) {
        // 锚点在块内:定义语句/别名链/目标赋值全部删除,类声明插到 program.body
        // 的最外层块元素之后(类绑定必须落在模块作用域,求值顺序不变)
        removeFromList(fold.list, fold.stmt);
        for (const c of fold.chain) removeFromList(c.list, c.stmt);
        if (fold.targetStmt && fold.targetList) removeFromList(fold.targetList, fold.targetStmt);
        const insertIdx = program.body.indexOf(fold.programInsertAfter as TYPE.Statement);
        if (insertIdx >= 0) program.body.splice(insertIdx + 1, 0, classDecl);
        else program.body.push(classDecl);
    } else if (fold.targetStmt && fold.targetList) {
        // A/B 形态:定义语句与别名链删除,类声明放到原目标赋值的位置(求值顺序不变)
        removeFromList(fold.list, fold.stmt);
        for (const c of fold.chain) removeFromList(c.list, c.stmt);
        const targetIndex = fold.targetList.indexOf(fold.targetStmt);
        if (targetIndex >= 0) fold.targetList.splice(targetIndex, 1, classDecl);
    } else {
        // C/D 形态:原位替换
        const index = fold.list.indexOf(fold.stmt);
        if (index >= 0) fold.list.splice(index, 1, classDecl);
    }
    // 删掉别名槽与模块名的 `let` 声明(与 class 声明重名会直接 SyntaxError)。
    // 目标 `let` 通常在顶层而定义可能在块内,必须从整棵树找。
    if (fold.declarators.length > 0) removeFromListsRecursively(program, new Set(fold.declarators));
    // 被搬空的 lexenv 块整块删除(块可能嵌套成链,迭代到稳定)。
    // 注意只有真正从父列表移除才置 pruned,否则已删除的空块会让循环永不终止。
    for (;;) {
        let pruned = false;
        for (const [ownerNode, ctx] of contexts) {
            if (ownerNode === program || !isBlockStatement(ownerNode) || !ctx.parent) continue;
            if (ctx.list.length !== 0) continue;
            const parentOwner = ctx.parent.owner;
            const parentList = parentOwner.type === "Program"
                ? (parentOwner as TYPE.Program).body
                : isBlockStatement(parentOwner) ? parentOwner.body : null;
            if (!parentList) continue;
            const idx = parentList.indexOf(ownerNode as TYPE.Statement);
            if (idx < 0) continue;
            parentList.splice(idx, 1);
            pruned = true;
        }
        if (!pruned) break;
    }
    // 类体内部对旧类名/别名槽的引用改成类名绑定
    if (reservedIdName) replaceNameRefs(classExpr, reservedIdName, classExpr.id as TYPE.Identifier);
    for (const alias of fold.aliases) replaceNameRefs(classExpr, alias, classExpr.id as TYPE.Identifier);
}
