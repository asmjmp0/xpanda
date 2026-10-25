import * as TYPE from "@babel/types";


const {
    VISITOR_KEYS,
    expressionStatement,
    isArrayPattern,
    isAssignmentExpression,
    isAssignmentPattern,
    isBlockStatement,
    isCallExpression,
    isExpressionStatement,
    isForInStatement,
    isForOfStatement,
    isFunctionDeclaration,
    isFunctionExpression,
    isClassDeclaration,
    isClassExpression,
    isArrowFunctionExpression,
    isConditionalExpression,
    isIdentifier,
    isLogicalExpression,
    isMemberExpression,
    isNodesEquivalent,
    isObjectPattern,
    isObjectProperty,
    isOptionalMemberExpression,
    isReferenced,
    isRestElement,
    isSequenceExpression,
    isSpreadElement,
    isStringLiteral,
    isUnaryExpression,
    isUpdateExpression,
    isVariableDeclaration,
    isVariableDeclarator,
} = TYPE;

/**
 * simplify 阶段共用的 AST 判定与遍历工具。
 *
 * 这里的实现刻意不依赖 Babel traverse:在 2MB 级别的 AST 上,频繁 traverse/generate
 * 是旧优化器最主要的性能瓶颈。所有工具函数都只做一次线性遍历。
 *
 * @Author: jmp0
 */

/** 编译器生成的临时变量:acc / vN / local_X_Y / local_X_Y_Z(同层级重复的 lexenv 实例) */
export function isTempName(name: string): boolean {
    return name === "acc" || /^v\d+$/.test(name) || /^local_\d+_\d+(_\d+)?$/.test(name) || /^catchAcc\d*$/.test(name)
        || /^panda_jmp0_reserved_param_p\d+$/.test(name);
}

const FUNCTION_TYPES = new Set([
    "FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression",
    "ObjectMethod", "ClassMethod", "ClassPrivateMethod",
]);
const CLASS_TYPES = new Set(["ClassDeclaration", "ClassExpression"]);

export function isFunctionLike(node: TYPE.Node | null | undefined): boolean {
    return !!node && FUNCTION_TYPES.has(node.type);
}

export function isClassLike(node: TYPE.Node | null | undefined): boolean {
    return !!node && CLASS_TYPES.has(node.type);
}

/** 遍历子树;返回 false 时跳过该节点的子节点 */
export function walkNode(
    node: TYPE.Node | null | undefined,
    visit: (node: TYPE.Node, parent: TYPE.Node | null, key: string | null) => boolean | void,
    parent: TYPE.Node | null = null,
    key: string | null = null,
): void {
    if (!node || typeof (node as any).type !== "string") return;
    if (visit(node, parent, key) === false) return;
    const keys = (VISITOR_KEYS as any)[node.type] as string[] | undefined;
    if (!keys) return;
    for (const k of keys) {
        const value = (node as any)[k];
        if (Array.isArray(value)) {
            for (const child of value) {
                if (child && typeof child.type === "string") walkNode(child, visit, node, k);
            }
        } else if (value && typeof value.type === "string") {
            walkNode(value, visit, node, k);
        }
    }
}

/**
 * 把 root 子树里的 target 节点替换为 replacement(按父节点/数组下标原地替换)。
 * 不依赖 Babel traverse,适合在已有的线性 AST pass 里替换深层表达式节点。
 * 返回是否找到并替换。
 */
export function replaceNodeInTree(root: TYPE.Node | null | undefined, target: TYPE.Node, replacement: TYPE.Node): boolean {
    if (!root || root === target) return false;
    const keys = (VISITOR_KEYS as any)[root.type] as string[] | undefined;
    if (!keys) return false;
    for (const key of keys) {
        const value = (root as any)[key];
        if (value === target) {
            (root as any)[key] = replacement;
            return true;
        }
        if (Array.isArray(value)) {
            for (let i = 0; i < value.length; i++) {
                if (value[i] === target) {
                    value[i] = replacement;
                    return true;
                }
                if (value[i] && typeof value[i].type === "string"
                    && replaceNodeInTree(value[i], target, replacement)) return true;
            }
        } else if (value && typeof value.type === "string"
            && replaceNodeInTree(value, target, replacement)) {
            return true;
        }
    }
    return false;
}

