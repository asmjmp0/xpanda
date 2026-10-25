import { Program } from "@babel/types";
import { ISimplify } from "./ISimplify";
import traverse from "@babel/traverse";
import * as TYPE from "@babel/types";
import { isClassLike, isFunctionLike, isTempName, replaceNodeInTree, walkNode } from "./AstUtils";
import { canDeferTestValue, countReadsInNode } from "./temp/queries";


const {
    VISITOR_KEYS,
    file,
    isAssignmentExpression,
    isBigIntLiteral,
    isBooleanLiteral,
    isExpressionStatement,
    isIdentifier,
    isMemberExpression,
    isNullLiteral,
    isNumericLiteral,
    isObjectExpression,
    isObjectProperty,
    isRegExpLiteral,
    isReturnStatement,
    isStringLiteral,
    objectExpression,
    objectProperty,
    returnStatement,
} = TYPE;

/**
 * 还原 `createobjectwithbuffer` 的“模板对象 + 逐属性赋值” lowering:
 *
 *   acc = { protocol: null, hostname: null, port: null };
 *   acc.protocol = P;
 *   acc.hostname = H;
 *   acc.port = PORT;
 *   return acc;
 *   =>
 *   return { protocol: P, hostname: H, port: PORT };
 *
 * 编译器先用 `createobjectwithbuffer` 建一个所有字段为 null 的模板对象，再用
 * `definepropertybyname` 逐个填值。简化为对象字面量后，属性求值顺序保持不变
 * （要求赋值顺序与模板字段顺序一致）；如果紧接 `return obj` 或 `f(obj)` 且对象没有
 * 在模式外被读取，则直接内联成 `return { ... }` / `f({ ... })`。前几轮合并后字面量
 * 里可能已经带着真实表达式：只要求“第一个待合并字段及其之后”的未赋值字段仍是字面量，
 * 这样把新赋值并进去不会打乱求值顺序。
 *
 * @Author: jmp0
 */
export class ObjectLiteralSimplify implements ISimplify {
    simplify(node: Program): boolean {
        let changed = false;
        traverse(file(node), {
            Program: (path) => {
                if (this.processList(path, path.node.body)) changed = true;
            },
            BlockStatement: (path) => {
                if (this.processList(path, path.node.body)) changed = true;
            },
        });
        return changed;
    }

    private processList(path: any, stmts: TYPE.Statement[]): boolean {
        let changed = false;
        for (let i = 0; i < stmts.length; i++) {
            const stmt = stmts[i];
            if (!isExpressionStatement(stmt) || !isAssignmentExpression(stmt.expression)) continue;
            const assign = stmt.expression;
            if (assign.operator !== "=" || !isIdentifier(assign.left) || !isObjectExpression(assign.right)) continue;

            const name = assign.left.name;
            if (!isTempName(name)) continue;
            // 闭包捕获时,对象赋值时机的改变可能被闭包/间接调用观察到
            if (this.isCaptured(path, name)) continue;

            const object = assign.right;
            const properties: TYPE.ObjectProperty[] = [];
            const keys: string[] = [];
            const keyIndex = new Map<string, number>();
            let valid = object.properties.length > 0;
            for (const property of object.properties) {
                if (!valid) break;
                if (!isObjectProperty(property) || property.computed) {
                    valid = false;
                    break;
                }
                const key = this.keyName(property.key);
                // __proto__ 在对象字面量里是设置原型，不能当普通属性合并
                if (!key || key === "__proto__" || keyIndex.has(key)) {
                    valid = false;
                    break;
                }
                keyIndex.set(key, keys.length);
                keys.push(key);
                properties.push(property);
            }
            if (!valid) continue;

            // 紧邻的 `name.key = value`;顺序必须与模板字段一致，保证求值顺序不变
            const assigned = new Map<string, TYPE.Expression>();
            const assignmentStmts: TYPE.Statement[] = [];
            let lastIndex = -1;
            let next = i + 1;
            for (; next < stmts.length; next++) {
                const candidate = stmts[next];
                if (!isExpressionStatement(candidate) || !isAssignmentExpression(candidate.expression)) break;
                const memberAssign = candidate.expression;
                if (memberAssign.operator !== "=" || !isMemberExpression(memberAssign.left) || memberAssign.left.optional) break;
                const member = memberAssign.left;
                if (!isIdentifier(member.object) || member.object.name !== name) break;
                const key = this.memberKeyName(member);
                if (!key) break;
                const index = keyIndex.get(key);
                if (index === undefined || assigned.has(key) || index <= lastIndex) break;
                // 右值不能读写正在构造的对象(含嵌套函数/立即调用的闭包)
                if (this.referencesNameInAssignment(path, candidate, memberAssign.right, name)) break;
                assigned.set(key, memberAssign.right);
                assignmentStmts.push(candidate);
                lastIndex = index;
            }
            if (assigned.size === 0) continue;

            // 模板字段只允许字面量/undefined，避免提前求值有副作用的表达式。
            // 前几轮合并后,字面量里已经带着真实表达式(它们本来就排在新赋值之前求值);
            // 只要求“第一个待合并字段及其之后”的未赋值字段仍是字面量,把这些字段
            // 并进字面量才不会改变求值顺序。
            const firstAssigned = Math.min(...Array.from(assigned.keys(), (key) => keyIndex.get(key)!));
            for (let index = 0; index < properties.length && valid; index++) {
                const key = keys[index];
                if (assigned.has(key)) continue;
                if (index >= firstAssigned && !this.isTemplateValue(properties[index].value)) valid = false;
            }
            if (!valid) continue;

            const mergedProperties = properties.map((property) => {
                const key = this.keyName(property.key)!;
                const value = assigned.get(key) ?? property.value;
                return objectProperty(property.key, value, false);
            });
            const consumer = stmts[next];
            const canInline = !!(consumer
                && this.canInlineConsumer(path, name, i, [stmt, ...assignmentStmts, consumer]));
            const inlineTarget = canInline
                ? this.findInlineTarget(consumer, name, mergedProperties)
                : null;

            object.properties = mergedProperties;
            stmts.splice(i + 1, next - i - 1);
            if (inlineTarget) {
                if (inlineTarget === "return") {
                    stmts.splice(i, 2, returnStatement(object));
                } else {
                    replaceNodeInTree(inlineTarget.consumer.expression, inlineTarget.read, object);
                    stmts.splice(i, 2, inlineTarget.consumer);
                }
            }
            changed = true;
        }
        return changed;
    }