const PURE_STRING_METHODS = new Set([
    "charAt", "charCodeAt", "codePointAt", "startsWith", "endsWith", "includes",
    "indexOf", "lastIndexOf", "localeCompare", "toLowerCase", "toUpperCase",
    "trim", "trimStart", "trimEnd", "padStart", "padEnd", "repeat",
]);

const PURE_MATH_METHODS = new Set([
    "abs", "acos", "acosh", "asin", "asinh", "atan", "atan2", "atanh", "cbrt",
    "ceil", "clz32", "cos", "cosh", "exp", "expm1", "floor", "fround", "hypot",
    "imul", "log", "log10", "log1p", "log2", "max", "min", "pow", "round",
    "sign", "sin", "sinh", "sqrt", "tan", "tanh", "trunc",
]);

const PURE_GLOBAL_CALLS = new Set([
    "parseInt", "parseFloat", "isNaN", "isFinite", "encodeURI", "decodeURI",
    "encodeURIComponent", "decodeURIComponent", "escape", "unescape",
]);

/**
 * 判断是否是常见的内置纯函数调用(字符串只读方法 / Math / 全局转换函数)。
 * 这类调用可以安全复制/删除,用于把 charCodeAt 之类的临时变量内联掉。
 */
export function isPureBuiltinCall(node: TYPE.CallExpression): boolean {
    const callee = node.callee;
    if (isIdentifier(callee)) return PURE_GLOBAL_CALLS.has(callee.name);
    if (!isMemberExpression(callee) || callee.optional) return false;
    const object = callee.object;
    const property = callee.property;
    const name = !callee.computed && isIdentifier(property) ? property.name
        : (isStringLiteral(property) ? property.value : null);
    if (!name) return false;
    if (isIdentifier(object) && object.name === "Math") return PURE_MATH_METHODS.has(name);
    return PURE_STRING_METHODS.has(name);
}

/**
 * 表达式是否可以在不改变语义的前提下重复求值。
 * 成员访问可能触发 getter,因此不算 dup-safe。
 */
export function isDupSafe(node: TYPE.Node | null | undefined): boolean {
    if (!node) return false;
    switch (node.type) {
        case "Identifier":
        case "StringLiteral":
        case "NumericLiteral":
        case "BooleanLiteral":
        case "NullLiteral":
        case "BigIntLiteral":
        case "DecimalLiteral":
        case "ThisExpression":
        case "Super":
            return true;
        case "UnaryExpression":
            return (node as TYPE.UnaryExpression).operator !== "delete"
                && isDupSafe((node as TYPE.UnaryExpression).argument);
        case "BinaryExpression":
        case "LogicalExpression": {
            const n = node as TYPE.BinaryExpression | TYPE.LogicalExpression;
            return isDupSafe(n.left) && isDupSafe(n.right);
        }
        case "ConditionalExpression": {
            const n = node as TYPE.ConditionalExpression;
            return isDupSafe(n.test) && isDupSafe(n.consequent) && isDupSafe(n.alternate);
        }
        case "SequenceExpression":
            return (node as TYPE.SequenceExpression).expressions.every(isDupSafe);
        case "TemplateLiteral": {
            const n = node as TYPE.TemplateLiteral;
            return n.expressions.every(isDupSafe);
        }
        case "ParenthesizedExpression":
            return isDupSafe((node as any).expression);
        default:
            return false;
    }
}

/** 可以安全克隆到使用处的表达式:dup-safe + 成员访问链(不复制调用/构造)。 */
export function isCopyable(node: TYPE.Node | null | undefined): boolean {
    if (!node) return false;
    if (isDupSafe(node)) return true;
    switch (node.type) {
        case "UnaryExpression":
            return (node as TYPE.UnaryExpression).operator !== "delete"
                && isCopyable((node as TYPE.UnaryExpression).argument);
        case "BinaryExpression":
        case "LogicalExpression": {
            const n = node as TYPE.BinaryExpression | TYPE.LogicalExpression;
            return isCopyable(n.left) && isCopyable(n.right);
        }
        case "ConditionalExpression": {
            const n = node as TYPE.ConditionalExpression;
            return isCopyable(n.test) && isCopyable(n.consequent) && isCopyable(n.alternate);
        }
        case "SequenceExpression":
            return (node as TYPE.SequenceExpression).expressions.every(isCopyable);
        case "TemplateLiteral":
            return (node as TYPE.TemplateLiteral).expressions.every(isCopyable);
        case "MemberExpression":
        case "OptionalMemberExpression": {
            const n = node as TYPE.MemberExpression;
            return isCopyable(n.object as TYPE.Node)
                && (!n.computed || isCopyable(n.property as TYPE.Node));
        }
        case "ParenthesizedExpression":
            return isCopyable((node as any).expression);
        default:
            return false;
    }
}

/** 统计子树节点数,超过 limit 立即停止(用于防止复制传播导致表达式指数膨胀)。 */
export function nodeSize(node: TYPE.Node | null | undefined, limit: number = Number.MAX_SAFE_INTEGER): number {
    if (!node) return 0;
    let count = 0;
    const stack: TYPE.Node[] = [node];
    while (stack.length > 0) {
        const current = stack.pop()!;
        if (!current || typeof (current as any).type !== "string") continue;
        count++;
        if (count >= limit) return count;
        const keys = (VISITOR_KEYS as any)[current.type] as string[] | undefined;
        if (!keys) continue;
        for (const key of keys) {
            const value = (current as any)[key];
            if (Array.isArray(value)) {
                for (const child of value) {
                    if (child && typeof child.type === "string") stack.push(child);
                }
            } else if (value && typeof value.type === "string") {
                stack.push(value);
            }
        }
    }
    return count;
}

/** 表达式求值是否没有可观察副作用(可用于删除死赋值)。 */
export function isPureExpression(node: TYPE.Node | null | undefined): boolean {
    if (!node) return true;
    switch (node.type) {
        case "Identifier":
        case "StringLiteral":
        case "NumericLiteral":
        case "BooleanLiteral":
        case "NullLiteral":
        case "BigIntLiteral":
        case "DecimalLiteral":
        case "RegExpLiteral":
        case "ThisExpression":
        case "Super":
            return true;
        case "UnaryExpression":
            return (node as TYPE.UnaryExpression).operator !== "delete"
                && isPureExpression((node as TYPE.UnaryExpression).argument);
        case "BinaryExpression":
        case "LogicalExpression": {
            const n = node as TYPE.BinaryExpression | TYPE.LogicalExpression;
            return isPureExpression(n.left) && isPureExpression(n.right);
        }
        case "ConditionalExpression": {
            const n = node as TYPE.ConditionalExpression;
            return isPureExpression(n.test) && isPureExpression(n.consequent) && isPureExpression(n.alternate);
        }
        case "SequenceExpression":
            return (node as TYPE.SequenceExpression).expressions.every(isPureExpression);
        case "TemplateLiteral":
            return (node as TYPE.TemplateLiteral).expressions.every(isPureExpression);
        case "MemberExpression":
        case "OptionalMemberExpression": {
            const n = node as TYPE.MemberExpression;
            return isPureExpression(n.object)
                && (!n.computed || isPureExpression(n.property));
        }
        case "ArrayExpression":
            return (node as TYPE.ArrayExpression).elements.every((e) =>
                e == null || (isSpreadElement(e) ? isPureExpression(e.argument) : isPureExpression(e as TYPE.Expression)));
        case "ObjectExpression":
            return (node as TYPE.ObjectExpression).properties.every((prop) => {
                if (isSpreadElement(prop)) return isPureExpression(prop.argument);
                if (isObjectProperty(prop)) {
                    return (!prop.computed || isPureExpression(prop.key as TYPE.Expression))
                        && isPureExpression(prop.value as TYPE.Expression);
                }
                return false;
            });
        case "FunctionExpression":
        case "ArrowFunctionExpression":
            return true;
        case "CallExpression":
            return isPureBuiltinCall(node as TYPE.CallExpression)
                && (node as TYPE.CallExpression).arguments.every((arg) =>
                    isSpreadElement(arg) ? isPureExpression(arg.argument) : isPureExpression(arg as TYPE.Expression));
        case "ParenthesizedExpression":
            return isPureExpression((node as any).expression);
        default:
            // ClassExpression 可能带 static block / computed key;NewExpression 可能执行构造器
            return false;
    }
}