    /**
     * 对象只在紧跟的消费语句里被读取一次时,把字面量直接内联过去:
     *   `acc = {...}; return acc;`            => `return {...};`
     *   `acc = {...}; rows.push(acc);`        => `rows.push({...});`
     * 内联要求把字面量的求值推迟到消费位置不改变副作用顺序(见 canDeferTestValue)。
     */
    private findInlineTarget(
        consumer: TYPE.Statement,
        name: string,
        mergedProperties: TYPE.ObjectProperty[],
    ): "return" | { consumer: TYPE.ExpressionStatement; read: TYPE.Identifier } | null {
        if (isReturnStatement(consumer)) {
            if (!isIdentifier(consumer.argument) || consumer.argument.name !== name) return null;
            return "return";
        }
        if (!isExpressionStatement(consumer)) return null;
        if (countReadsInNode(consumer.expression, name) !== 1) return null;
        let read: TYPE.Identifier | null = null;
        walkNode(consumer.expression, (node) => {
            if (read) return false;
            if (isIdentifier(node) && node.name === name) {
                read = node;
                return false;
            }
            return true;
        });
        if (!read) return null;
        if (!canDeferTestValue(objectExpression(mergedProperties), consumer.expression, read)) return null;
        return { consumer, read };
    }

    /** 变量是否被嵌套函数读写(捕获);捕获时不调整对象赋值时机 */
    private isCaptured(path: any, name: string): boolean {
        const binding = path.scope.getBinding(name);
        if (!binding) return false;
        const fn = path.getFunctionParent();
        return (binding.referencePaths as any[]).some((ref) => ref.getFunctionParent() !== fn)
            || (binding.constantViolations as any[]).some((violation) => violation.getFunctionParent() !== fn);
    }

    /**
     * 右值是否引用了正在构造的对象。不能只按名字扫描:对象方法体里常常有
     * 自己的同名局部(`function cipher(...) { let v0, ... }`),名字扫描会把
     * 影子变量当成外层引用,导致对象方法全部并不进字面量(aes 的 cipher/subBytes)。
     * 有嵌套函数时改用 Babel 的 binding 解析:只有解析到外层 binding 的读取才算引用。
     */
    private referencesNameInAssignment(
        path: any,
        candidate: TYPE.Statement,
        rhs: TYPE.Expression,
        name: string,
    ): boolean {
        let hasFunction = false;
        walkNode(rhs, (node) => {
            if (isFunctionLike(node) || isClassLike(node)) {
                hasFunction = true;
                return false;
            }
            return true;
        });
        if (!hasFunction) return this.referencesNameDeep(rhs, name);
        try {
            const bodyPaths = path.get("body") as any[];
            const statementPath = Array.isArray(bodyPaths)
                ? bodyPaths.find((p) => p && p.node === candidate)
                : null;
            const outer = path.scope.getBinding(name);
            if (!statementPath || !outer) return this.referencesNameDeep(rhs, name);
            const expressionPath = statementPath.get("expression");
            if (!expressionPath || typeof expressionPath.isAssignmentExpression !== "function"
                || !expressionPath.isAssignmentExpression()) {
                return this.referencesNameDeep(rhs, name);
            }
            let referenced = false;
            expressionPath.get("right").traverse({
                ReferencedIdentifier: (ref: any) => {
                    if (referenced || !ref.node || ref.node.name !== name) return;
                    if (ref.scope.getBinding(name) === outer) {
                        referenced = true;
                        ref.stop();
                    }
                },
            });
            return referenced;
        } catch {
            return this.referencesNameDeep(rhs, name);
        }
    }