/** 函数/类表达式作为语句保留时,后续 pass 会把它转换为声明。 */
export function isDeclarationValue(node: TYPE.Node | null | undefined): boolean {
    return !!node && (isFunctionExpression(node) || isClassExpression(node)
        || isArrowFunctionExpression(node));
}

/** 判断 obj.next().value 结构(用于 for-of / 迭代器识别),不再调用 generator。 */
export function isNextValue(node: TYPE.Node | null | undefined): boolean {
    if (!isMemberExpression(node) || node.computed) return false;
    if (!isIdentifier(node.property) || node.property.name !== "value") return false;
    if (!isCallExpression(node.object)) return false;
    const callee = node.object.callee;
    if (!isMemberExpression(callee) || callee.computed) return false;
    return isIdentifier(callee.property) && callee.property.name === "next";
}

export function isDoneMember(node: TYPE.Node | null | undefined): boolean {
    return !!node && isMemberExpression(node) && !node.computed
        && isIdentifier(node.property) && node.property.name === "done";
}

/** 收集子树中所有标识符名字(用于依赖记录,宁可多收集)。 */
export function collectIdentifierNames(node: TYPE.Node | null | undefined): Set<string> {
    const names = new Set<string>();
    walkNode(node, (n) => {
        if (isIdentifier(n)) names.add(n.name);
        // 不进入嵌套函数体:闭包里的局部变量与当前作用域无关
        if (isFunctionLike(n) || isClassLike(n)) return false;
    });
    return names;
}

/** 成员形式的写入目标(`a.b = v` / `a[b] = v` / `a.b++`):基对象 + 属性。 */
export interface MemberWriteTarget {
    object: TYPE.Expression;
    property: TYPE.Expression;
    computed: boolean;
}

/** 收集子树中成员形式的写入目标(跳过嵌套函数/类,它们有独立作用域)。 */
export function collectMemberWriteTargets(
    node: TYPE.Node | null | undefined,
    out: MemberWriteTarget[] = [],
): MemberWriteTarget[] {
    walkNode(node, (n) => {
        if (isFunctionLike(n) || isClassLike(n)) return false;
        let target: TYPE.Node | null = null;
        if (isAssignmentExpression(n)) {
            if (isMemberExpression(n.left) || isOptionalMemberExpression(n.left)) target = n.left;
        } else if (isUpdateExpression(n)) {
            if (isMemberExpression(n.argument) || isOptionalMemberExpression(n.argument)) target = n.argument;
        }
        if (target) {
            const m = target as TYPE.MemberExpression;
            out.push({ object: m.object as TYPE.Expression, property: m.property as TYPE.Expression, computed: m.computed });
        }
        return true;
    }, null, null);
    return out;
}

/** 收集子树中被写入的变量名(跳过嵌套函数/类,它们有独立作用域)。 */
export function collectAssignedNames(node: TYPE.Node | null | undefined, out: Set<string> = new Set()): Set<string> {
    walkNode(node, (n) => {
        if (isFunctionLike(n) || isClassLike(n)) return false;
        if (isAssignmentExpression(n)) {
            addPatternNames(n.left, out);
        } else if (isUpdateExpression(n)) {
            if (isIdentifier(n.argument)) out.add(n.argument.name);
        } else if (isVariableDeclarator(n)) {
            addPatternNames(n.id, out);
        } else if (isForInStatement(n) || isForOfStatement(n)) {
            addPatternNames(n.left, out);
        }
        return true;
    }, null, null);
    return out;
}

export function addPatternNames(node: TYPE.Node | null | undefined, out: Set<string>): void {
    if (!node) return;
    if (isIdentifier(node)) {
        out.add(node.name);
    } else if (isRestElement(node)) {
        addPatternNames(node.argument, out);
    } else if (isAssignmentPattern(node)) {
        addPatternNames(node.left, out);
    } else if (isArrayPattern(node)) {
        for (const e of node.elements) addPatternNames(e, out);
    } else if (isObjectPattern(node)) {
        for (const prop of node.properties) {
            if (isRestElement(prop)) addPatternNames(prop.argument, out);
            else addPatternNames(prop.value, out);
        }
    }
}

/** 从语句/表达式中读取变量名(用于活跃性判断)。 */
export function collectReadNames(node: TYPE.Node | null | undefined): Set<string> {
    const names = new Set<string>();
    const visit = (n: TYPE.Node, parent: TYPE.Node | null, key: string | null): boolean | void => {
        if (isFunctionLike(n) || isClassLike(n)) return false;
        if (isIdentifier(n)) {
            // 根本身就是标识符时没有父节点,按读取处理(如 return acc / if (acc))
            if (!parent || isReferenced(n, parent)) names.add(n.name);
            // 复合赋值(x += y / x |= y)左侧也会读取旧值;Babel 的 isReferenced 对赋值左值统一返回 false
            else if (parent && isAssignmentExpression(parent) && parent.left === n && parent.operator !== "=") {
                names.add(n.name);
            }
            return;
        }
    };
    walkNode(node, visit);
    return names;
}

/**
 * 一次遍历同时收集读取与写入的变量名。
 * 活跃性分析里 reads/writes 经常成对使用(transfer 的表达式语句分支),
 * 分开调用 collectReadNames / collectAssignedNames 会把同一棵子树扫描两遍。
 */
export function collectReadWriteNames(
    node: TYPE.Node | null | undefined,
    reads: Set<string> = new Set<string>(),
    writes: Set<string> = new Set<string>(),
): { reads: Set<string>; writes: Set<string> } {
    walkNode(node, (n, parent) => {
        if (isFunctionLike(n) || isClassLike(n)) return false;
        if (isIdentifier(n)) {
            if (!parent || isReferenced(n, parent)) reads.add(n.name);
            else if (isAssignmentExpression(parent) && parent.left === n && parent.operator !== "=") reads.add(n.name);
            return;
        }
        if (isAssignmentExpression(n)) {
            addPatternNames(n.left, writes);
        } else if (isUpdateExpression(n)) {
            if (isIdentifier(n.argument)) writes.add(n.argument.name);
        } else if (isVariableDeclarator(n)) {
            addPatternNames(n.id, writes);
        } else if (isForInStatement(n) || isForOfStatement(n)) {
            addPatternNames(n.left, writes);
        }
        return true;
    });
    return { reads, writes };
}

/** 将字符串形式的语句节点转换为表达式语句,方便替换。 */
export function toExpressionStatement(node: TYPE.Expression): TYPE.ExpressionStatement {
    return expressionStatement(node);
}

export function isNodeEqual(a: TYPE.Node | null | undefined, b: TYPE.Node | null | undefined): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    try {
        return isNodesEquivalent(a, b);
    } catch {
        return false;
    }
}

/** 遍历一条语句,不进入嵌套函数/类体(它们只在被调用时才执行) */
export function walkStatementSkipFunctions(
    stmt: TYPE.Node,
    visit: (node: TYPE.Node, parent: TYPE.Node | null) => void,
): void {
    walkNode(stmt, (node, parent) => {
        if (node !== stmt && (isFunctionLike(node) || isClassLike(node))) return false;
        visit(node, parent);
        return true;
    });
}