    /** 深度查找标识符(进入嵌套函数体),用于阻止把构造中的对象暴露给 RHS 里的闭包 */
    private referencesNameDeep(node: TYPE.Node, name: string): boolean {
        let found = false;
        walkNode(node, (current) => {
            if (found) return false;
            if (isIdentifier(current) && current.name === name) {
                found = true;
                return false;
            }
            return true;
        });
        return found;
    }

    /** 对象变量没有在模式外被读取/闭包捕获改写时，才能把它内联进消费语句 */
    private canInlineConsumer(path: any, name: string, index: number, matched: TYPE.Node[]): boolean {
        const binding = path.scope.getBinding(name);
        if (!binding) return false;
        const fn = path.getFunctionParent();
        const bodyPaths = path.get("body") as any[] | undefined;
        const objectPath = bodyPaths ? bodyPaths[index] : null;
        if (!objectPath) return false;
        const matchedSet = new Set(matched);
        for (const ref of binding.referencePaths as any[]) {
            // 闭包里延迟读取会在内联后看到旧值
            if (ref.getFunctionParent() !== fn) return false;
            if (ref.findParent((parent: any) => matchedSet.has(parent.node))) continue;
            // 只允许对象创建之前的读取:之后(含 finally/handler)看到的值会变
            if (this.isBefore(ref, objectPath) !== true) return false;
        }
        return !(binding.constantViolations as any[]).some((violation) => violation.getFunctionParent() !== fn);
    }

    /** 两个路径在 AST 求值顺序上是否 a 在 b 之前;无法判断时返回 null */
    private isBefore(a: any, b: any): boolean | null {
        const aChain: any[] = [];
        for (let cur = a; cur; cur = cur.parentPath) aChain.unshift(cur);
        const bChain: any[] = [];
        for (let cur = b; cur; cur = cur.parentPath) bChain.unshift(cur);
        let i = 0;
        while (i < aChain.length && i < bChain.length
            && aChain[i].parentPath === bChain[i].parentPath
            && aChain[i].key === bChain[i].key) i++;
        if (i === 0 || i >= aChain.length || i >= bChain.length) return null;
        const aPath = aChain[i];
        const bPath = bChain[i];
        const ka = aPath.key;
        const kb = bPath.key;
        if (typeof ka === "number" && typeof kb === "number") return ka < kb;
        if (typeof ka === "string" && typeof kb === "string" && aPath.parentPath) {
            const keys = VISITOR_KEYS[aPath.parentPath.node.type] ?? [];
            const ia = keys.indexOf(ka);
            const ib = keys.indexOf(kb);
            if (ia >= 0 && ib >= 0) return ia < ib;
        }
        return null;
    }

    private keyName(key: TYPE.Node): string | null {
        if (isIdentifier(key)) return key.name;
        if (isStringLiteral(key)) return key.value;
        if (isNumericLiteral(key)) return String(key.value);
        return null;
    }

    private memberKeyName(member: TYPE.MemberExpression): string | null {
        if (!member.computed) return isIdentifier(member.property) ? member.property.name : null;
        if (isStringLiteral(member.property)) return member.property.value;
        if (isNumericLiteral(member.property)) return String(member.property.value);
        return null;
    }

    /** 模板字段只允许字面量/undefined，避免提前求值有副作用的表达式 */
    private isTemplateValue(value: TYPE.Node): boolean {
        return isNullLiteral(value)
            || isBooleanLiteral(value)
            || isNumericLiteral(value)
            || isStringLiteral(value)
            || isBigIntLiteral(value)
            || isRegExpLiteral(value)
            || (isIdentifier(value, { name: "undefined" }))
            || (isIdentifier(value, { name: "null" }));
    }
}