/** 函数体顶层的 let/const/var/函数/类声明会遮蔽整个函数作用域(TDZ 下内部读取只会抛错,不会读到外层) */
function addFunctionTopLevelDecls(stmt: TYPE.Statement, out: Set<string>): void {
    if (isVariableDeclaration(stmt)) {
        for (const d of stmt.declarations) addPatternNames(d.id, out);
    } else if (isFunctionDeclaration(stmt) && stmt.id) {
        out.add(stmt.id.name);
    } else if (isClassDeclaration(stmt) && stmt.id) {
        out.add(stmt.id.name);
    }
}

/**
 * 作用域感知的捕获读取检测:names 里是否有名字被嵌套函数捕获读取。
 * 沿嵌套函数链下探,链上函数只要"确定遮蔽"了某名字(参数、函数顶层的
 * let/const/var/函数/类声明),该名字在函数内的读取就与外层变量无关;
 * 拿不准是否遮蔽时一律按"捕获"处理(保守方向,宁可放弃优化)。
 */
export function scanCapturedRead(
    node: TYPE.Node,
    parent: TYPE.Node | null,
    names: Set<string>,
    shadowed: Set<string>,
    insideFunction: boolean,
): boolean {
    if ((isFunctionLike(node) || isClassLike(node)) && parent !== null) {
        const inner = new Set(shadowed);
        if (isFunctionLike(node)) {
            for (const p of (node as TYPE.Function).params) addPatternNames(p, inner);
        } else {
            const id = (node as TYPE.Class).id;
            if (id) inner.add(id.name);
        }
        const body: TYPE.Node | null = isFunctionLike(node)
            ? (node as TYPE.Function).body
            : (node as TYPE.Class).body;
        if (body && isBlockStatement(body)) {
            for (const stmt of body.body) addFunctionTopLevelDecls(stmt, inner);
        }
        const remaining = new Set([...names].filter((n) => !inner.has(n)));
        if (remaining.size === 0 || !body) return false;
        return scanCapturedRead(body, node, remaining, inner, true);
    }
    // 只关心嵌套函数体内的读取;顶层线性读取由调用方的逐语句检查负责
    if (insideFunction && isIdentifier(node) && names.has(node.name) && !shadowed.has(node.name)
        && parent && isReferenced(node, parent)) {
        return true;
    }
    const keys = (VISITOR_KEYS as any)[node.type] as string[] | undefined;
    if (!keys) return false;
    for (const key of keys) {
        const value = (node as any)[key];
        if (Array.isArray(value)) {
            for (const child of value) {
                if (child && typeof child.type === "string"
                    && scanCapturedRead(child, node, names, shadowed, insideFunction)) {
                    return true;
                }
            }
        } else if (value && typeof value.type === "string") {
            if (scanCapturedRead(value, node, names, shadowed, insideFunction)) return true;
        }
    }
    return false;
}

/**
 * 按求值顺序收集“在确定写入之前被读取”的名字,跳过嵌套函数/类。
 *
 * 语句粒度收集读取会把“先写后读”的读取也算成对旧值的依赖:
 *
 *   return v5 && (v7 = f()) && v7.avatar ? ... : "";
 *
 * 这里按求值顺序推进“确定已写入”集合,只有写入之前发生的读取才进 reads。
 * 短路/条件表达式右侧可能不执行:其读取仍可能看到旧值(保留),但写入不算
 * 确定写入;未展开的结构保守地保留读取、不记写入(宁可多留活跃性)。
 */
export function collectReadsBeforeDefiniteWrite(
    node: TYPE.Node | null | undefined,
): { reads: Set<string>; allWrites: Set<string>; definiteWrites: Set<string> } {
    const collector = new ReadsBeforeWriteCollector();
    collector.visit(node);
    return {
        reads: collector.reads,
        allWrites: collector.allWrites,
        definiteWrites: collector.written,
    };
}

/**
 * 求值顺序上的读写收集器。
 * written 是“当前路径上一定已经写过的名字”,reads 是“写入之前发生的读取”。
 */
class ReadsBeforeWriteCollector {
    readonly reads = new Set<string>();
    readonly allWrites = new Set<string>();
    written = new Set<string>();
    /** 写入顺序日志:短路表达式的右操作数要能看到左侧全部写入 */
    private writesLog: string[] = [];

    private read(name: string): void {
        if (this.written.has(name)) return;
        this.reads.add(name);
    }

    private write(name: string): void {
        this.written.add(name);
        this.allWrites.add(name);
        this.writesLog.push(name);
    }

    visit(node: TYPE.Node | null | undefined): void {
        if (!node) return;
        switch (node.type) {
            case "Identifier":
                this.read(node.name);
                return;
            case "AssignmentExpression": {
                const left = node.left;
                if (isIdentifier(left)) {
                    // 复合赋值(x += y)读取旧值;Babel 对赋值左值不判读
                    if (node.operator !== "=") this.read(left.name);
                } else {
                    // 成员/解构目标里的读取(对象、下标、默认值)保守算读取
                    this.visit(left);
                }
                this.visit(node.right);
                this.writeTargets(left);
                return;
            }
            case "UpdateExpression":
                if (isIdentifier(node.argument)) {
                    this.read(node.argument.name);
                    this.write(node.argument.name);
                } else {
                    this.visit(node.argument);
                }
                return;
            case "SequenceExpression":
                for (const expression of node.expressions) this.visit(expression);
                return;
            case "LogicalExpression": {
                // 左操作数一定先求值,右侧看到左侧的写入;而右侧只在左侧“求值完成”
                // (&& 为真 / || 为假)时才执行,所以左侧任意位置的写入对它都可见。
                // 右侧自己的写入不算确定写入(它可能被短路跳过)。
                const mark = this.writesLog.length;
                this.visit(node.left);
                const afterLeft = new Set(this.written);
                for (let i = mark; i < this.writesLog.length; i++) this.written.add(this.writesLog[i]);
                this.visit(node.right);
                this.written = afterLeft;
                return;
            }
            case "ConditionalExpression": {
                const before = new Set(this.written);
                this.visit(node.test);
                const afterTest = new Set(this.written);
                this.written = afterTest;
                this.visit(node.consequent);
                this.written = afterTest;
                this.visit(node.alternate);
                this.written = afterTest;
                return;
            }
            case "UnaryExpression":
            case "AwaitExpression":
            case "YieldExpression":
            case "SpreadElement":
            case "ParenthesizedExpression":
                this.visit((node as any).argument ?? (node as any).expression);
                return;
            case "BinaryExpression":
                this.visit(node.left);
                this.visit(node.right);
                return;
            case "MemberExpression":
                this.visit(node.object);
                if (node.computed) this.visit(node.property);
                return;
            case "OptionalMemberExpression":
                this.visit((node as any).object);
                if ((node as any).computed) this.visit((node as any).property);
                return;
            case "CallExpression":
            case "NewExpression":
            case "OptionalCallExpression": {
                this.visit(node.callee);
                for (const argument of node.arguments as TYPE.Node[]) this.visit(argument);
                return;
            }
            case "TaggedTemplateExpression":
                this.visit(node.tag);
                this.visit(node.quasi);
                return;
            case "TemplateLiteral":
                for (const expression of node.expressions) this.visit(expression);
                return;
            case "ArrayExpression":
                for (const element of node.elements) this.visit(element);
                return;
            case "ObjectExpression":
                for (const property of node.properties) {
                    if (property.type === "ObjectProperty") {
                        if (property.computed) this.visit(property.key);
                        this.visit(property.value);
                    } else if (property.type === "SpreadElement") {
                        this.visit(property.argument);
                    }
                }
                return;
            case "VariableDeclaration":
                for (const declarator of node.declarations) {
                    this.visit(declarator.init);
                    this.writeTargets(declarator.id);
                }
                return;
            case "ExpressionStatement":
                this.visit(node.expression);
                return;
            case "BlockStatement":
                for (const statement of node.body) this.visit(statement);
                return;
            case "LabeledStatement":
                this.visit(node.body);
                return;
            case "IfStatement": {
                // test 一定求值;两个分支都可能执行(也都不写的名字才不算确定写入)
                this.visit(node.test);
                const afterTest = new Set(this.written);
                this.written = new Set(afterTest);
                this.visit(node.consequent);
                const consequentWrites = this.written;
                this.written = new Set(afterTest);
                if (node.alternate) this.visit(node.alternate);
                const alternateWrites = this.written;
                const merged = new Set<string>();
                for (const name of consequentWrites) if (alternateWrites.has(name)) merged.add(name);
                this.written = merged;
                return;
            }
            case "ReturnStatement":
            case "ThrowStatement":
                this.visit(node.argument);
                return;
            case "FunctionExpression":
            case "ArrowFunctionExpression":
            case "ClassExpression":
            case "FunctionDeclaration":
            case "ClassDeclaration":
                // 函数体不在当前语句求值时执行
                return;
            default:
                // 未展开的结构:读取按子节点收集(不记写入),保守保留活跃性
                for (const name of collectReadNames(node)) this.read(name);
                return;
        }
    }

    private writeTargets(pattern: TYPE.Node | null | undefined): void {
        if (!pattern) return;
        if (isIdentifier(pattern)) {
            this.write(pattern.name);
        } else if (pattern.type === "RestElement") {
            this.writeTargets(pattern.argument);
        } else if (pattern.type === "AssignmentPattern") {
            this.writeTargets(pattern.left);
        } else if (pattern.type === "ArrayPattern") {
            for (const element of pattern.elements) this.writeTargets(element);
        } else if (pattern.type === "ObjectPattern") {
            for (const property of pattern.properties) {
                if (property.type === "RestElement") this.writeTargets(property.argument);
                else if (property.type === "ObjectProperty") this.writeTargets(property.value);
            }
        }
    }
}

/**
 * test 按 truthy(或 falsy)路径求值时,name 是否一定会被写入。
 * 只覆盖短路/条件表达式;其它节点保守返回 false。
 * 用于条件归约与活跃性:test 在进入分支之前一定重写了 name 时,分支里对它的
 * 读取看到的是新值,不等于“旧值仍然活跃”。
 */
export function writesOnTakenPath(test: TYPE.Expression, name: string, truthy: boolean): boolean {
    if (isSequenceExpression(test)) {
        return test.expressions.some((e) => writesOnTakenPath(e as TYPE.Expression, name, true));
    }
    if (isAssignmentExpression(test)) {
        const writesLeft = isIdentifier(test.left) && test.left.name === name;
        return writesLeft || writesOnTakenPath(test.right, name, true);
    }
    if (isUpdateExpression(test)) {
        return isIdentifier(test.argument) && test.argument.name === name;
    }
    if (isUnaryExpression(test) && test.operator === "!") {
        return writesOnTakenPath(test.argument as TYPE.Expression, name, !truthy);
    }
    if (isLogicalExpression(test)) {
        const left = test.left as TYPE.Expression;
        const right = test.right as TYPE.Expression;
        if (test.operator === "&&") {
            // truthy:两边都执行;falsy:左侧为假时右侧短路
            return truthy
                ? writesOnTakenPath(left, name, true) || writesOnTakenPath(right, name, true)
                : writesOnTakenPath(left, name, false);
        }
        // truthy:左侧为真时右侧短路;falsy:两边都执行
        return truthy
            ? writesOnTakenPath(left, name, true)
            : writesOnTakenPath(left, name, false) || writesOnTakenPath(right, name, false);
    }
    if (isConditionalExpression(test)) {
        return writesOnTakenPath(test.consequent, name, truthy)
            && writesOnTakenPath(test.alternate, name, truthy);
    }
    return false;
}

