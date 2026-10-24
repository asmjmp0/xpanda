import { Program } from "@babel/types";
import { ISimplify } from "./ISimplify";
import traverse, { NodePath } from "@babel/traverse";
import * as TYPE from "@babel/types";
import {
    addPatternNames,
    collectAssignedNames,
    collectMemberWriteTargets,
    collectIdentifierNames,
    collectReadNames,
    collectReadWriteNames,
    isClassLike,
    isCopyable,
    isDeclarationValue,
    isFunctionLike,
    isNodeEqual,
    isPureExpression,
    isTempName,
    nodeSize,
    replaceNodeInTree,
    walkNode,
    MemberWriteTarget,
} from "./AstUtils";


const {
    VISITOR_KEYS,
    cloneNode,
    expressionStatement,
    file,
    functionDeclaration,
    isArrayPattern,
    isAssignmentExpression,
    isAssignmentPattern,
    isBinaryExpression,
    isBlockStatement,
    isCallExpression,
    isCatchClause,
    isClassDeclaration,
    isClassExpression,
    isConditionalExpression,
    isContinueStatement,
    isDoWhileStatement,
    isEmptyStatement,
    isExpression,
    isExpressionStatement,
    isForInStatement,
    isForOfStatement,
    isFunctionExpression,
    isIdentifier,
    isIfStatement,
    isLogicalExpression,
    isMemberExpression,
    isNewExpression,
    isObjectPattern,
    isObjectProperty,
    isOptionalCallExpression,
    isOptionalMemberExpression,
    isParenthesizedExpression,
    isReferenced,
    isRestElement,
    isReturnStatement,
    isSequenceExpression,
    isSpreadElement,
    isStringLiteral,
    isTaggedTemplateExpression,
    isUnaryExpression,
    isUpdateExpression,
    isVariableDeclaration,
    isVariableDeclarator,
    logicalExpression,
    sequenceExpression,
    stringLiteral,
    unaryExpression,
    identifier: identifierBuilder,
    isProgram: isProgramNode,
    isStatement: isStatementNode,
} = TYPE;

/**
 * 临时变量(acc / vN / local_X_Y)的复制传播与死存储消除。
 *
 * 旧实现以 Babel binding 为中心,每成功替换一次就 scope.crawl() 并重新遍历所有
 * binding,在 Player 这种 2MB AST 上单轮需要 16s 以上,而且 while(true) 没有上限。
 * 新实现每个函数只处理一次:
 *   1. 用 binding.referencePaths 建立精确的引用集合;
 *   2. 线性处理语句,维护 temp -> 表达式的环境,按作用域/控制流失效;
 *   3. 处理结束后再统一清理死赋值,不需要反复 crawl。
 *
 * @Author: jmp0
 */

interface BindingInfo {
    name: string;
    /** 尚未被替换掉的引用节点 */
    refs: Set<TYPE.Node>;
    /** 是否被嵌套函数捕获(捕获的变量不做传播,避免闭包修改) */
    captured: boolean;
}

interface EnvEntry {
    expr: TYPE.Expression;
    /** 定义所在的语句列表与下标(用于判断“紧邻下一条语句”的副作用搬移) */
    list: TYPE.Statement[];
    index: number;
    /** expr 中引用到的变量名,用于写入时级联失效 */
    deps: string[];
    /** 在当前定义有效期内,有多少次读取因为不安全而没有被替换 */
    unsubstitutedReads: number;
}

interface FunctionContext {
    infos: Map<string, BindingInfo>;
    /** 被搬移的表达式 -> 当前承载它的语句(用于区分中间副本和最终落点) */
    moved: Map<TYPE.Node, TYPE.Statement>;
    /** 每条语句之后仍然活跃的 temp(复制传播前计算) */
    liveAfter: Map<TYPE.Statement, Set<string>>;
    /** 当前函数剩余的可克隆节点预算,防止表达式指数膨胀 */
    cloneBudget: number;
    /** 当前函数中出现在 return 表达式里的变量名 */
    returned: Set<string>;
    /**
     * if 语句两个分支的 live-in 并集。test 里的读取是否“最后一次使用”不能只看
     * liveAfter:分支里可能 break/return 到循环外继续读取该变量
     * (`v4 = parse(); if (v4.completed) break; ...` 之后 `return v4`)。
     */
    branchLive: Map<TYPE.Node, Set<string>>;
    /**
     * 循环体入口的活跃集(循环条件每轮求值后的“下一轮”活跃变量)。
     * 循环 test 里的死赋值需要它:test 写入的临时变量如果下一轮 body 会先写后读,
     * 且循环结束后不再读取,这次写入就是死的。只用 liveAfter(循环之后) 会把
     * `v8 = false` 这类寄存器恢复误判为活跃(body 里的 `v8 = v6.call(v5)` 先写后读)。
     */
    loopBodyIn: Map<TYPE.Node, Set<string>>;
}

/**
 * 循环内 break/continue 的活跃性上下文。
 * `continue` 跳到循环头(test/update),`break` 跳到循环之后;
 * 二者都不该沿用“循环体列表里的下一条语句”的 liveOut,否则循环体末尾的
 * `continue`/`break` 会把整段活跃集清空或放大,造成误删/漏删死赋值:
 *   v0 = 0; for (...) { if (c) { v1 = this.arr; v1[i] = 1; break; } arr[i] = v0; }
 */
interface LoopLive {
    /** continue 之后仍然活跃的名字(含循环头 test/update 的读取) */
    continueLive: Set<string>;
    /** break 之后仍然活跃的名字(循环之后的代码) */
    breakLive: Set<string>;
    /** 位于 switch 里的 break 只跳出 switch,不能套用 breakLive */
    inSwitch: boolean;
    /**
     * 外层 try/finally 的 finally 读取集合:return/throw/break/continue 这些跳出口
     * 都会先执行 finally,活跃集必须并入它们在出口处的读取(活跃性模型没有异常边)。
     */
    finallyLive?: Set<string>;
}

/** 属性归一化键:非 computed 标识符与 computed 字符串字面量视为同一属性;动态键返回 null。 */
function memberPropertyKey(property: TYPE.Expression, computed: boolean): string | null {
    if (!computed && isIdentifier(property)) return property.name;
    if (computed && isStringLiteral(property)) return String(property.value);
    return null;
}

/** expr 中是否存在读取 `object.<key>` 的成员装载;key 为 null(动态键)时按同基对象保守命中。 */
function exprReadsMember(expr: TYPE.Node, object: TYPE.Expression, key: string | null): boolean {
    let found = false;
    walkNode(expr, (n) => {
        if (found) return false;
        if (isFunctionLike(n) || isClassLike(n)) return false;
        if (isMemberExpression(n) || isOptionalMemberExpression(n)) {
            const m = n as TYPE.MemberExpression;
            if (isNodeEqual(m.object as TYPE.Expression, object)) {
                const k = memberPropertyKey(m.property as TYPE.Expression, m.computed);
                // 任一方是动态键时无法证明属性不同,保守视为命中
                if (key === null || k === null || k === key) found = true;
            }
        }
        return !found;
    });
    return found;
}

class EnvState {
    readonly map = new Map<string, EnvEntry>();
    private readonly deps = new Map<string, Set<string>>();

    get(name: string): EnvEntry | undefined {
        return this.map.get(name);
    }

    /** 使缓存中读取了 `object.property` 这一成员路径的项失效。
     *  成员写入只改对象属性,不改变变量绑定,因此别名(如 `v8 = acc`)与
     *  模板对象(`acc = {...}`)不受影响,不能按基对象一刀切。 */
    invalidateMemberReads(object: TYPE.Expression, property: TYPE.Expression, computed: boolean): void {
        const key = memberPropertyKey(property, computed);
        const doomed: string[] = [];
        for (const [name, entry] of this.map) {
            if (exprReadsMember(entry.expr, object, key)) doomed.push(name);
        }
        for (const name of doomed) this.invalidate(name);
    }

    set(name: string, entry: EnvEntry): void {
        this.delete(name);
        this.map.set(name, entry);
        for (const dep of entry.deps) {
            let set = this.deps.get(dep);
            if (!set) {
                set = new Set();
                this.deps.set(dep, set);
            }
            set.add(name);
        }
    }

    delete(name: string): void {
        const entry = this.map.get(name);
        if (!entry) return;
        this.map.delete(name);
        for (const dep of entry.deps) {
            this.deps.get(dep)?.delete(name);
        }
    }

    /** 删除 name 及其所有(传递)依赖它的环境项 */
    invalidate(name: string): void {
        const queue: string[] = [name];
        const seen = new Set<string>();
        while (queue.length > 0) {
            const current = queue.shift()!;
            if (seen.has(current)) continue;
            seen.add(current);
            const holders = this.deps.get(current);
            this.delete(current);
            if (!holders) continue;
            for (const holder of holders) {
                if (this.map.has(holder)) {
                    queue.push(holder);
                }
            }
        }
    }

    copy(): EnvState {
        const copy = new EnvState();
        for (const [name, entry] of this.map) copy.map.set(name, entry);
        for (const [name, set] of this.deps) copy.deps.set(name, new Set(set));
        return copy;
    }
}

export class TempVariableSimplify implements ISimplify {
    private static readonly MAX_PROPAGATED_SIZE = 24;
    private static readonly CLONE_BUDGET = 120000;
    private changed = false;
    private cleanupVersion = 0;
    /** true:只做 `X = E; (X = !X)*; if (X/!X)` 折叠,不做复制传播等其他改写 */
    private conditionsOnly = false;
    /** true:只折叠 `X = E; return X` 并清理失去引用的声明,其余一律不动 */
    private returnsOnly = false;
    /** true:只折叠累加器链(`X = E; X = F(X)`),其余一律不动 */
    private accumulatorOnly = false;
    /** true:只折叠 `X = E; if (X/!X/E/!E) { X = B }` 短路链,其余一律不动 */
    private shortCircuitOnly = false;

    simplify(node: Program): boolean {
        this.changed = false;
        this.conditionsOnly = false;
        traverse(file(node), {
            Program: (path) => this.processScope(path),
            Function: (path) => this.processScope(path),
        });
        return this.changed;
    }

    /**
     * 只折叠条件赋值模式。HighLevelGrammarSimplify 会把
     * `if (!X) { X = true } else { X = false }` 合成为 `X = !X`,
     * 与 callruntime.isfalse 生成的 `X = !X` 构成连续自取反链,
     * 需要在流水线末尾补一轮。此时不再做复制传播,避免推翻已稳定的输出。
     */
    static foldConditionAssignments(node: Program): boolean {
        const pass = new TempVariableSimplify();
        pass.changed = false;
        pass.conditionsOnly = true;
        traverse(file(node), {
            Program: (path) => pass.processScope(path),
            Function: (path) => pass.processScope(path),
        });
        return pass.changed;
    }

    /**
     * 删除完全未使用的块级词法变量声明(local_X_Y / sendable_X_Y)以及随之为空的块。
     *
     * newLexEnv 会为编译器预留的每个槽生成 `let local_X_Y`,但循环变量未被闭包捕获时
     * 槽可能从未被读写;块级声明又不在 TempVariableSimplify 的函数级 ctx.infos 里,
     * 旧的清理逻辑不会删除它们。这里按 Babel binding 精确判断(读写都为 0)。
     */
    public static removeUnusedLexicalDeclarations(node: Program): boolean {
        let changed = false;
        traverse(file(node), {
            VariableDeclaration(path) {
                const parent = path.parentPath;
                if (!parent || !(isBlockStatement(parent.node) || isProgramNode(parent.node))) return;
                const kept = path.node.declarations.filter((declarator) => {
                    if (!isIdentifier(declarator.id) || declarator.init) return true;
                    if (!/^(local|sendable)_\d+_\d+(_\d+)?$/.test(declarator.id.name)) return true;
                    const binding = path.scope.getBinding(declarator.id.name);
                    if (!binding || binding.identifier !== declarator.id) return true;
                    return binding.referencePaths.length !== 0 || binding.constantViolations.length !== 0;
                });
                if (kept.length === path.node.declarations.length) return;
                changed = true;
                if (kept.length === 0) {
                    path.remove();
                } else {
                    path.node.declarations = kept;
                }
            },
        });
        // 声明删除后再扫一遍,把刚变空的块去掉
        traverse(file(node), {
            BlockStatement(path) {
                if (path.node.body.length !== 0) return;
                const parent = path.parentPath;
                if (!parent || !(isBlockStatement(parent.node) || isProgramNode(parent.node))) return;
                if (!Array.isArray(parent.node.body) || !parent.node.body.includes(path.node)) return;
                path.remove();
                changed = true;
            },
        });
        return changed;
    }

    /**
     * 只折叠 `X = E; if (X/!X/E/!E) { X = B }` 短路链,并清理失去引用的声明。
     * HighLevelGrammarSimplify 会把 `if (!T) { X = true } else { X = false }` 合成
     * `X = !T`,此时才出现 `X = E; if (E) { X = !T }`;轮内的 foldShortCircuitChains
     * 已经跑完,需要在流水线尾部补一轮(见 SimplifyExport)。
     */
    static foldShortCircuitAssignments(node: Program): boolean {
        const pass = new TempVariableSimplify();
        pass.changed = false;
        pass.shortCircuitOnly = true;
        traverse(file(node), {
            Program: (path) => pass.processScope(path),
            Function: (path) => pass.processScope(path),
        });
        return pass.changed;
    }

    /**
     * 只折叠 `X = E; return X`,以及尾部才生成的三元赋值留下的别名拷贝 /
     * 累加器链 / 调用参数末次读取(`X = E; f(X)`),不做复制传播/条件改写,
     * 并清理随之失去引用的声明。
     * HighLevelGrammarSimplify 在定点迭代结束后把 `if (C) { X = A } else { X = B }`
     * 合成为 `X = C ? A : B`,轮内的返回值折叠此时已经跑完,需要在尾部补一轮。
     */
    static foldReturnAssignments(node: Program): boolean {
        const pass = new TempVariableSimplify();
        pass.changed = false;
        pass.returnsOnly = true;
        traverse(file(node), {
            Program: (path) => pass.processScope(path),
            Function: (path) => pass.processScope(path),
        });
        return pass.changed;
    }

    /**
     * 只折叠累加器链(`X = E; X = F(X)` -> `X = F(E)`),其余一律不动。
     *
     * 超过 MAX_PROPAGATED_SIZE 的长右值进不了复制传播环境(define 直接拒收),
     * 嵌套累加链 `acc = S; acc = acc + E + F > 0` 会原样留到定点迭代结束,
     * 使 HighLevelGrammarSimplify 的三目合成对
     * `if (C) { acc = S; acc = acc + E + F > 0 } else { acc = false }`
     * 匹配失败(它要求分支是单条赋值语句)。这里在合成之前补折一次。
     */
    static foldAccumulatorAssignments(node: Program): boolean {
        const pass = new TempVariableSimplify();
        pass.changed = false;
        pass.accumulatorOnly = true;
        traverse(file(node), {
            Program: (path) => pass.processScope(path),
            Function: (path) => pass.processScope(path),
        });
        return pass.changed;
    }

    private processScope(path: NodePath<TYPE.Program> | NodePath<TYPE.Function>): void {
        const scope = path.scope;
        const body: TYPE.Statement[] | null = isProgramNode(path.node)
            ? path.node.body
            : (isBlockStatement(path.node.body) ? path.node.body.body : null);
        if (!body || body.length === 0) return;

        const infos = new Map<string, BindingInfo>();
        for (const name of Object.keys(scope.bindings)) {
            if (!isTempName(name)) continue;
            const binding = scope.bindings[name];
            if (!binding || binding.scope !== scope) continue;
            const refs = new Set<TYPE.Node>();
            for (const reference of binding.referencePaths) {
                if (reference.node) refs.add(reference.node);
            }
            const captured = this.isCapturedBinding(binding, path.node);
            infos.set(name, { name, refs, captured });
        }
        if (infos.size === 0) return;

        const ctx: FunctionContext = {
            infos,
            moved: new Map(),
            liveAfter: new Map(),
            cloneBudget: TempVariableSimplify.CLONE_BUDGET,
            returned: new Set(),
            branchLive: new Map(),
            loopBodyIn: new Map(),
        };
        this.renameCatchParameters(path, ctx);
        walkNode({ type: "BlockStatement", body } as TYPE.BlockStatement, (node) => {
            if (isFunctionLike(node) || isClassLike(node)) return false;
            if (isReturnStatement(node) && node.argument) {
                for (const name of collectIdentifierNames(node.argument)) ctx.returned.add(name);
            }
            return true;
        });
        if (this.returnsOnly) {
            // 尾部三元合成后可能留下累加器链/临时变量别名(见 foldAccumulatorChains /
            // foldTempAliasAssignments),需要活跃性判断被搬移的旧值是否已死。
            this.analyzeList(body, new Set(), ctx);
            // 尾部三元合成后可能留下累加器链(见 foldAccumulatorChains),
            // 先折链再折 return,才能把整段拼接还原成单个表达式。
            this.foldReturnAssignments(body, ctx);
            this.removeUnusedDeclarations(body, ctx);
            return;
        }
        if (this.accumulatorOnly) {
            this.foldAccumulatorChainsDeep(body, ctx);
            return;
        }
        if (this.shortCircuitOnly) {
            this.foldShortCircuitChains(body, ctx);
            this.removeUnusedDeclarations(body, ctx);
            return;
        }
        // 复制传播前先算一遍活跃性,用于判断某次读取是否是当前值的最后一次使用
        this.analyzeList(body, new Set(), ctx);
        if (!this.conditionsOnly) {
            // 自引用链(`X = X.length; X = f(X)`)先折叠,让后续活跃性/传播看到更紧凑的形态
            this.foldSelfReadChains(body, ctx);
            this.processStatements(body, new EnvState(), ctx);
            // do { ...; X = E; } while (!X) -> do { ... } while (!E)
            this.foldDoWhileTestAssignments(body, ctx);
            // 复制传播结束后做基于活跃性的死存储消除;最多 3 轮处理级联死代码
            for (let i = 0; i < 3; i++) {
                const version = this.cleanupVersion;
                this.cleanupStatements(body, ctx, new Set());
                if (this.cleanupVersion === version) break;
            }
            this.cleanupSequenceExpressions(body, ctx);
            // 循环 test 是表达式序列,不在语句列表里,单独的活跃性/死存储逻辑覆盖不到它:
            //   do { ... } while ((acc = f(v), v = acc, acc = !(acc !== undefined), v === undefined) || ...)
            this.foldLoopTestTemps(body, ctx);
        }
        this.foldTestSequences(body, ctx);
        if (this.conditionsOnly) this.foldBooleanAliasAssignments(body, ctx);
        this.cleanupConditionAssignments(body, ctx);
        if (!this.conditionsOnly) {
            this.foldShortCircuitChains(body, ctx);
            this.foldReturnAssignments(body, ctx);
            this.hoistNamedFunctionExpressions(body, ctx, scope);
            this.foldSplitStringArrays(body, ctx);
        }
        this.removeUnusedDeclarations(body, ctx);
    }

    /**
     * local_0_x = function add32(...) {...}; -> function add32(...) {...};
     * 同时把所有对 local_0_x 的引用改名,并删除对应声明。
     * 只处理函数体/Program 顶层的赋值,避免影响块级作用域语义。
     */
    /** X = E; return X; -> return E; */
    private foldReturnAssignments(stmts: TYPE.Statement[], ctx: FunctionContext): void {
        // 先折累加器链:X = E; X = X + F -> X = E + F。
        // HighLevelGrammarSimplify 在定点迭代之后才把条件物化合成三元赋值,
        // 轮内已经跑过的复制传播来不及处理 acc = C ? A : B; acc = v0 + acc。
        if (this.returnsOnly) {
            // `X = E; Y = X`(X 之后已死)-> `Y = E`,同样针对尾部才生成的三元赋值。
            this.foldTempAliasAssignments(stmts, ctx);
            this.foldAccumulatorChains(stmts, ctx);
            // `X = E; f(X)`(调用参数位置,X 之后已死)-> `f(E)`。
            // HighLevelGrammarSimplify 的三目合成在定点迭代之后,轮内的复制传播
            // 来不及处理紧随其后的调用参数(典型:`acc = isPlaying || isBuffering;
            // envService.setKeepScreenOn(acc)`)。
            this.foldTempLastUseIntoCallArguments(stmts, ctx);
        }
        let repeat = false;
        do {
            repeat = false;
            for (let i = stmts.length - 2; i >= 0; i--) {
                if (!this.tryFoldReturnAssignment(stmts, i, ctx)) continue;
                this.changed = true;
                repeat = this.returnsOnly;
                // 保留原有步进:i-- 让下一轮从更靠前的语句继续
                i--;
            }
        } while (repeat);
        // 递归处理嵌套块(else 分支、循环体等):流水线尾部的三元合成
        // (`acc = C ? A : B` + `return acc`)大多发生在嵌套块里,
        // 只扫顶层会让 `acc = ...; return acc;` 残留到输出。
        for (const stmt of stmts) this.foldReturnAssignmentsInChildren(stmt, ctx);
    }

    /**
     * 尝试折叠 stmts[i] / stmts[i + 1] 这一对(赋值 + return)。
     * 常规形态是 `X = E; return X`;尾部模式下还允许 return 表达式里只读一次 X:
     *   `X = E; return X + "}"` -> `return E + "}"`
     */
    private tryFoldReturnAssignment(stmts: TYPE.Statement[], i: number, ctx: FunctionContext): boolean {
        const assignStmt = stmts[i];
        const returnStmt = stmts[i + 1];
        if (!isExpressionStatement(assignStmt) || !isAssignmentExpression(assignStmt.expression)) return false;
        const assign = assignStmt.expression;
        if (assign.operator !== "=" || !isIdentifier(assign.left)) return false;
        if (!isReturnStatement(returnStmt) || !returnStmt.argument) return false;
        const name = assign.left.name;
        // 直接读取右值里的 X(如 new Promise(acc))在赋值前求值,折叠后仍是同一个旧值;
        // 若右值会写入 X(X++ / X = ...),折叠会改变写入次数,直接跳过。
        if (collectAssignedNames(assign.right).has(name)) return false;
        // 只有闭包/类字段里延迟读取 X 时,赋值是否发生才会影响结果,必须保守跳过。
        if (this.hasDeferredSelfReference(assign.right, name)) return false;
        const info = ctx.infos.get(name);
        if (isIdentifier(returnStmt.argument) && returnStmt.argument.name === name) {
            info?.refs.delete(returnStmt.argument);
            returnStmt.argument = assign.right;
            stmts.splice(i, 1);
            return true;
        }
        if (!this.returnsOnly || !isTempName(name) || !info) return false;
        // return 表达式里必须只直接读取一次 X;闭包里的读取不能替换,否则删掉赋值后
        // 闭包看到的是更旧的值。
        if (this.hasDeferredSelfReference(returnStmt.argument, name)) return false;
        if (this.countReadsInNode(returnStmt.argument, name) !== 1) return false;
        let id: TYPE.Identifier | null = null;
        walkNode(returnStmt.argument, (node, parent) => {
            if (isFunctionLike(node) || isClassLike(node)) return false;
            if (isIdentifier(node) && node.name === name && parent && isReferenced(node, parent)) {
                id = node;
                return false;
            }
            return true;
        });
        if (!id) return false;
        const value = assign.right;
        if (!isPureExpression(value)) {
            // 右值有副作用:只有 X 位于 return 表达式里最先求值的位置时,
            // 把它搬到 return 里才和原赋值语句的求值时序一致。
            if (!this.isFirstEvaluatedOccurrence(returnStmt.argument, id)) return false;
        } else {
            // 纯右值搬进 return 后可能越过 return 里先求值的写入:
            //   X = Y; return (Y = 1, X)  ->  return (Y = 1, Y)
            const assigned = collectAssignedNames(returnStmt.argument);
            for (const dep of collectIdentifierNames(value)) {
                if (dep !== name && assigned.has(dep)) return false;
            }
        }
        info.refs.delete(id);
        if (returnStmt.argument === id) returnStmt.argument = value;
        else if (!replaceNodeInTree(returnStmt.argument, id, value)) return false;
        stmts.splice(i, 1);
        return true;
    }

    /**
     * 累加器链:`X = E; X = <二元运算, 其中 X 只出现一次>` -> `X = ...E...`。
     *
     * 编译器为字符串拼接生成 `v0 = v0 + "..."; acc = v0 + acc; return acc + "}"`,
     * 这些语句各自只消费旧值一次,可以整体合并成一个表达式。E 含有调用(如
     * `p0.map(...).join(...)`)时复制传播不允许克隆,只能靠本方法整块搬移。
     */
    private foldAccumulatorChains(stmts: TYPE.Statement[], ctx: FunctionContext): void {
        for (let i = 0; i < stmts.length; i++) {
            // 合并后的语句仍可能和下一条继续成链
            while (i + 1 < stmts.length && this.tryFoldAccumulatorPair(stmts, i, ctx)) {
                // retry same index
            }
        }
    }

    private tryFoldAccumulatorPair(stmts: TYPE.Statement[], i: number, ctx: FunctionContext): boolean {
        const first = stmts[i];
        const second = stmts[i + 1];
        if (!isExpressionStatement(first) || !isAssignmentExpression(first.expression)) return false;
        if (!isExpressionStatement(second) || !isAssignmentExpression(second.expression)) return false;
        const a = first.expression;
        const b = second.expression;
        if (a.operator !== "=" || b.operator !== "=") return false;
        if (!isIdentifier(a.left) || !isIdentifier(b.left)) return false;
        const name = a.left.name;
        if (b.left.name !== name || !isTempName(name)) return false;
        const info = ctx.infos.get(name);
        if (!info || info.captured) return false;
        if (!isBinaryExpression(b.right)) return false;
        if (this.countReadsInNode(b.right, name) !== 1) return false;
        if (collectAssignedNames(b.right).has(name)) return false;
        // 闭包里对 X 的延迟读取在两种写法里看到的都是最终值,但立即执行的闭包
        // (IIFE)会读到不同的旧值,保守跳过。
        if (this.hasDeferredSelfReference(a.right, name) || this.hasDeferredSelfReference(b.right, name)) return false;

        // 定位右值里唯一一次 X 读取。它可能在任意深度(典型:
        // `acc = S; acc = acc + E + F > 0`,X 嵌在左子树深处),不能只看
        //二元运算的直接操作数。
        let id: TYPE.Identifier | null = null;
        walkNode(b.right, (node, parent) => {
            if (isFunctionLike(node) || isClassLike(node)) return false;
            if (isIdentifier(node) && node.name === name && parent && isReferenced(node, parent)) {
                id = node;
                return false;
            }
            return true;
        });
        if (!id) return false;
        const value = a.right;
        if (!this.isFirstEvaluatedOccurrence(b.right, id)) {
            // X 不在最先求值的位置(右子树/深左子树但有更早的兄弟):
            // 求值顺序会变,只有纯右值且 E 的读取不被 b.right 里的写入命中时才安全。
            if (!isPureExpression(value)) return false;
            const assigned = collectAssignedNames(b.right);
            for (const dep of collectIdentifierNames(value)) {
                if (dep !== name && assigned.has(dep)) return false;
            }
        }
        info.refs.delete(id);
        if (!replaceNodeInTree(b.right, id, value)) return false;
        stmts.splice(i, 1);
        this.changed = true;
        return true;
    }

    /**
     * 尾部补齐:`X = E; Y = X` -> `Y = E`(X 在之后已死)。
     *
     * HighLevelGrammarSimplify 在定点迭代结束后才把条件物化合成
     * `acc = C ? A : B`,轮内的复制传播来不及处理紧随其后的 `local_x = acc`。
     * Y 允许被闭包捕获(写入点和求值顺序都不变);X 必须未被捕获且之后不再读取,
     * 否则删掉赋值会改变其后续读取到的值。
     */
    private foldTempAliasAssignments(stmts: TYPE.Statement[], ctx: FunctionContext): void {
        for (let i = 0; i + 1 < stmts.length; i++) {
            // 合并后的 Y = E 仍可能继续作为下一条 `Z = Y` 的来源
            while (i + 1 < stmts.length && this.tryFoldTempAlias(stmts, i, ctx)) {
                // retry same index
            }
        }
    }

    private tryFoldTempAlias(stmts: TYPE.Statement[], i: number, ctx: FunctionContext): boolean {
        const first = stmts[i];
        const second = stmts[i + 1];
        if (!isExpressionStatement(first) || !isAssignmentExpression(first.expression)) return false;
        if (!isExpressionStatement(second) || !isAssignmentExpression(second.expression)) return false;
        const a = first.expression;
        const b = second.expression;
        if (a.operator !== "=" || b.operator !== "=") return false;
        if (!isIdentifier(a.left) || !isIdentifier(b.right)) return false;
        const source = a.left.name;
        if (!isTempName(source) || b.right.name !== source) return false;
        // 目标是变量时保持原有限制;目标是成员(`v0.sbox = acc`)时只要求左值求值无副作用,
        // 否则把 E 搬到赋值右侧会改变 E 与左值副作用之间的求值顺序。
        if (isIdentifier(b.left)) {
            if (!isTempName(b.left.name) || b.left.name === source) return false;
        } else if (isMemberExpression(b.left)) {
            const member = b.left;
            if (!isPureExpression(member.object as TYPE.Expression)) return false;
            if (member.computed && !isPureExpression(member.property as TYPE.Expression)) return false;
        } else {
            return false;
        }
        const info = ctx.infos.get(source);
        if (!info || info.captured) return false;
        // X 的旧值在第二条语句之后必须已死;闭包里的读取由 captured 兜底
        const liveAfter = ctx.liveAfter.get(second);
        if (!liveAfter || liveAfter.has(source)) return false;
        info.refs.delete(b.right);
        b.right = a.right;
        stmts.splice(i, 1);
        this.changed = true;
        return true;
    }

    /**
     * 尾部补齐:`X = E; f(...X...)` -> `f(...E...)`(调用参数位置,X 之后已死)。
     *
     * HighLevelGrammarSimplify 在定点迭代结束后才把条件物化合成 `acc = C ? A : B`,
     * 轮内的复制传播来不及处理紧随其后的调用参数,典型形态:
     *   acc = isPlaying || isBuffering; envService.setKeepScreenOn(acc);
     * 只在纯右值时折叠,保证搬移不改变副作用顺序;语句内的写入不得命中
     * 右值读取的名字。X 必须未被捕获、在消费语句之后不再读取;读取位于
     * callee 位置(`acc = obj.fn; acc()`)时不折叠,那是 AccCallSimplify 的领域。
     */
    private foldTempLastUseIntoCallArguments(stmts: TYPE.Statement[], ctx: FunctionContext): void {
        for (let i = 0; i + 1 < stmts.length; i++) {
            if (!this.tryFoldTempCallArgument(stmts, i, ctx)) continue;
            i--;
        }
    }

    private tryFoldTempCallArgument(stmts: TYPE.Statement[], i: number, ctx: FunctionContext): boolean {
        const first = stmts[i];
        const second = stmts[i + 1];
        if (!isExpressionStatement(first) || !isAssignmentExpression(first.expression)) return false;
        const a = first.expression;
        if (a.operator !== "=" || !isIdentifier(a.left)) return false;
        const name = a.left.name;
        if (!isTempName(name) || isDeclarationValue(a.right)) return false;
        // 右值自引用(`X = F(X)`)是累加器链的形态,交给 foldAccumulatorChains
        if (collectReadNames(a.right).has(name)) return false;
        if (!isExpressionStatement(second)) return false;
        if (!isCallExpression(second.expression) && !isOptionalCallExpression(second.expression)) return false;
        const info = ctx.infos.get(name);
        if (!info || info.captured) return false;
        const consumer = second.expression;
        // 语句内不得写入 X(如 `f((X = 1))`),否则删掉赋值会改变写入次数
        if (collectAssignedNames(second).has(name)) return false;
        if (this.countReadsInNode(consumer, name) !== 1) return false;
        const liveAfter = ctx.liveAfter.get(second);
        if (!liveAfter || liveAfter.has(name)) return false;

        let id: TYPE.Identifier | null = null;
        walkNode(consumer, (node, parent) => {
            if (isFunctionLike(node) || isClassLike(node)) return false;
            if (isIdentifier(node) && node.name === name && parent && isReferenced(node, parent)) {
                id = node;
                return false;
            }
            return true;
        });
        if (!id) return false;
        // callee 位置的读取是方法装载形态,交给 AccCallSimplify
        if (this.containsNode(consumer.callee, id)) return false;
        // 纯右值搬进参数位置只可能被语句内先求值的写入影响
        if (!isPureExpression(a.right)) return false;
        const assigned = collectAssignedNames(consumer);
        for (const dep of collectIdentifierNames(a.right)) {
            if (assigned.has(dep)) return false;
        }

        info.refs.delete(id);
        if (!replaceNodeInTree(consumer, id, a.right)) return false;
        stmts.splice(i, 1);
        this.changed = true;
        return true;
    }

    /**
     * target 是否是 root 中最先求值的子表达式。
     * 用于判断有副作用的右值能否搬进该位置(搬过去后仍先于其它操作求值)。
     */
    private isFirstEvaluatedOccurrence(root: TYPE.Node, target: TYPE.Node): boolean {
        let node: TYPE.Node = root;
        while (node !== target) {
            const next = this.firstEvaluatedChild(node);
            if (!next) return false;
            node = next;
        }
        return true;
    }

    private firstEvaluatedChild(node: TYPE.Node): TYPE.Node | null {
        if (isBinaryExpression(node) || isLogicalExpression(node)) return node.left;
        if (isConditionalExpression(node)) return node.test;
        if (isSequenceExpression(node)) return node.expressions[0] ?? null;
        if (isUnaryExpression(node) || isUpdateExpression(node) || isSpreadElement(node)) return node.argument;
        if (isMemberExpression(node)) return node.object;
        if (isOptionalMemberExpression(node)) return node.object;
        if (isCallExpression(node) || isNewExpression(node) || isOptionalCallExpression(node)) return node.callee;
        if (isTaggedTemplateExpression(node)) return node.tag;
        if (isAssignmentExpression(node)) return node.left;
        return null;
    }

    private foldReturnAssignmentsInChildren(stmt: TYPE.Statement, ctx: FunctionContext): void {
        switch (stmt.type) {
            case "BlockStatement":
                this.foldReturnAssignments(stmt.body, ctx);
                break;
            case "IfStatement":
                if (isBlockStatement(stmt.consequent)) this.foldReturnAssignments(stmt.consequent.body, ctx);
                else this.foldReturnAssignmentsInChildren(stmt.consequent, ctx);
                if (stmt.alternate) {
                    if (isBlockStatement(stmt.alternate)) this.foldReturnAssignments(stmt.alternate.body, ctx);
                    else this.foldReturnAssignmentsInChildren(stmt.alternate, ctx);
                }
                break;
            case "WhileStatement":
            case "DoWhileStatement":
            case "ForStatement":
            case "ForInStatement":
            case "ForOfStatement":
            case "LabeledStatement":
                if (isBlockStatement(stmt.body)) this.foldReturnAssignments(stmt.body.body, ctx);
                else this.foldReturnAssignmentsInChildren(stmt.body, ctx);
                break;
            case "TryStatement":
                if (isBlockStatement(stmt.block)) this.foldReturnAssignments(stmt.block.body, ctx);
                if (stmt.handler) this.foldReturnAssignments(stmt.handler.body.body, ctx);
                if (stmt.finalizer) this.foldReturnAssignments(stmt.finalizer.body, ctx);
                break;
            case "SwitchStatement":
                for (const c of stmt.cases) this.foldReturnAssignments(c.consequent, ctx);
                break;
            default:
                break;
        }
    }

    /**
     * foldAccumulatorChains 的递归版:累加链大多位于 if 分支/循环体等嵌套块里。
     * 先折当前列表,再逐条语句下钻,保证任意深度的嵌套块都被处理。
     */
    private foldAccumulatorChainsDeep(stmts: TYPE.Statement[], ctx: FunctionContext): void {
        this.foldAccumulatorChains(stmts, ctx);
        for (const stmt of stmts) this.foldAccumulatorChainsInChildren(stmt, ctx);
    }

    private foldAccumulatorChainsInChildren(stmt: TYPE.Statement, ctx: FunctionContext): void {
        switch (stmt.type) {
            case "BlockStatement":
                this.foldAccumulatorChainsDeep(stmt.body, ctx);
                break;
            case "IfStatement":
                if (isBlockStatement(stmt.consequent)) this.foldAccumulatorChainsDeep(stmt.consequent.body, ctx);
                else this.foldAccumulatorChainsInChildren(stmt.consequent, ctx);
                if (stmt.alternate) {
                    if (isBlockStatement(stmt.alternate)) this.foldAccumulatorChainsDeep(stmt.alternate.body, ctx);
                    else this.foldAccumulatorChainsInChildren(stmt.alternate, ctx);
                }
                break;
            case "WhileStatement":
            case "DoWhileStatement":
            case "ForStatement":
            case "ForInStatement":
            case "ForOfStatement":
            case "LabeledStatement":
                if (isBlockStatement(stmt.body)) this.foldAccumulatorChainsDeep(stmt.body.body, ctx);
                else this.foldAccumulatorChainsInChildren(stmt.body, ctx);
                break;
            case "TryStatement":
                if (isBlockStatement(stmt.block)) this.foldAccumulatorChainsDeep(stmt.block.body, ctx);
                if (stmt.handler) this.foldAccumulatorChainsDeep(stmt.handler.body.body, ctx);
                if (stmt.finalizer) this.foldAccumulatorChainsDeep(stmt.finalizer.body, ctx);
                break;
            case "SwitchStatement":
                for (const c of stmt.cases) this.foldAccumulatorChainsDeep(c.consequent, ctx);
                break;
            default:
                break;
        }
    }

    /** 右值中是否存在位于函数/类内部、可能在赋值之后才执行的同名读取。 */
    private hasDeferredSelfReference(node: TYPE.Node | null | undefined, name: string): boolean {
        let found = false;
        const visit = (current: TYPE.Node | null | undefined, inDeferred: boolean): void => {
            if (found || !current || typeof (current as any).type !== "string") return;
            if (inDeferred && isIdentifier(current) && current.name === name) {
                found = true;
                return;
            }
            const nested = inDeferred || isFunctionLike(current) || isClassLike(current);
            const keys = (VISITOR_KEYS as any)[current.type] as string[] | undefined;
            if (!keys) return;
            for (const key of keys) {
                const value = (current as any)[key];
                if (Array.isArray(value)) {
                    for (const child of value) visit(child, nested);
                } else {
                    visit(value, nested);
                }
            }
        };
        visit(node, false);
        return found;
    }

    private hasHoistCandidate(stmts: TYPE.Statement[]): boolean {
        for (const stmt of stmts) {
            if (!isExpressionStatement(stmt) || !isAssignmentExpression(stmt.expression)) continue;
            const assign = stmt.expression;
            if (assign.operator !== "=" || !isIdentifier(assign.left)) continue;
            if (!/^local_\d+_\d+(_\d+)?$/.test(assign.left.name)) continue;
            if (isFunctionExpression(assign.right) && assign.right.id) return true;
        }
        return false;
    }

    /** 复制传播后按当前 AST 重建临时变量的引用集合,修正被克隆/移动/删除的节点。 */
    private refreshBindingInfos(scope: any, ctx: FunctionContext): void {
        if (!scope || typeof scope.crawl !== "function") return;
        scope.crawl();
        const currentFunction: TYPE.Node = scope.block;
        for (const [name, old] of [...ctx.infos]) {
            const binding = scope.getOwnBinding ? scope.getOwnBinding(name) : undefined;
            if (!binding) {
                old.refs.clear();
                continue;
            }
            const refs = new Set<TYPE.Node>();
            for (const reference of binding.referencePaths) {
                if (reference.node) refs.add(reference.node);
            }
            let captured = this.isCapturedBinding(binding, currentFunction);
            ctx.infos.set(name, { name, refs, captured });
        }
    }

    /**
     * 变量是否被嵌套函数读写。
     * 读取记录在 binding.referencePaths,赋值/自增记录在 binding.constantViolations;
     * 只看读取会漏掉“闭包只写不读”的变量(如 `local_x = undefined` 初始化后仅由回调赋值),
     * 导致把外层初始化当成唯一值传播进闭包后的读取,并连带删掉声明。
     */
    private isCapturedBinding(binding: any, functionNode: TYPE.Node): boolean {
        const isProgram = isProgramNode(functionNode);
        const paths: NodePath[] = [
            ...(binding.referencePaths ?? []),
            ...(binding.constantViolations ?? []),
        ];
        for (const path of paths) {
            const functionParent = path.getFunctionParent();
            if (isProgram ? functionParent != null : (!functionParent || functionParent.node !== functionNode)) {
                return true;
            }
        }
        return false;
    }

    private hoistNamedFunctionExpressions(stmts: TYPE.Statement[], ctx: FunctionContext, scope: any): void {
        // 没有候选时直接返回,避免每轮都遍历整棵子树(含嵌套函数)
        if (!this.hasHoistCandidate(stmts)) return;
        // 复制传播/死存储清理会克隆或移动节点,processScope 开始时建立的
        // binding.referencePaths 已经过期(克隆出来的引用不在 refs 里)。
        // 若直接按旧 refs 改名并删除声明,会留下未声明的 local_* 引用。
        this.refreshBindingInfos(scope, ctx);

        const nameCounts = new Map<string, number>();
        const writes = new Map<string, TYPE.Statement[]>();
        for (const stmt of stmts) {
            walkNode(stmt, (node) => {
                if (isIdentifier(node)) {
                    nameCounts.set(node.name, (nameCounts.get(node.name) || 0) + 1);
                }
                if (isAssignmentExpression(node) && isIdentifier(node.left)) {
                    let list = writes.get(node.left.name);
                    if (!list) { list = []; writes.set(node.left.name, list); }
                    list.push(stmt);
                } else if (isUpdateExpression(node) && isIdentifier(node.argument)) {
                    let list = writes.get(node.argument.name);
                    if (!list) { list = []; writes.set(node.argument.name, list); }
                    list.push(stmt);
                }
                return true;
            });
        }

        const candidates: Array<{ stmt: TYPE.Statement; name: string; fn: TYPE.FunctionExpression }> = [];
        for (const stmt of stmts) {
            if (!isExpressionStatement(stmt) || !isAssignmentExpression(stmt.expression)) continue;
            const assign = stmt.expression;
            if (assign.operator !== "=" || !isIdentifier(assign.left)) continue;
            const name = assign.left.name;
            if (!/^local_\d+_\d+(_\d+)?$/.test(name)) continue;
            if (!isFunctionExpression(assign.right) || !assign.right.id) continue;
            if (!ctx.infos.get(name) || ctx.infos.get(name)!.refs.size === 0) continue;
            candidates.push({ stmt, name, fn: assign.right });
        }

        for (let i = candidates.length - 1; i >= 0; i--) {
            const { stmt, name, fn } = candidates[i];
            const functionName = fn.id!.name;
            if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(functionName) || functionName === name) continue;
            const nameWrites = writes.get(name);
            if (!nameWrites || nameWrites.length !== 1 || nameWrites[0] !== stmt) continue;
            if (scope.getOwnBinding && scope.getOwnBinding(functionName)) continue;
            if ((nameCounts.get(functionName) || 0) !== this.countIdentifiers(stmt, functionName)) continue;

            const index = stmts.indexOf(stmt);
            if (index < 0) continue;
            const info = ctx.infos.get(name)!;
            for (const ref of info.refs) {
                if (isIdentifier(ref)) ref.name = functionName;
            }
            info.refs.clear();
            stmts[index] = functionDeclaration(fn.id!, fn.params, fn.body, fn.generator, fn.async);
            this.removeDeclarator(stmts, name);
            this.changed = true;
        }
    }

    private countIdentifiers(node: TYPE.Node, name: string): number {
        let count = 0;
        walkNode(node, (child) => {
            if (isIdentifier(child) && child.name === name) count++;
            return true;
        });
        return count;
    }

    /** X = "abcdef".split(""); ... X[i] ... -> 直接使用 "abcdef"[i],删除 X。 */
    private foldSplitStringArrays(stmts: TYPE.Statement[], ctx: FunctionContext): void {
        for (let i = stmts.length - 1; i >= 0; i--) {
            const stmt = stmts[i];
            if (!isExpressionStatement(stmt) || !isAssignmentExpression(stmt.expression)) continue;
            const assign = stmt.expression;
            if (assign.operator !== "=" || !isIdentifier(assign.left)) continue;
            if (!isCallExpression(assign.right) || !isMemberExpression(assign.right.callee)) continue;
            const callee = assign.right.callee;
            if (!isStringLiteral(callee.object)) continue;
            const property = callee.property;
            const method = !callee.computed && isIdentifier(property) ? property.name
                : (isStringLiteral(property) ? property.value : "");
            if (method !== "split" || assign.right.arguments.length !== 1) continue;
            const separator = assign.right.arguments[0];
            if (!isStringLiteral(separator) || separator.value !== "") continue;

            const name = assign.left.name;
            if (!isTempName(name)) continue;

            // 允许清理候选之前的 local = undefined/hole 死赋值;其余写入都会使折叠不安全
            let candidateIndex = i;
            let canFold = true;
            for (let j = stmts.length - 1; j >= 0; j--) {
                if (j === candidateIndex) continue;
                const other = stmts[j];
                if (isExpressionStatement(other) && isAssignmentExpression(other.expression)
                    && isIdentifier(other.expression.left) && other.expression.left.name === name) {
                    const rhs = other.expression.right;
                    const isUndefined = (isIdentifier(rhs) && (rhs.name === "undefined" || rhs.name === "hole"))
                        || (isUnaryExpression(rhs) && rhs.operator === "void");
                    if (j < candidateIndex && isUndefined) {
                        stmts.splice(j, 1);
                        candidateIndex--;
                    } else {
                        canFold = false;
                        break;
                    }
                } else if (isUpdateExpression(other) || (isForInStatement(other) || isForOfStatement(other))) {
                    canFold = false;
                    break;
                }
            }
            if (!canFold) continue;

            const value = callee.object.value;
            let valid = true;
            const members: TYPE.MemberExpression[] = [];
            walkNode({ type: "BlockStatement", body: stmts } as TYPE.BlockStatement, (node, parent) => {
                if (!valid) return false;
                if (node === stmts[candidateIndex]) return false;
                if (!isIdentifier(node) || node.name !== name) return true;
                if (parent && isVariableDeclarator(parent) && parent.id === node) return true;
                if (parent && isMemberExpression(parent) && parent.object === node && parent.computed) {
                    members.push(parent);
                    return false;
                }
                valid = false;
                return false;
            });
            if (!valid || members.length === 0) continue;

            for (const member of members) member.object = stringLiteral(value);
            ctx.infos.get(name)?.refs.clear();
            stmts.splice(candidateIndex, 1);
            this.removeDeclarator(stmts, name);
            this.changed = true;
        }
    }

    private removeDeclarator(stmts: TYPE.Statement[], name: string): void {
        for (let i = stmts.length - 1; i >= 0; i--) {
            const stmt = stmts[i];
            if (!isVariableDeclaration(stmt)) continue;
            const kept = stmt.declarations.filter((d) => !(isIdentifier(d.id) && d.id.name === name));
            if (kept.length === stmt.declarations.length) continue;
            if (kept.length === 0) stmts.splice(i, 1);
            else stmt.declarations = kept;
        }
    }

    /**
     * `do { ...; X = E; } while (!X)` -> `do { ... } while (!E)`。
     *
     * 编译器把循环条件物化成 `X = !CALL` 放在 body 末尾、再用 `!X` 跳转。
     * 赋值是 body 最后一条语句,把 E 搬进 test 的求值点完全相同;前提是:
     *   - X 是未被闭包捕获的临时变量,且 E 不写 X;
     *   - body 内没有 continue(continue 会跳过末尾赋值直接进入 test);
     *   - 循环结束后 X 的旧值已死(ctx.liveAfter 不再包含 X)。
     */
    private foldDoWhileTestAssignments(stmts: TYPE.Statement[], ctx: FunctionContext): void {
        for (const stmt of stmts) {
            if (isDoWhileStatement(stmt)) this.foldSingleDoWhileTest(stmt, ctx);
            this.foldDoWhileTestChildren(stmt, ctx);
        }
    }

    private foldDoWhileTestChildren(stmt: TYPE.Statement, ctx: FunctionContext): void {
        switch (stmt.type) {
            case "BlockStatement":
                this.foldDoWhileTestAssignments(stmt.body, ctx);
                break;
            case "IfStatement":
                this.foldDoWhileTestChildren(stmt.consequent, ctx);
                if (stmt.alternate) this.foldDoWhileTestChildren(stmt.alternate, ctx);
                break;
            case "WhileStatement":
            case "DoWhileStatement":
            case "ForStatement":
            case "ForInStatement":
            case "ForOfStatement":
            case "LabeledStatement":
                this.foldDoWhileTestChildren(stmt.body, ctx);
                break;
            case "TryStatement":
                this.foldDoWhileTestAssignments(stmt.block.body, ctx);
                if (stmt.handler) this.foldDoWhileTestAssignments(stmt.handler.body.body, ctx);
                if (stmt.finalizer) this.foldDoWhileTestAssignments(stmt.finalizer.body, ctx);
                break;
            case "SwitchStatement":
                for (const c of stmt.cases) this.foldDoWhileTestAssignments(c.consequent, ctx);
                break;
            default:
                break;
        }
    }

    private foldSingleDoWhileTest(stmt: TYPE.DoWhileStatement, ctx: FunctionContext): boolean {
        const body = stmt.body;
        if (!isBlockStatement(body) || body.body.length < 2) return false;
        const last = body.body[body.body.length - 1];
        if (!isExpressionStatement(last) || !isAssignmentExpression(last.expression)) return false;
        const assign = last.expression;
        if (assign.operator !== "=" || !isIdentifier(assign.left)) return false;
        const name = assign.left.name;
        if (!isTempName(name)) return false;
        const info = ctx.infos.get(name);
        if (!info || info.captured) return false;
        if (collectAssignedNames(assign.right).has(name)) return false;

        const test = stmt.test;
        let testNegated: boolean;
        if (isIdentifier(test) && test.name === name) {
            testNegated = false;
        } else if (isUnaryExpression(test) && test.operator === "!"
            && isIdentifier(test.argument) && test.argument.name === name) {
            testNegated = true;
        } else {
            return false;
        }

        // continue 会跳过末尾赋值直接求值 test,此时 test 读到的是旧值
        let hasContinue = false;
        walkNode(body, (node) => {
            if (isContinueStatement(node)) {
                hasContinue = true;
                return false;
            }
            return true;
        });
        if (hasContinue) return false;

        // 循环之后 X 的旧值必须已死,否则删掉末尾赋值会改变后续读取
        const liveAfter = ctx.liveAfter.get(stmt);
        if (!liveAfter || liveAfter.has(name)) return false;

        body.body.pop();
        let newTest: TYPE.Expression = testNegated ? unaryExpression("!", assign.right) : assign.right;
        // !(!E) -> E
        if (isUnaryExpression(newTest) && newTest.operator === "!"
            && isUnaryExpression(newTest.argument) && newTest.argument.operator === "!") {
            newTest = newTest.argument.argument;
        }
        this.removeRefs(test, ctx);
        stmt.test = newTest;
        this.changed = true;
        return true;
    }

    /**
     * 折叠布尔三目刚展开出来的别名链:
     *   X = E; Y = X && F; ...   ->   Y = E && F; ...
     * 仅当 X 是未被捕获的临时变量、E 不读取 X、且 X 在本条语句之后已死。
     * 重复应用后 `v16 = !A; v15 = v16 && !B; ...` 会收敛成一条逻辑表达式,
     * 再交给 cleanupConditionAssignments 搬进紧随其后的 if test。
     */
    private foldBooleanAliasAssignments(stmts: TYPE.Statement[], ctx: FunctionContext): void {
        let folded = true;
        while (folded) {
            folded = false;
            for (let i = 0; i + 1 < stmts.length; i++) {
                if (this.tryFoldBooleanMaterialization(stmts, i, ctx)) {
                    folded = true;
                    break;
                }
                if (!this.tryFoldBooleanAlias(stmts, i, ctx)) continue;
                folded = true;
                break;
            }
        }
        // 折叠后可能留下只写不读的临时赋值(如循环前的 `acc = false`),
        // 删除它们后 removeUnusedDeclarations 才能清掉对应声明。
        for (let i = stmts.length - 1; i >= 0; i--) {
            const stmt = stmts[i];
            if (!isExpressionStatement(stmt) || !isAssignmentExpression(stmt.expression)) continue;
            const assign = stmt.expression;
            if (assign.operator !== "=" || !isIdentifier(assign.left)) continue;
            const name = assign.left.name;
            if (!isTempName(name) || isDeclarationValue(assign.right) || !isPureExpression(assign.right)) continue;
            const info = ctx.infos.get(name);
            if (!info || info.captured || info.refs.size !== 0) continue;
            stmts.splice(i, 1);
            this.changed = true;
        }
        for (const stmt of stmts) this.foldBooleanAliasChildren(stmt, ctx);
    }

    /**
     * 布尔三目物化链:
     *   X = E; Y = X; X = !X; X = X ? Y : F   ->   X = E && F
     * 逐值等价:E 为假时原式得到 Y(=E),新式短路返回 E;E 为真时原式取 F,
     * 新式继续求值 F。要求 Y 之后已死、F 不读取 X/Y。
     */
    private tryFoldBooleanMaterialization(stmts: TYPE.Statement[], i: number, ctx: FunctionContext): boolean {
        if (i + 3 >= stmts.length) return false;
        const s1 = stmts[i];
        const s2 = stmts[i + 1];
        const s3 = stmts[i + 2];
        const s4 = stmts[i + 3];
        if (!isExpressionStatement(s1) || !isAssignmentExpression(s1.expression)) return false;
        if (!isExpressionStatement(s2) || !isAssignmentExpression(s2.expression)) return false;
        if (!isExpressionStatement(s3) || !isAssignmentExpression(s3.expression)) return false;
        if (!isExpressionStatement(s4) || !isAssignmentExpression(s4.expression)) return false;
        const a = s1.expression;
        const b = s2.expression;
        const c = s3.expression;
        const d = s4.expression;
        if (a.operator !== "=" || !isIdentifier(a.left)) return false;
        if (b.operator !== "=" || !isIdentifier(b.left) || !isIdentifier(b.right)) return false;
        if (c.operator !== "=" || !isIdentifier(c.left)) return false;
        if (d.operator !== "=" || !isIdentifier(d.left)) return false;
        const name = a.left.name;
        if (!isTempName(name) || !isTempName(b.left.name)) return false;
        if (b.right.name !== name || c.left.name !== name || d.left.name !== name) return false;
        if (!isUnaryExpression(c.right) || c.right.operator !== "!"
            || !isIdentifier(c.right.argument) || c.right.argument.name !== name) return false;
        if (!TYPE.isConditionalExpression(d.right)) return false;
        const conditional = d.right;
        if (!isIdentifier(conditional.test) || conditional.test.name !== name) return false;
        if (!isIdentifier(conditional.consequent) || conditional.consequent.name !== b.left.name) return false;
        const fallback = conditional.alternate as TYPE.Expression;
        if (collectReadNames(fallback).has(name) || collectReadNames(fallback).has(b.left.name)) return false;

        const info = ctx.infos.get(name);
        const aliasInfo = ctx.infos.get(b.left.name);
        if (!info || info.captured || !aliasInfo || aliasInfo.captured) return false;
        if (isDeclarationValue(a.right) || collectReadNames(a.right).has(name)) return false;
        // 别名变量 Y 在这次物化之后不能再被读取。
        const liveAfter = ctx.liveAfter.get(s4);
        if (liveAfter && liveAfter.has(b.left.name)) return false;

        this.removeRefs(b.right, ctx);
        this.removeRefs(c.right, ctx);
        this.removeRefs(conditional.test, ctx);
        this.removeRefs(conditional.consequent, ctx);
        a.right = logicalExpression("&&", a.right, fallback);
        stmts.splice(i + 1, 3);
        this.changed = true;
        return true;
    }

    private tryFoldBooleanAlias(stmts: TYPE.Statement[], i: number, ctx: FunctionContext): boolean {
        const first = stmts[i];
        const second = stmts[i + 1];
        if (!isExpressionStatement(first) || !isAssignmentExpression(first.expression)) return false;
        if (!isExpressionStatement(second) || !isAssignmentExpression(second.expression)) return false;
        const a = first.expression;
        const b = second.expression;
        if (a.operator !== "=" || !isIdentifier(a.left)) return false;
        if (b.operator !== "=" || !isIdentifier(b.left)) return false;
        const xName = a.left.name;
        const yName = b.left.name;
        if (!isTempName(xName) || !isTempName(yName)) return false;
        const aInfo = ctx.infos.get(xName);
        const bInfo = ctx.infos.get(yName);
        if (!aInfo || aInfo.captured || !bInfo || bInfo.captured) return false;
        if (isDeclarationValue(a.right)) return false;
        // E 必须只读取旧值一次;这里要求它完全不读 X,避免搬移后读取到更旧的值。
        if (collectReadNames(a.right).has(xName)) return false;

        const rhs = b.right;
        if (!isLogicalExpression(rhs)) return false;
        if (!isIdentifier(rhs.left) || rhs.left.name !== xName) return false;
        if (this.countReadsInNode(rhs, xName) !== 1) return false;
        // X 的值在这次使用之后不能再被读取(闭包读取已由 captured 排除)。
        const liveAfter = ctx.liveAfter.get(second);
        if (liveAfter && liveAfter.has(xName)) return false;

        this.removeRefs(rhs.left, ctx);
        rhs.left = a.right as TYPE.Expression;
        stmts.splice(i, 1);
        this.changed = true;
        return true;
    }

    private foldBooleanAliasChildren(stmt: TYPE.Statement, ctx: FunctionContext): void {
        switch (stmt.type) {
            case "BlockStatement":
                this.foldBooleanAliasAssignments(stmt.body, ctx);
                break;
            case "IfStatement":
                if (isBlockStatement(stmt.consequent)) this.foldBooleanAliasAssignments(stmt.consequent.body, ctx);
                else this.foldBooleanAliasChildren(stmt.consequent, ctx);
                if (stmt.alternate) {
                    if (isBlockStatement(stmt.alternate)) this.foldBooleanAliasAssignments(stmt.alternate.body, ctx);
                    else this.foldBooleanAliasChildren(stmt.alternate, ctx);
                }
                break;
            case "WhileStatement":
            case "DoWhileStatement":
            case "ForStatement":
            case "ForInStatement":
            case "ForOfStatement":
            case "LabeledStatement":
                if (isBlockStatement(stmt.body)) this.foldBooleanAliasAssignments(stmt.body.body, ctx);
                else this.foldBooleanAliasChildren(stmt.body, ctx);
                break;
            case "TryStatement":
                this.foldBooleanAliasAssignments(stmt.block.body, ctx);
                if (stmt.handler) this.foldBooleanAliasAssignments(stmt.handler.body.body, ctx);
                if (stmt.finalizer) this.foldBooleanAliasAssignments(stmt.finalizer.body, ctx);
                break;
            case "SwitchStatement":
                for (const c of stmt.cases) this.foldBooleanAliasAssignments(c.consequent, ctx);
                break;
            default:
                break;
        }
    }

    /**
     * 折叠 HighLevelGrammarSimplify 之后才暴露的自取反物化链:
     *
     *   X = E; X = !X; X = !X && B ? C : D  ->  X = E && B ? C : D
     *   Y = X; X = !X; Z = X ? A : B        ->  Z = !Y ? A : B
     *
     * 编译器为 `callruntime.isfalse` 生成的取反既可能留在 if test 里,也会在
     * 短路条件被合成为独立赋值后留在语句序列里。前一条赋值给出 X 的旧值 E,
     * 把紧随赋值/return 里唯一一次 X 读取替换成 E(取反位置直接消掉一层),
     * 再删除自取反语句;旧值已死时连同 `X = E` 一起删除。
     */
    private foldNegatedSelfAssignments(stmts: TYPE.Statement[], ctx: FunctionContext): void {
        for (let i = 1; i + 1 < stmts.length; i++) {
            const negStmt = stmts[i];
            if (!isExpressionStatement(negStmt) || !isAssignmentExpression(negStmt.expression)) continue;
            const neg = negStmt.expression;
            if (neg.operator !== "=" || !isIdentifier(neg.left)
                || !isUnaryExpression(neg.right) || neg.right.operator !== "!"
                || !isIdentifier(neg.right.argument) || neg.right.argument.name !== neg.left.name) continue;
            const name = neg.left.name;
            if (!isTempName(name)) continue;
            const info = ctx.infos.get(name);
            if (!info || info.captured) continue;

            // 旧值来源:紧邻的 `X = E`,或 `Y = X` 之后的别名值 Y。
            const prev = stmts[i - 1];
            let sourceValue: TYPE.Expression | null = null;
            let sourceStatement: TYPE.Statement | null = null;
            if (isExpressionStatement(prev) && isAssignmentExpression(prev.expression)) {
                const prevAssign = prev.expression;
                if (prevAssign.operator === "=" && isIdentifier(prevAssign.left)) {
                    if (prevAssign.left.name === name) {
                        if (isDeclarationValue(prevAssign.right)) continue;
                        sourceValue = prevAssign.right;
                        sourceStatement = prev;
                    } else if (isIdentifier(prevAssign.right) && prevAssign.right.name === name) {
                        sourceValue = identifierBuilder(prevAssign.left.name);
                    }
                }
            }
            if (!sourceValue) continue;
            if (collectReadNames(sourceValue).has(name)) continue;

            // 下一条语句消费 X:只允许一次读取,且必须是该表达式最先求值的位置,
            // 这样把旧值搬进来不会越过任何写入/副作用。
            const next = stmts[i + 1];
            let nextRoot: TYPE.Expression | null = null;
            if (isExpressionStatement(next)) {
                const nextExpr = next.expression;
                // 简单赋值语句先求值右值再写左值,左值不是读取;把 X 的读取定位在右值里,
                // 否则 isFirstEvaluatedOccurrence 会把赋值目标当成第一个求值节点。
                nextRoot = isAssignmentExpression(nextExpr) && nextExpr.operator === "=" && isIdentifier(nextExpr.left)
                    ? nextExpr.right
                    : nextExpr;
            } else if (isReturnStatement(next) && next.argument) {
                nextRoot = next.argument;
            }
            if (!nextRoot || this.countReadsInNode(nextRoot, name) !== 1) continue;

            let ref: TYPE.Identifier | null = null;
            let refParent: TYPE.Node | null = null;
            walkNode(nextRoot, (node, parent) => {
                if (isFunctionLike(node) || isClassLike(node)) return false;
                if (isIdentifier(node) && node.name === name && parent && isReferenced(node, parent)) {
                    ref = node;
                    refParent = parent;
                    return false;
                }
                return true;
            });
            if (!ref) continue;
            if (!this.isFirstEvaluatedOccurrence(nextRoot, ref)) {
                // 成员左值赋值(`this.hasStreams = !acc`)的读取在右值里,但
                // firstEvaluatedChild 会先走左值(this -> null)而失败。
                // 旧值是纯表达式时,搬到非首个求值位置不改变副作用顺序,
                // 只要求语句内的写入不命中右值读取的名字(对齐 canDeferTestValue
                // 的纯值分支,按整条语句保守判断)。
                if (!isPureExpression(sourceValue)) continue;
                const assigned = collectAssignedNames(next);
                let collides = false;
                for (const dep of collectIdentifierNames(sourceValue)) {
                    if (assigned.has(dep)) { collides = true; break; }
                }
                if (collides) continue;
            }

            const nextWritesName = isExpressionStatement(next) && isAssignmentExpression(next.expression)
                && next.expression.operator === "=" && isIdentifier(next.expression.left)
                && next.expression.left.name === name;
            if (!nextWritesName) {
                const liveAfter = ctx.liveAfter.get(next);
                if (!liveAfter || liveAfter.has(name)) continue;
            }

            // `!X` 位置直接用旧值 E;裸 X 位置用 !E(negateExpression 会消掉 E 自带的 !)。
            const target: TYPE.Node = refParent && isUnaryExpression(refParent)
                && refParent.operator === "!" && refParent.argument === ref ? refParent : ref;
            const replacement = target === ref ? this.negateExpression(sourceValue) : sourceValue;
            if (nextRoot === target) {
                if (isExpressionStatement(next)) {
                    if (isAssignmentExpression(next.expression) && next.expression.right === nextRoot) {
                        next.expression.right = replacement;
                    } else {
                        next.expression = replacement;
                    }
                } else {
                    (next as TYPE.ReturnStatement).argument = replacement;
                }
            } else if (!replaceNodeInTree(nextRoot, target, replacement)) {
                continue;
            }
            this.removeRefs(ref, ctx);
            this.removeRefs(neg.right, ctx);

            // 旧值在 next 之后已死,且 E 已经搬进 next,可以连同旧赋值一起删除。
            const removeSource = sourceStatement !== null
                && (nextWritesName || !ctx.liveAfter.get(next)?.has(name));
            stmts.splice(i, 1);
            if (removeSource) {
                stmts.splice(i - 1, 1);
                i--;
            }
            this.changed = true;
        }
    }

    /** X = E; (X = !X;)? if (!X / X / 含 X 的复合条件) -> if (E / !E / ...) */
    private cleanupConditionAssignments(stmts: TYPE.Statement[], ctx: FunctionContext): void {
        // 自取反物化链可能位于任意嵌套块里,和下面的 if test 清理一起递归处理。
        if (this.conditionsOnly) this.foldNegatedSelfAssignments(stmts, ctx);
        for (let i = 0; i < stmts.length; i++) {
            const stmt = stmts[i];
            if (isIfStatement(stmt)) {
                const pattern = this.matchConditionPattern(stmts, i, ctx);
                if (pattern) {
                    const { start, expr, testIds } = pattern;
                    const oldTest = stmt.test;
                    // 只移除旧 test 里对 X 的那些读取;test 中其它标识符(E 替换后仍在)
                    // 的引用必须保留,否则后续声明清理会误删它们。
                    for (const testId of testIds) this.removeRefs(testId, ctx);
                    if (i - start > 1) {
                        // 删除整条 `X = !X` 取反链(可能有多条)里的引用
                        for (let j = start + 1; j < i; j++) {
                            const negation = stmts[j];
                            if (isExpressionStatement(negation) && isAssignmentExpression(negation.expression)) {
                                this.removeRefs(negation.expression.right, ctx);
                            }
                        }
                    }
                    let newTest: TYPE.Expression;
                    let replaced = true;
                    if (oldTest === testIds[0]) {
                        newTest = expr;
                    } else {
                        newTest = oldTest;
                        for (const testId of testIds) {
                            if (!replaceNodeInTree(newTest, testId, expr)) {
                                replaced = false;
                                break;
                            }
                        }
                    }
                    if (!replaced) {
                        this.cleanupConditionChildren(stmt, ctx);
                        continue;
                    }
                    stmt.test = newTest;
                    stmts.splice(start, i - start);
                    i = start - 1;
                    this.changed = true;
                    continue;
                }
            }
            this.cleanupConditionChildren(stmt, ctx);
        }
    }

    private cleanupConditionChildren(stmt: TYPE.Statement, ctx: FunctionContext): void {
        switch (stmt.type) {
            case "BlockStatement":
                this.cleanupConditionAssignments(stmt.body, ctx);
                break;
            case "IfStatement":
                // consequent 可能是非块的 if(Region 归约会生成 `if (A) if (B) ...`),
                // 同样需要下钻,否则整条分支里的条件物化都无法折叠。
                if (isBlockStatement(stmt.consequent)) this.cleanupConditionAssignments(stmt.consequent.body, ctx);
                else this.cleanupConditionChildren(stmt.consequent, ctx);
                if (stmt.alternate) {
                    if (isBlockStatement(stmt.alternate)) this.cleanupConditionAssignments(stmt.alternate.body, ctx);
                    else this.cleanupConditionChildren(stmt.alternate, ctx);
                }
                break;
            case "WhileStatement":
            case "DoWhileStatement":
            case "ForStatement":
            case "ForInStatement":
            case "ForOfStatement":
            case "LabeledStatement":
                if (isBlockStatement(stmt.body)) this.cleanupConditionAssignments(stmt.body.body, ctx);
                break;
            case "TryStatement":
                this.cleanupConditionAssignments(stmt.block.body, ctx);
                if (stmt.handler) this.cleanupConditionAssignments(stmt.handler.body.body, ctx);
                if (stmt.finalizer) this.cleanupConditionAssignments(stmt.finalizer.body, ctx);
                break;
            case "SwitchStatement":
                for (const c of stmt.cases) this.cleanupConditionAssignments(c.consequent, ctx);
                break;
            default:
                break;
        }
    }

    private matchConditionPattern(
        stmts: TYPE.Statement[],
        ifIndex: number,
        ctx: FunctionContext,
    ): { start: number; name: string; expr: TYPE.Expression; testIds: TYPE.Identifier[] } | null {
        const ifStmt = stmts[ifIndex];
        if (!isIfStatement(ifStmt)) return null;
        const test = ifStmt.test;
        let name: string;
        let testId: TYPE.Identifier | null = null;
        if (isIdentifier(test)) {
            name = test.name;
            testId = test;
        } else if (isUnaryExpression(test) && test.operator === "!"
            && isIdentifier(test.argument)) {
            name = test.argument.name;
            testId = test.argument;
        } else {
            // 复合 test(`!X && B` / `X || B`):变量名从前一条赋值获取。
            const prev = stmts[ifIndex - 1];
            if (!isExpressionStatement(prev) || !isAssignmentExpression(prev.expression)
                || prev.expression.operator !== "=" || !isIdentifier(prev.expression.left)) {
                return null;
            }
            name = prev.expression.left.name;
            if (this.hasDeferredSelfReference(test, name)) return null;
            if (this.countReadsInNode(test, name) === 0) return null;
        }
        if (!isTempName(name)) return null;
        const info = ctx.infos.get(name);
        if (!info || info.captured) return null;

        // 收集 test 里对 X 的全部读取。多得不只是因为复合条件:编译器会把
        // `A && (f(), A)` 这类"读取同一物化布尔"的条件 lowering 成
        // `acc = E; acc = !acc; if (!acc && (f(), acc))`,test 里有两次读取,
        // 折叠时每一处都要按同一奇偶值替换。
        const testIds: TYPE.Identifier[] = [];
        walkNode(test, (node, parent) => {
            if (isFunctionLike(node) || isClassLike(node)) return false;
            if (isIdentifier(node) && node.name === name && parent && isReferenced(node, parent)) {
                testIds.push(node);
            }
            return true;
        });
        if (testId && !testIds.includes(testId)) testIds.unshift(testId);
        if (testIds.length === 0) return null;

        let start = ifIndex - 1;
        let negations = 0;
        // 编译器把 if 条件里的取反 lowering 成 istrue + 分支 + ldtrue/ldfalse,
        // 反编译后会出现连续多条 `X = !X`(通常是 1~2 条)。按取反次数的奇偶性
        // 决定最终条件,避免把 `!T` 误当成 T 或只折叠一层。
        while (start >= 0) {
            const prev = stmts[start];
            if (!isExpressionStatement(prev) || !isAssignmentExpression(prev.expression)) break;
            const negation = prev.expression;
            if (negation.operator !== "="
                || !isIdentifier(negation.left) || negation.left.name !== name
                || !isUnaryExpression(negation.right) || negation.right.operator !== "!"
                || !isIdentifier(negation.right.argument) || negation.right.argument.name !== name) break;
            negations++;
            start--;
        }
        if (start < 0) return null;
        const assign = stmts[start];
        if (!isExpressionStatement(assign) || !isAssignmentExpression(assign.expression)) return null;
        const expression = assign.expression;
        if (expression.operator !== "=" || !isIdentifier(expression.left) || expression.left.name !== name) {
            return null;
        }
        if (isDeclarationValue(expression.right)) return null;
        // E 读取 X(`X = X.length; if (X > 0)`)是合法的:start..ifIndex 的赋值
        // 会被整体删除,test 里的替换值读到的正是删除前的旧 X,语义不变。

        // X 只能在当前模式里被读取,不能影响模式之后/之前的代码。
        // 但 acc 是字节码累加器,通常在整个函数里反复复用(模式之外还有大量读写),
        // 此时退一步:只要模式之后 X 已死、且 if 分支在写入 X 之前不读取 X,
        // 删除这几条赋值仍然安全。
        const patternRefs = new Set<TYPE.Node>();
        for (let j = start; j < ifIndex; j++) {
            walkNode(stmts[j], (node, parent) => {
                if (isIdentifier(node) && node.name === name && parent && isReferenced(node, parent)) {
                    patternRefs.add(node);
                }
            });
        }
        for (const ref of testIds) patternRefs.add(ref);
        for (const ref of patternRefs) if (!info.refs.has(ref)) return null;
        // 复制传播会克隆节点,ctx.infos 里的 referencePaths 可能已经过期,
        // 不能因为“引用数恰好等于模式内的引用数”就跳过下面的安全检查。
        const liveAfterIf = ctx.liveAfter.get(ifStmt);
        if (!liveAfterIf || liveAfterIf.has(name)) return null;
        // break/continue 可能跳过 if 之后的写入,继续读取 X(例如
        // `v4 = g(); if (v4.completed) break; ... v4 = h();` 循环外的 return v4)。
        // branchLive 已把 break/continue 目标处的活跃变量算进来。
        const branchLive = ctx.branchLive.get(ifStmt);
        if (branchLive && branchLive.has(name)) return null;
        if (this.branchReadsNameBeforeWrite(ifStmt.consequent, name)) return null;
        if (ifStmt.alternate && this.branchReadsNameBeforeWrite(ifStmt.alternate, name)) return null;

        // 取反链的奇偶性直接作用在赋给 X 的值上,test 里每处读取都替换成同一个值
        // (物化后所有读取看到的是同一个 acc 版本)。多次读取只在存在取反链时折叠:
        // 此时物化值被困在 test 里,不整体消费就消不掉 `X = !X`(典型
        // `acc = E; acc = !acc; if (!acc && (f(), acc))`)。negations = 0 的多次
        // 读取(`v2 = E; if (v2 && (..., !v2 ...))`)保持原样——替换会把 E 复制
        // 多遍,输出反而变差。E 有副作用时同样只允许单读取;且 test 序列里不得
        // 再赋值 X——`acc = trim(), acc = acc.length, acc === 0` 的两次读取是
        // 不同版本,不能都替换成模式右值。
        let expr = expression.right;
        if (negations % 2 === 1) expr = this.negateExpression(expr);
        if (testIds.length > 1) {
            if (negations === 0) return null;
            if (!isPureExpression(expression.right)) return null;
            if (collectAssignedNames(test).has(name)) return null;
        }
        // 求值时序:把赋值右值搬进 test 会把它的求值推迟到 test 中 X 的位置。
        // 有副作用的右值只有位于 test 最先求值的位置时才安全(如 test 就是 X/!X);
        // 纯右值也要避免越过 test 里先求值的写入(如 `X = Y; if ((Y = 1, X))`)。
        if (!isPureExpression(expr)) {
            if (testIds.length !== 1 || !this.isFirstEvaluatedOccurrence(test, testIds[0])) return null;
        } else {
            const assigned = collectAssignedNames(test);
            for (const dep of collectIdentifierNames(expr)) {
                if (dep !== name && assigned.has(dep)) return null;
            }
        }

        return { start, name, expr, testIds };
    }

    /** 构造 `!expr`,`!!E` 直接还原成 E。 */
    private negateExpression(expr: TYPE.Expression): TYPE.Expression {
        if (isUnaryExpression(expr) && expr.operator === "!") return expr.argument;
        return unaryExpression("!", expr);
    }

    /**
     * 逆变换编译器对 `A && B` / `A || B` 的“物化 + 跳转”lowering:
     *
     *   X = E; if (X)  { X = B; }  ->  X = E && B
     *   X = E; if (!X) { X = B; }  ->  X = E || B
     *
     * 结构化归约会把 if 的 test 重新生成成原表达式(X = E; if (E) {...}),
     * E 为纯表达式时同样处理(test 改读 X 再折叠,避免同一表达式求值两次)。
     * 连续的 `if (X) { X = B; }` 通过定点迭代逐轮合并成一条逻辑运算链,
     * 最后由 foldReturnAssignments 折进 return。
     *
     * 等价性:if (X) { X = B } 中 X 为真才求值 B、否则 X 保持原值,
     * 与 `X = E && B` 的短路语义完全一致(X 为假时整个表达式取 X 的旧值);
     * `!X` 对应 `E || B` 同理。条件:
     *   - X 是未被闭包捕获的临时变量,赋值语句与 if 紧邻(中间不能有其它语句);
     *   - if 没有 else,分支体只有一条 `X = B`;
     *   - B 不是函数/类表达式(保护 hoistNamedFunctionExpressions 的提升机会),
     *     且 B 里没有延迟读取 X 的闭包(B 求值期间 X 的新旧值时序在两种写法中不同)。
     */
    private foldShortCircuitChains(stmts: TYPE.Statement[], ctx: FunctionContext): void {
        for (let i = 0; i < stmts.length; i++) {
            const folded = this.matchShortCircuitFold(stmts, i, ctx);
            if (folded) {
                const assignStmt = stmts[i] as TYPE.ExpressionStatement;
                (assignStmt.expression as TYPE.AssignmentExpression).right = folded.value;
                this.removeRefs(folded.removedTest, ctx);
                stmts.splice(i + 1, 1);
                this.changed = true;
                // 新赋值可能继续与后面的 if 成链,原地重试
                i--;
                continue;
            }
            this.foldShortCircuitChildren(stmts[i], ctx);
        }
    }

    /**
     * `X = A; X = B`(两者各只读取一次 X、A 为纯表达式):
     *   X = X.length; X = p0.path.substring(X)  ->  X = p0.path.substring(X.length)
     *
     * A 的右值读取旧 X 并写回 X,复制传播为了安全不会缓存这类自引用表达式;
     * 但 A 的结果只可能被紧随其后的 B 消费一次,因此可以整体搬进 B 的读取位置。
     * 常用于 `v0 = v0.length; v0 = p0.path.substring(v0)` 这类先取长度再切片的链。
     */
    private foldSelfReadChains(stmts: TYPE.Statement[], ctx: FunctionContext): void {
        for (let i = 0; i < stmts.length; i++) {
            if (i + 1 < stmts.length && this.tryFoldSelfReadChain(stmts, i, ctx)) {
                // 合并后的语句仍可能继续与下一条组成链,原地重试
                i--;
                continue;
            }
            // 最后一条语句同样要下钻,否则函数体/分支末尾的 if 里的链不会被处理
            this.foldSelfReadChainChildren(stmts[i], ctx);
        }
    }

    /** 尝试折叠 stmts[i] / stmts[i + 1],成功时修改列表并返回 true。 */
    private tryFoldSelfReadChain(stmts: TYPE.Statement[], i: number, ctx: FunctionContext): boolean {
        const first = stmts[i];
        const second = stmts[i + 1];
        if (!isExpressionStatement(first) || !isAssignmentExpression(first.expression)) return false;
        if (!isExpressionStatement(second) || !isAssignmentExpression(second.expression)) return false;
        const a = first.expression;
        const b = second.expression;
        if (a.operator !== "=" || b.operator !== "=") return false;
        if (!isIdentifier(a.left) || !isIdentifier(b.left)) return false;
        const name = a.left.name;
        if (b.left.name !== name || !isTempName(name)) return false;
        const info = ctx.infos.get(name);
        if (!info || info.captured) return false;
        // A 必须只读取一次旧 X 且无副作用;B 必须只消费一次新 X,
        // 并且在 B 内部没有再写入 X(避免 sequence 里混入 X = ...)。
        // 只处理成员装载(X = X.prop / X.length):其它自引用形态
        // (X = X + 1、X = !X)分别由 foldCompoundAssignments / 条件折叠负责。
        if (!isMemberExpression(a.right) && !isOptionalMemberExpression(a.right)) return false;
        if (this.countReadsInNode(a.right, name) !== 1) return false;
        if (this.countReadsInNode(b.right, name) !== 1) return false;
        if (!isPureExpression(a.right)) return false;
        const assignedInB = collectAssignedNames(b.right);
        if (assignedInB.has(name)) return false;
        // A 里依赖的名字不能在 B 中被重新赋值,否则搬进 B 后读到的是新值
        for (const dep of collectIdentifierNames(a.right)) {
            if (dep !== name && assignedInB.has(dep)) return false;
        }
        let id: TYPE.Identifier | null = null;
        walkNode(b.right, (node, parent) => {
            if (isFunctionLike(node) || isClassLike(node)) return false;
            if (isIdentifier(node) && node.name === name && parent && isReferenced(node, parent)) {
                id = node;
                return false;
            }
            return true;
        });
        if (!id) return false;
        const clone = cloneNode(a.right, true) as TYPE.Expression;
        if (!replaceNodeInTree(b.right, id, clone)) return false;
        info.refs.delete(id);
        this.removeRefs(a.right, ctx);
        this.registerCloneRefs(clone, ctx);
        stmts.splice(i, 1);
        this.changed = true;
        return true;
    }

    private foldSelfReadChainChildren(stmt: TYPE.Statement, ctx: FunctionContext): void {
        switch (stmt.type) {
            case "BlockStatement":
                this.foldSelfReadChains(stmt.body, ctx);
                break;
            case "IfStatement":
                if (isBlockStatement(stmt.consequent)) this.foldSelfReadChains(stmt.consequent.body, ctx);
                else this.foldSelfReadChainChildren(stmt.consequent, ctx);
                if (stmt.alternate) {
                    if (isBlockStatement(stmt.alternate)) this.foldSelfReadChains(stmt.alternate.body, ctx);
                    else this.foldSelfReadChainChildren(stmt.alternate, ctx);
                }
                break;
            case "WhileStatement":
            case "DoWhileStatement":
            case "ForStatement":
            case "ForInStatement":
            case "ForOfStatement":
            case "LabeledStatement":
                if (isBlockStatement(stmt.body)) this.foldSelfReadChains(stmt.body.body, ctx);
                else this.foldSelfReadChainChildren(stmt.body, ctx);
                break;
            case "TryStatement":
                this.foldSelfReadChains(stmt.block.body, ctx);
                if (stmt.handler) this.foldSelfReadChains(stmt.handler.body.body, ctx);
                if (stmt.finalizer) this.foldSelfReadChains(stmt.finalizer.body, ctx);
                break;
            case "SwitchStatement":
                for (const c of stmt.cases) this.foldSelfReadChains(c.consequent, ctx);
                break;
            default:
                break;
        }
    }

    private foldShortCircuitChildren(stmt: TYPE.Statement, ctx: FunctionContext): void {
        switch (stmt.type) {
            case "BlockStatement":
                this.foldShortCircuitChains(stmt.body, ctx);
                break;
            case "IfStatement":
                if (isBlockStatement(stmt.consequent)) this.foldShortCircuitChains(stmt.consequent.body, ctx);
                else this.foldShortCircuitChildren(stmt.consequent, ctx);
                if (stmt.alternate) {
                    if (isBlockStatement(stmt.alternate)) this.foldShortCircuitChains(stmt.alternate.body, ctx);
                    else this.foldShortCircuitChildren(stmt.alternate, ctx);
                }
                break;
            case "WhileStatement":
            case "DoWhileStatement":
            case "ForStatement":
            case "ForInStatement":
            case "ForOfStatement":
            case "LabeledStatement":
                if (isBlockStatement(stmt.body)) this.foldShortCircuitChains(stmt.body.body, ctx);
                else this.foldShortCircuitChildren(stmt.body, ctx);
                break;
            case "TryStatement":
                this.foldShortCircuitChains(stmt.block.body, ctx);
                if (stmt.handler) this.foldShortCircuitChains(stmt.handler.body.body, ctx);
                if (stmt.finalizer) this.foldShortCircuitChains(stmt.finalizer.body, ctx);
                break;
            case "SwitchStatement":
                for (const c of stmt.cases) this.foldShortCircuitChains(c.consequent, ctx);
                break;
            default:
                break;
        }
    }

    /**
     * 匹配 stmts[i] = `X = E` 且 stmts[i + 1] = 可折叠 if 的模式。
     * 返回合并后的右值以及需要从引用集合里移除的旧 test 节点。
     */
    private matchShortCircuitFold(
        stmts: TYPE.Statement[],
        i: number,
        ctx: FunctionContext,
    ): { value: TYPE.Expression; removedTest: TYPE.Expression } | null {
        if (i + 1 >= stmts.length) return null;
        const assignStmt = stmts[i];
        if (!isExpressionStatement(assignStmt) || !isAssignmentExpression(assignStmt.expression)) return null;
        const assign = assignStmt.expression;
        if (assign.operator !== "=" || !isIdentifier(assign.left)) return null;
        const name = assign.left.name;
        if (!isTempName(name)) return null;
        const info = ctx.infos.get(name);
        if (!info || info.captured) return null;
        // X = !X 是条件物化(isfalse / 布尔 if-else 合成)的自取反链片段,
        // 整条链的奇偶性归流水线尾部的 foldConditionAssignments 处理——
        // 那里能看到 HighLevelGrammarSimplify 合成后的完整链,把
        // `X = has(); X = !X; if (!X) { X = set(...) }` 折成 if (!has())。
        // 若在这里以自取反为链头抢先折叠成 `X = !X || set(...)`,
        // 会让尾部折叠失去链头,输出反而退化。函数/类表达式保持语句形态,
        // 留给 hoistNamedFunctionExpressions 提升。
        if (isUnaryExpression(assign.right) && assign.right.operator === "!"
            && isIdentifier(assign.right.argument) && assign.right.argument.name === name) return null;
        if (isDeclarationValue(assign.right)) return null;

        const ifStmt = stmts[i + 1];
        if (!isIfStatement(ifStmt) || ifStmt.alternate) return null;

        // 分支体必须是唯一一条 `X = B`
        let body: TYPE.Statement[];
        if (isBlockStatement(ifStmt.consequent)) {
            if (ifStmt.consequent.body.length !== 1) return null;
            body = ifStmt.consequent.body;
        } else {
            body = [ifStmt.consequent];
        }
        const only = body[0];
        if (!isExpressionStatement(only) || !isAssignmentExpression(only.expression)) return null;
        const inner = only.expression;
        if (inner.operator !== "=" || !isIdentifier(inner.left) || inner.left.name !== name) return null;
        if (isDeclarationValue(inner.right)) return null;
        if (this.hasDeferredSelfReference(inner.right, name)) return null;

        const test = ifStmt.test;
        if (isIdentifier(test) && test.name === name) {
            return { value: logicalExpression("&&", assign.right, inner.right), removedTest: test };
        }
        if (isUnaryExpression(test) && test.operator === "!"
            && isIdentifier(test.argument) && test.argument.name === name) {
            return { value: logicalExpression("||", assign.right, inner.right), removedTest: test };
        }
        // 跨变量布尔物化:`X = E; Y = E; if (X/!X) { Y = B }` -> `Y = E &&/|| B`。
        // 编译器会把短路条件的左值物化到两个临时变量(一个用于跳转、一个存最终结果),
        // 形如 `acc = A; v1 = A; if (acc) { v1 = B }`。E 为纯表达式时两次求值等价,
        // 可合并成 `Y = E && B`;跳转变量 X 在 if 之后必须已死(X = E 的死存储
        // 由下一轮死存储清除删除)。
        const crossVar = (holder: string, negated: boolean): { value: TYPE.Expression; removedTest: TYPE.Expression } | null => {
            if (i < 1) return null;
            const prevStmt = stmts[i - 1];
            if (!isExpressionStatement(prevStmt) || !isAssignmentExpression(prevStmt.expression)) return null;
            const holderAssign = prevStmt.expression;
            if (holderAssign.operator !== "="
                || !isIdentifier(holderAssign.left) || holderAssign.left.name !== holder
                || !isNodeEqual(holderAssign.right, assign.right) || !isPureExpression(assign.right)) return null;
            const liveAfterIf = ctx.liveAfter.get(ifStmt);
            if (liveAfterIf && liveAfterIf.has(holder)) return null;
            return {
                value: logicalExpression(negated ? "||" : "&&", assign.right, inner.right),
                removedTest: test,
            };
        };
        if (isIdentifier(test) && test.name !== name && isTempName(test.name)) {
            const folded = crossVar(test.name, false);
            if (folded) return folded;
        }
        if (isUnaryExpression(test) && test.operator === "!"
            && isIdentifier(test.argument) && test.argument.name !== name && isTempName(test.argument.name)) {
            const folded = crossVar(test.argument.name, true);
            if (folded) return folded;
        }
        // test 是结构化归约重新物化的同一表达式:X = E; if (E) { X = B } / if (!E) {...}
        // 只有 E 纯(重复求值无副作用)才能把两次求值合并成一次。
        const testNegated = isUnaryExpression(test) && test.operator === "!";
        const testValue = testNegated ? (test as TYPE.UnaryExpression).argument : test;
        if (testValue && isNodeEqual(testValue, assign.right) && isPureExpression(assign.right)) {
            return {
                value: logicalExpression(testNegated ? "||" : "&&", assign.right, inner.right),
                removedTest: test,
            };
        }
        return null;
    }

    /**
     * 折叠 boolean 上下文 test 序列里的自取反链:
     *   if (A || (X = E, X = !X, !X)) -> if (A || E)          // X 在 test 后已死
     *   if (X = E, E)                  -> if (E)              // X 在 test 后已死
     * 只处理 if(不处理循环 test,循环每次迭代都会重新求值),且要求 X 在 test 之后
     * 不再被读取、短路分支也不会先读后写,避免改变 X 的最终值。
     */
    private foldTestSequences(stmts: TYPE.Statement[], ctx: FunctionContext): void {
        for (const stmt of stmts) this.foldTestSequencesInStatement(stmt, ctx);
    }

    private foldTestSequencesInStatement(stmt: TYPE.Statement, ctx: FunctionContext): void {
        switch (stmt.type) {
            case "IfStatement":
                stmt.test = this.foldBooleanExpr(stmt.test, stmt, ctx);
                this.foldTestSequencesInStatement(stmt.consequent, ctx);
                if (stmt.alternate) this.foldTestSequencesInStatement(stmt.alternate, ctx);
                return;
            case "BlockStatement":
                this.foldTestSequences(stmt.body, ctx);
                return;
            case "WhileStatement":
            case "DoWhileStatement":
            case "ForStatement":
                // 循环 test 每轮都会重新求值,不做跨语句的取反链折叠
                if (stmt.body) this.foldTestSequencesInStatement(stmt.body, ctx);
                return;
            case "TryStatement":
                this.foldTestSequences(stmt.block.body, ctx);
                if (stmt.handler) this.foldTestSequences(stmt.handler.body.body, ctx);
                if (stmt.finalizer) this.foldTestSequences(stmt.finalizer.body, ctx);
                return;
            case "SwitchStatement":
                for (const c of stmt.cases) this.foldTestSequences(c.consequent, ctx);
                return;
            case "LabeledStatement":
                this.foldTestSequencesInStatement(stmt.body, ctx);
                return;
            default:
                return;
        }
    }

    private foldBooleanExpr(expr: TYPE.Expression, stmt: TYPE.IfStatement, ctx: FunctionContext): TYPE.Expression {
        if (isLogicalExpression(expr)) {
            expr.left = this.foldBooleanExpr(expr.left, stmt, ctx);
            expr.right = this.foldBooleanExpr(expr.right, stmt, ctx);
            return expr;
        }
        if (isUnaryExpression(expr) && expr.operator === "!") {
            expr.argument = this.foldBooleanExpr(expr.argument as TYPE.Expression, stmt, ctx);
            return expr;
        }
        if (isSequenceExpression(expr)) {
            const folded = this.foldTestSequence(expr, stmt, ctx);
            if (folded) return folded;
            const last = expr.expressions.length - 1;
            if (last >= 0) expr.expressions[last] = this.foldBooleanExpr(expr.expressions[last] as TYPE.Expression, stmt, ctx);
            return expr;
        }
        return expr;
    }

    private foldTestSequence(
        seq: TYPE.SequenceExpression,
        stmt: TYPE.IfStatement,
        ctx: FunctionContext,
    ): TYPE.Expression | null {
        const exprs = seq.expressions;
        if (exprs.length < 2) return null;
        const last = exprs[exprs.length - 1];
        let name: string | null = null;
        let lastBang = false;
        if (isIdentifier(last)) {
            name = last.name;
        } else if (isUnaryExpression(last) && last.operator === "!"
            && isIdentifier(last.argument)) {
            name = last.argument.name;
            lastBang = true;
        }
        if (name !== null && isTempName(name)) {
            // (X = E, X = !X, ..., X/!X)
            let neg = 0;
            let j = exprs.length - 2;
            while (j >= 0) {
                const e = exprs[j];
                if (isAssignmentExpression(e) && e.operator === "="
                    && isIdentifier(e.left) && e.left.name === name
                    && isUnaryExpression(e.right) && e.right.operator === "!"
                    && isIdentifier(e.right.argument) && e.right.argument.name === name) {
                    neg++;
                    j--;
                    continue;
                }
                break;
            }
            const base = j >= 0 ? exprs[j] : null;
            if (base && isAssignmentExpression(base) && base.operator === "="
                && isIdentifier(base.left) && base.left.name === name
                && !this.headReadsNameBeforeWrite(exprs, j, name)
                && this.isNameDeadAfterTest(stmt, name, ctx)
                && this.isTailExpression(stmt.test, seq)) {
                const parity = (neg + (lastBang ? 1 : 0)) % 2;
                const replacement = parity === 0 ? base.right : unaryExpression("!", base.right);
                const kept = exprs.slice(0, j) as TYPE.Expression[];
                kept.push(replacement);
                return kept.length === 1 ? kept[0] : sequenceExpression(kept);
            }
        }
        // (X = E, <last>) 且 E 无副作用、last 不读取 X、X 在 test 后已死:直接丢掉 X = E
        const base = exprs[exprs.length - 2];
        if (isAssignmentExpression(base) && base.operator === "="
            && isIdentifier(base.left) && isTempName(base.left.name)
            && isPureExpression(base.right)
            && !this.headReadsNameBeforeWrite(exprs, exprs.length - 2, base.left.name)
            && this.countReadsInNode(last, base.left.name) === 0
            && this.isNameDeadAfterTest(stmt, base.left.name, ctx)
            && this.isTailExpression(stmt.test, seq)) {
            const kept = exprs.slice(0, exprs.length - 2) as TYPE.Expression[];
            kept.push(last);
            return kept.length === 1 ? kept[0] : sequenceExpression(kept);
        }
        return null;
    }

    /** 序列前缀是否可能在写入 name 之前读取它(循环里会把上一轮的值带进来)。 */
    private headReadsNameBeforeWrite(exprs: TYPE.Expression[], end: number, name: string): boolean {
        let killed = false;
        for (let i = 0; i < end; i++) {
            const e = exprs[i];
            if (isAssignmentExpression(e) && e.operator === "="
                && isIdentifier(e.left) && e.left.name === name) {
                if (!killed && this.countReadsInNode(e.right, name) > 0) return true;
                killed = true;
                continue;
            }
            if (!killed && this.countReadsInNode(e, name) > 0) return true;
        }
        return false;
    }

    /**
     * target 是否是 root 中最后求值的子表达式(之后没有会读取变量的兄弟表达式)。
     * 用于判断序列里的死赋能否删除:只关心“赋值之后是否还有读取”,之前(短路左侧)
     * 的读取不受影响。
     */
    private isTailExpression(root: TYPE.Expression, target: TYPE.Expression): boolean {
        if (root === target) return true;
        if (isParenthesizedExpression(root)) return this.isTailExpression(root.expression as TYPE.Expression, target);
        if (isLogicalExpression(root)) {
            return this.containsNode(root.right, target) && this.isTailExpression(root.right as TYPE.Expression, target);
        }
        if (isSequenceExpression(root)) {
            const last = root.expressions[root.expressions.length - 1];
            return !!last && this.containsNode(last, target) && this.isTailExpression(last as TYPE.Expression, target);
        }
        if (isUnaryExpression(root)) {
            return this.containsNode(root.argument, target) && this.isTailExpression(root.argument as TYPE.Expression, target);
        }
        if (isBinaryExpression(root)) {
            return this.containsNode(root.right, target) && this.isTailExpression(root.right as TYPE.Expression, target);
        }
        if (isConditionalExpression(root)) {
            return this.containsNode(root.alternate, target) && this.isTailExpression(root.alternate as TYPE.Expression, target);
        }
        return false;
    }

    /** X 在该 test 之后(含分支体)是否已经不再被读取。 */
    private isNameDeadAfterTest(stmt: TYPE.Statement, name: string, ctx: FunctionContext): boolean {
        if (!isIfStatement(stmt)) return false;
        const liveAfter = ctx.liveAfter.get(stmt);
        if (!liveAfter || liveAfter.has(name)) return false;
        if (this.branchReadsNameBeforeWrite(stmt.consequent, name)) return false;
        if (this.branchReadsNameBeforeWrite(stmt.alternate, name)) return false;
        return true;
    }

    /**
     * 循环 test 里的临时变量清理。
     *
     * 结构化归约会把循环条件生成为一整个 SequenceExpression,例如:
     *   do { ... } while ((acc = JSON.stringify(v), acc = decode(acc), v = acc,
     *                      acc = !(acc !== undefined), v8 = false, v === undefined) || ...)
     * 其中 `acc = !(...)`、寄存器恢复(`v8 = false`)都是死保存,`acc = f(v); v = acc`
     * 也能合并。它们不在任何语句列表里,cleanupStatements/cleanupSequenceExpressions
     * 都扫不到,所以在这里按 test 自己的求值顺序做一轮活跃性分析。
     *
     * 循环 test 每轮重新求值,因此“test 之后”的活跃集是 body 入口(bodyIn)∪ 循环之后
     * (liveAfter),不能只用一个;缺失 bodyIn 时保守放弃。
     */
    private foldLoopTestTemps(stmts: TYPE.Statement[], ctx: FunctionContext): void {
        for (const stmt of stmts) this.foldLoopTestTempsInStatement(stmt, ctx);
    }

    private foldLoopTestTempsInStatement(stmt: TYPE.Statement, ctx: FunctionContext): void {
        switch (stmt.type) {
            case "WhileStatement":
            case "DoWhileStatement":
            case "ForStatement": {
                const loop = stmt as TYPE.WhileStatement | TYPE.DoWhileStatement | TYPE.ForStatement;
                if (loop.test) {
                    const bodyIn = ctx.loopBodyIn.get(stmt);
                    if (bodyIn) {
                        const liveOut = new Set<string>(ctx.liveAfter.get(stmt) || []);
                        for (const name of bodyIn) liveOut.add(name);
                        const next = this.simplifyTestExpression(loop.test, liveOut, ctx);
                        if (next !== loop.test) {
                            loop.test = next;
                            this.changed = true;
                        }
                    }
                }
                this.foldLoopTestTempsInStatement(loop.body, ctx);
                return;
            }
            case "BlockStatement":
                this.foldLoopTestTemps(stmt.body, ctx);
                return;
            case "IfStatement":
                this.foldLoopTestTempsInStatement(stmt.consequent, ctx);
                if (stmt.alternate) this.foldLoopTestTempsInStatement(stmt.alternate, ctx);
                return;
            case "ForInStatement":
            case "ForOfStatement":
            case "LabeledStatement":
                this.foldLoopTestTempsInStatement(stmt.body, ctx);
                return;
            case "TryStatement":
                this.foldLoopTestTemps(stmt.block.body, ctx);
                if (stmt.handler) this.foldLoopTestTemps(stmt.handler.body.body, ctx);
                if (stmt.finalizer) this.foldLoopTestTemps(stmt.finalizer.body, ctx);
                return;
            case "SwitchStatement":
                for (const c of stmt.cases) this.foldLoopTestTemps(c.consequent, ctx);
                return;
            default:
                return;
        }
    }

    /** 按表达式求值顺序清理 test;返回替换后的表达式(sequence 只剩一个元素时会解开)。 */
    private simplifyTestExpression(
        expr: TYPE.Expression,
        liveOut: Set<string>,
        ctx: FunctionContext,
    ): TYPE.Expression {
        if (isSequenceExpression(expr)) {
            this.simplifyTestSequence(expr, liveOut, ctx);
            return expr.expressions.length === 1
                ? expr.expressions[0] as TYPE.Expression
                : expr;
        }
        if (isLogicalExpression(expr)) {
            expr.right = this.simplifyTestExpression(expr.right as TYPE.Expression, liveOut, ctx);
            const rightIn = this.testLiveIn(expr.right as TYPE.Expression, liveOut, ctx);
            expr.left = this.simplifyTestExpression(
                expr.left as TYPE.Expression, TempVariableSimplify.union(liveOut, rightIn), ctx);
            return expr;
        }
        if (isUnaryExpression(expr) && expr.operator === "!") {
            expr.argument = this.simplifyTestExpression(expr.argument as TYPE.Expression, liveOut, ctx);
            return expr;
        }
        if (isParenthesizedExpression(expr)) {
            (expr as any).expression = this.simplifyTestExpression(
                (expr as any).expression as TYPE.Expression, liveOut, ctx);
            return expr;
        }
        return expr;
    }

    /**
     * test 表达式之前的活跃集(纯分析,不改 AST)。
     * 与 simplifyTestExpression 保持同一套规则:死赋值若会被整体删除,右值读取不再发生。
     */
    private testLiveIn(expr: TYPE.Expression, liveOut: Set<string>, ctx: FunctionContext): Set<string> {
        if (isSequenceExpression(expr)) {
            let live = liveOut;
            for (let i = expr.expressions.length - 1; i >= 0; i--) {
                live = this.testLiveIn(expr.expressions[i] as TYPE.Expression, live, ctx);
            }
            return live;
        }
        if (isLogicalExpression(expr)) {
            const rightIn = this.testLiveIn(expr.right as TYPE.Expression, liveOut, ctx);
            return this.testLiveIn(
                expr.left as TYPE.Expression, TempVariableSimplify.union(liveOut, rightIn), ctx);
        }
        if (isUnaryExpression(expr) && expr.operator === "!") {
            return this.testLiveIn(expr.argument as TYPE.Expression, liveOut, ctx);
        }
        if (isParenthesizedExpression(expr)) {
            return this.testLiveIn((expr as any).expression as TYPE.Expression, liveOut, ctx);
        }
        if (isAssignmentExpression(expr) && expr.operator === "=" && isIdentifier(expr.left)
            && isTempName(expr.left.name)) {
            const name = expr.left.name;
            if (liveOut.has(name)) {
                const result = this.tempReads(expr.right, ctx);
                for (const existing of liveOut) if (existing !== name) result.add(existing);
                return result;
            }
            const info = ctx.infos.get(name);
            if (this.isRemovableDeadTestAssignment(expr.right, name, info)) return new Set(liveOut);
            const result = this.tempReads(expr.right, ctx);
            for (const existing of liveOut) result.add(existing);
            return result;
        }
        const result = this.tempReads(expr, ctx);
        const writes = this.tempWrites(expr, ctx);
        for (const existing of liveOut) if (!writes.has(existing)) result.add(existing);
        return result;
    }

    /** 死赋值能否整体删除(右值无副作用且不是需要保留的函数/类表达式)。 */
    private isRemovableDeadTestAssignment(rhs: TYPE.Expression, name: string, info?: BindingInfo): boolean {
        if (!info || info.captured) return false;
        if (isIdentifier(rhs) && rhs.name === name) return true;
        return !isDeclarationValue(rhs) && isPureExpression(rhs);
    }

    /** 删除 test 序列里的死赋值;返回替代表达式、null(删除)或原节点(保持)。 */
    private cleanupDeadTestAssignment(
        expr: TYPE.Expression,
        live: Set<string>,
        ctx: FunctionContext,
    ): TYPE.Expression | null {
        if (!isAssignmentExpression(expr) || expr.operator !== "=" || !isIdentifier(expr.left)) return expr;
        const name = expr.left.name;
        if (!isTempName(name) || live.has(name)) return expr;
        const info = ctx.infos.get(name);
        if (!info || info.captured) return expr;
        const rhs = expr.right;
        if (isIdentifier(rhs) && rhs.name === name) {
            this.removeRefs(rhs, ctx);
            this.changed = true;
            return null;
        }
        if (isDeclarationValue(rhs)) return rhs;
        if (isPureExpression(rhs)) {
            this.removeRefs(rhs, ctx);
            this.changed = true;
            return null;
        }
        // 有副作用:保留表达式本身(不保留对 name 的写入)
        this.changed = true;
        return rhs;
    }

    /** 清理一个循环 test 里的 SequenceExpression,并把它折叠成更短的形式。 */
    private simplifyTestSequence(seq: TYPE.SequenceExpression, liveOut: Set<string>, ctx: FunctionContext): void {
        if (seq.expressions.length === 0) return;
        // 1. 从右往左删除死赋值,使用“本元素之后仍活跃”的集合。
        let live = new Set(liveOut);
        for (let i = seq.expressions.length - 1; i >= 0; i--) {
            const expr = seq.expressions[i] as TYPE.Expression;
            const replaced = this.cleanupDeadTestAssignment(expr, live, ctx);
            if (replaced === expr) {
                live = this.testLiveIn(expr, live, ctx);
            } else if (replaced === null) {
                seq.expressions.splice(i, 1);
            } else {
                seq.expressions[i] = replaced;
                live = this.testLiveIn(replaced, live, ctx);
            }
        }
        // 2. 折叠 `X = E; X = F(X)` / `X = E; Y = X`。每折一次重新算一遍
        //    “本元素之后活跃”的集合,下标才对得上。
        let guard = 0;
        while (guard++ < 64) {
            const after = this.testLiveAfter(seq.expressions as TYPE.Expression[], liveOut, ctx);
            let folded = false;
            for (let i = 0; i + 1 < seq.expressions.length; i++) {
                const elements = seq.expressions as TYPE.Expression[];
                if (this.tryFoldTestAccumulator(elements, i, ctx)
                    || this.tryFoldTestAlias(elements, i, after[i + 1], ctx)) {
                    seq.expressions.splice(i, 1);
                    this.changed = true;
                    folded = true;
                    break;
                }
            }
            if (!folded) break;
        }
    }

    private testLiveAfter(
        elements: TYPE.Expression[],
        liveOut: Set<string>,
        ctx: FunctionContext,
    ): Set<string>[] {
        const after: Set<string>[] = new Array(elements.length);
        let live = new Set(liveOut);
        for (let i = elements.length - 1; i >= 0; i--) {
            after[i] = new Set(live);
            live = this.testLiveIn(elements[i], live, ctx);
        }
        return after;
    }

    /** `X = E; X = F(X)` -> `X = F(E)`,要求 X 在 F 中只读一次。 */
    private tryFoldTestAccumulator(elements: TYPE.Expression[], i: number, ctx: FunctionContext): boolean {
        const a = elements[i];
        const b = elements[i + 1];
        if (!isAssignmentExpression(a) || !isAssignmentExpression(b)) return false;
        if (a.operator !== "=" || b.operator !== "=") return false;
        if (!isIdentifier(a.left) || !isIdentifier(b.left)) return false;
        const name = a.left.name;
        if (b.left.name !== name || !isTempName(name)) return false;
        const info = ctx.infos.get(name);
        if (!info || info.captured) return false;
        if (this.countReadsInNode(b.right, name) !== 1) return false;
        if (collectAssignedNames(b.right).has(name)) return false;
        if (this.hasDeferredSelfReference(a.right, name) || this.hasDeferredSelfReference(b.right, name)) return false;

        let id: TYPE.Identifier | null = null;
        walkNode(b.right, (node, parent) => {
            if (isFunctionLike(node) || isClassLike(node)) return false;
            if (isIdentifier(node) && node.name === name && parent && isReferenced(node, parent)) {
                id = node;
                return false;
            }
            return true;
        });
        if (!id) return false;
        const value = a.right;
        if (!this.canDeferTestValue(value, b.right, id)) return false;
        // b 里对 value 依赖名字的写入会改变 value 的读取结果
        const assigned = collectAssignedNames(b.right);
        for (const dep of collectIdentifierNames(value)) {
            if (dep !== name && assigned.has(dep)) return false;
        }
        if (!replaceNodeInTree(b.right, id, value)) return false;
        info.refs.delete(id);
        return true;
    }

    /** `X = E; Y = X` -> `Y = E`(X 在第二条之后已死)。 */
    private tryFoldTestAlias(
        elements: TYPE.Expression[],
        i: number,
        liveAfterSecond: Set<string>,
        ctx: FunctionContext,
    ): boolean {
        const a = elements[i];
        const b = elements[i + 1];
        if (!isAssignmentExpression(a) || !isAssignmentExpression(b)) return false;
        if (a.operator !== "=" || b.operator !== "=") return false;
        if (!isIdentifier(a.left) || !isIdentifier(b.left)) return false;
        const name = a.left.name;
        if (!isTempName(name) || !isIdentifier(b.right) || b.right.name !== name) return false;
        const info = ctx.infos.get(name);
        if (!info || info.captured) return false;
        // 旧值在第二条赋值之后已死,删除第一条不会改变后续读取
        if (liveAfterSecond.has(name)) return false;
        if (this.hasDeferredSelfReference(a.right, name)) return false;
        info.refs.delete(b.right);
        b.right = a.right;
        return true;
    }

    /**
     * 把 value 的求值推迟到 target 中 id 的位置是否安全。
     * value 纯时只要求 target 里更早的写入不影响它的读取;有副作用时只允许
     * 推后到“先求值的部分无副作用”的位置(典型是调用表达式的参数,callee 为标识符)。
     */
    private canDeferTestValue(value: TYPE.Expression, target: TYPE.Expression, id: TYPE.Identifier): boolean {
        if (isPureExpression(value)) {
            const assigned = collectAssignedNames(target);
            for (const dep of collectIdentifierNames(value)) {
                if (assigned.has(dep)) return false;
            }
            return true;
        }
        if (this.isFirstEvaluatedOccurrence(target, id)) return true;
        if (isCallExpression(target) && !this.containsNode(target.callee, id)
            && isPureExpression(target.callee)) {
            const assigned = collectAssignedNames(value);
            for (const dep of collectIdentifierNames(target.callee)) {
                if (assigned.has(dep)) return false;
            }
            return true;
        }
        return false;
    }

    /** 清理 SequenceExpression 中的死赋值,例如 if 条件里的 (v0 = x, v1 = y, ...)。 */
    private cleanupSequenceExpressions(stmts: TYPE.Statement[], ctx: FunctionContext): void {
        for (const stmt of stmts) {
            // 整条语句的读取集合只算一次,避免多个 SequenceExpression 造成重复扫描
            const stmtLive = new Set<string>(ctx.liveAfter.get(stmt) || []);
            for (const name of this.tempReads(stmt, ctx)) stmtLive.add(name);
            walkNode(stmt, (node) => {
                if (isFunctionLike(node) || isClassLike(node)) return false;
                if (!isSequenceExpression(node)) return true;

                const live = new Set(stmtLive);

                const kept: TYPE.Expression[] = [];
                for (let i = node.expressions.length - 1; i >= 0; i--) {
                    const expr = node.expressions[i];
                    const reads = this.tempReads(expr, ctx);
                    if (isAssignmentExpression(expr) && expr.operator === "="
                        && isIdentifier(expr.left) && isTempName(expr.left.name)) {
                        const name = expr.left.name;
                        const info = ctx.infos.get(name);
                        if (info && !info.captured && !live.has(name) && !reads.has(name)) {
                            const rhs = expr.right;
                            if (ctx.moved.has(rhs)) {
                                // 中间副本直接删除;只有最终落点也是死代码时,有副作用的部分才需保留
                                const isFinalDestination = ctx.moved.get(rhs) === stmt;
                                if (isFinalDestination && !isPureExpression(rhs) && !isDeclarationValue(rhs)) {
                                    kept.unshift(rhs);
                                    for (const read of reads) live.add(read);
                                }
                            } else if (isDeclarationValue(rhs)) {
                                kept.unshift(rhs);
                                for (const read of reads) live.add(read);
                            } else if (isPureExpression(rhs)) {
                                this.removeRefs(rhs, ctx);
                            } else {
                                kept.unshift(rhs);
                                for (const read of reads) live.add(read);
                            }
                            this.changed = true;
                            continue;
                        }
                        live.delete(name);
                        for (const read of reads) live.add(read);
                        kept.unshift(expr);
                    } else {
                        for (const read of reads) live.add(read);
                        kept.unshift(expr);
                    }
                }
                if (kept.length !== node.expressions.length) node.expressions = kept;
                return true;
            });
        }
    }

    /** 删除没有任何引用的 temp 声明(替代旧方案反复 scope.crawl 的做法)。 */
    private removeUnusedDeclarations(stmts: TYPE.Statement[], ctx: FunctionContext): void {
        const written = new Set<string>();
        // 名称出现次数(含声明自身)。ctx.infos.refs 在复制传播克隆表达式后会过期:
        // 克隆出来的读取不在 refs 里,refs 归零会误删仍被引用的声明
        // (`local_1_2_1` 的声明被删后 catch 里还留着两处读取)。这里按当前 AST
        // 再数一遍,只有确实只剩声明本身时才允许删除。
        const nameCount = new Map<string, number>();
        walkNode({ type: "BlockStatement", body: stmts } as TYPE.BlockStatement, (node) => {
            // 嵌套函数/类里的同名变量是另一个绑定(每个函数都有自己的 vN 声明),
            // 不参与外层的引用计数;外层临时变量被闭包捕获时由 info.captured 保护。
            if (isFunctionLike(node) || isClassLike(node)) return false;
            if (isIdentifier(node)) nameCount.set(node.name, (nameCount.get(node.name) ?? 0) + 1);
            if (isAssignmentExpression(node)) addPatternNames(node.left, written);
            else if (isUpdateExpression(node) && isIdentifier(node.argument)) written.add(node.argument.name);
            else if (isForInStatement(node) || isForOfStatement(node)) addPatternNames(node.left, written);
            return true;
        });

        const removeFrom = (list: TYPE.Statement[]): void => {
            for (let i = list.length - 1; i >= 0; i--) {
                const stmt = list[i];
                if (isVariableDeclaration(stmt)) {
                    const kept = stmt.declarations.filter((declarator) => {
                        if (!isIdentifier(declarator.id)) return true;
                        const name = declarator.id.name;
                        if (!isTempName(name)) return true;
                        if ((nameCount.get(name) ?? 0) > 1) return true;
                        const info = ctx.infos.get(name);
                        if (!info || info.captured || info.refs.size !== 0) return true;
                        if (written.has(name)) return true;
                        if (declarator.init && !isPureExpression(declarator.init)) return true;
                        if (declarator.init) this.removeRefs(declarator.init, ctx);
                        this.changed = true;
                        return false;
                    });
                    if (kept.length === 0) {
                        list.splice(i, 1);
                    } else if (kept.length !== stmt.declarations.length) {
                        stmt.declarations = kept;
                    }
                    continue;
                }
                this.removeUnusedDeclarationsInChildren(stmt, removeFrom);
            }
        };
        removeFrom(stmts);
    }

    private removeUnusedDeclarationsInChildren(stmt: TYPE.Statement, fn: (list: TYPE.Statement[]) => void): void {
        switch (stmt.type) {
            case "BlockStatement": fn(stmt.body); break;
            case "IfStatement":
                if (isBlockStatement(stmt.consequent)) fn(stmt.consequent.body);
                if (stmt.alternate && isBlockStatement(stmt.alternate)) fn(stmt.alternate.body);
                break;
            case "WhileStatement":
            case "DoWhileStatement":
            case "ForStatement":
            case "ForInStatement":
            case "ForOfStatement":
            case "LabeledStatement":
                if (isBlockStatement(stmt.body)) fn(stmt.body.body);
                break;
            case "TryStatement":
                fn(stmt.block.body);
                if (stmt.handler) fn(stmt.handler.body.body);
                if (stmt.finalizer) fn(stmt.finalizer.body);
                break;
            case "SwitchStatement":
                for (const c of stmt.cases) fn(c.consequent);
                break;
            default:
                break;
        }
    }

    private removeRefs(node: TYPE.Node, ctx: FunctionContext): void {
        walkNode(node, (n) => {
            if (isIdentifier(n)) ctx.infos.get(n.name)?.refs.delete(n);
        });
    }

    // ---------------------------------------------------------------- 语句

    /**
     * 兼容路径:`catch (acc)` 的 acc 会遮蔽函数级 acc。
     *
     * 反编译器现在直接生成 `catch (catchAcc)` + handler 开头的 `acc = catchAcc`
     * (见 NodeFactory.tryStatementNode),正常不会再出现 `catch (acc)`;这里保留
     * 重命名是为了处理外部传入的 AST,避免优化器把 catch 参数和函数累加器混为一谈。
     */
    private renameCatchParameters(path: NodePath<TYPE.Program> | NodePath<TYPE.Function>, ctx: FunctionContext): void {
        const rootBody: TYPE.Node = isProgramNode(path.node) ? path.node : path.node.body;
        let hasCatch = false;
        walkNode(rootBody, (node) => {
            if (node !== rootBody && (isFunctionLike(node) || isClassLike(node))) return false;
            if (isCatchClause(node)) {
                hasCatch = true;
                return false;
            }
            return true;
        });
        if (!hasCatch) return;

        const currentFunction = isProgramNode(path.node) ? null : path.node;
        path.traverse({
            CatchClause: (catchPath) => {
                const functionParent = catchPath.getFunctionParent();
                if ((functionParent ? functionParent.node : null) !== currentFunction) return;
                const param = catchPath.node.param;
                if (!isIdentifier(param)) return;
                const oldName = param.name;
                if (!isTempName(oldName) || !ctx.infos.has(oldName)) return;
                const binding = catchPath.scope.getBinding(oldName);
                if (!binding) return;

                let newName = "catchAcc";
                let i = 0;
                while (path.scope.hasBinding(newName) || catchPath.scope.hasBinding(newName)) {
                    newName = "catchAcc" + (++i);
                }
                const refs = new Set<TYPE.Node>();
                let captured = false;
                for (const reference of binding.referencePaths) {
                    if (reference.node) refs.add(reference.node);
                    const refFunction = reference.getFunctionParent();
                    if ((refFunction ? refFunction.node : null) !== currentFunction) captured = true;
                }
                catchPath.get("body").traverse({
                    Identifier: (refPath) => {
                        if (refPath.node.name === oldName && refPath.scope.getBinding(oldName) === binding) {
                            refPath.node.name = newName;
                        }
                    },
                });
                param.name = newName;
                ctx.infos.set(newName, { name: newName, refs, captured });
                this.changed = true;
            },
        });
    }

    private processStatements(stmts: TYPE.Statement[], env: EnvState, ctx: FunctionContext): void {
        for (let i = 0; i < stmts.length; i++) {
            this.processStatement(stmts[i], env, stmts, i, ctx);
        }
    }

    /** 收集区域的写入(标识符名 + 成员目标);必须在处理该区域之前调用,处理会改写 AST。 */
    private collectRegionWrites(
        nodes: Array<TYPE.Node | null | undefined>,
    ): { names: Set<string>; members: MemberWriteTarget[] } {
        const names = new Set<string>();
        const members: MemberWriteTarget[] = [];
        for (const node of nodes) {
            if (!node) continue;
            collectAssignedNames(node, names);
            collectMemberWriteTargets(node, members);
        }
        return { names, members };
    }

    /** 处理完区域后调用:区域内的写入使外层 env 的缓存失效。 */
    private invalidateRegionWrites(
        writes: { names: Set<string>; members: MemberWriteTarget[] },
        env: EnvState,
    ): void {
        for (const name of writes.names) env.invalidate(name);
        for (const target of writes.members) {
            env.invalidateMemberReads(target.object, target.property, target.computed);
        }
    }

    /** 单个赋值/更新目标引发的失效:成员左值按“同对象.同属性”精确失效,其余按名字失效。 */
    private invalidateAssignTarget(
        target: TYPE.LVal | TYPE.OptionalMemberExpression,
        env: EnvState,
    ): void {
        if (isMemberExpression(target) || isOptionalMemberExpression(target)) {
            const m = target as TYPE.MemberExpression;
            env.invalidateMemberReads(m.object as TYPE.Expression, m.property as TYPE.Expression, m.computed);
            return;
        }
        if (isIdentifier(target)) {
            env.invalidate(target.name);
            return;
        }
        for (const name of collectAssignedNames(target)) env.invalidate(name);
    }

    private processStatement(
        stmt: TYPE.Statement,
        env: EnvState,
        list: TYPE.Statement[],
        index: number,
        ctx: FunctionContext,
    ): void {
        switch (stmt.type) {
            case "ExpressionStatement":
                stmt.expression = this.processExpression(stmt.expression, env, list, index, ctx);
                return;
            case "VariableDeclaration":
                this.processVariableDeclaration(stmt, env, list, index, ctx);
                return;
            case "IfStatement": {
                stmt.test = this.rewriteExpr(stmt.test, env, list, index, ctx, true);
                const writes = this.collectRegionWrites([stmt.consequent, stmt.alternate]);
                this.processNestedStatement(stmt.consequent, env.copy(), ctx);
                if (stmt.alternate) this.processNestedStatement(stmt.alternate, env.copy(), ctx);
                this.invalidateRegionWrites(writes, env);
                return;
            }
            case "WhileStatement": {
                const writes = this.collectRegionWrites([stmt.test, stmt.body]);
                this.invalidateRegionWrites(writes, env);
                stmt.test = this.rewriteExpr(stmt.test, env, list, index, ctx, false);
                this.processNestedStatement(stmt.body, env.copy(), ctx);
                this.invalidateRegionWrites(writes, env);
                return;
            }
            case "DoWhileStatement": {
                const writes = this.collectRegionWrites([stmt.body, stmt.test]);
                this.invalidateRegionWrites(writes, env);
                this.processNestedStatement(stmt.body, env.copy(), ctx);
                stmt.test = this.rewriteExpr(stmt.test, env, list, index, ctx, false);
                this.invalidateRegionWrites(writes, env);
                return;
            }
            case "ForStatement": {
                const writes = this.collectRegionWrites([stmt.init, stmt.test, stmt.update, stmt.body]);
                this.invalidateRegionWrites(writes, env);
                if (stmt.init) {
                    if (isVariableDeclaration(stmt.init)) {
                        this.processVariableDeclaration(stmt.init, env, list, index, ctx);
                    } else {
                        stmt.init = this.processExpression(stmt.init, env, list, index, ctx);
                    }
                }
                // test/update/body 在第二次及之后的迭代里读到的是上一轮写入的值,
                // 不能沿用 init 刚建立的常量(否则 `for (v = 0; v < n; v = v + 1)`
                // 会被传播成 `0 < n` / `v = 0 + 1`)。只清掉循环内会被改写的名字。
                this.invalidateRegionWrites(
                    this.collectRegionWrites([stmt.test, stmt.update, stmt.body]), env);
                stmt.test = this.rewriteExpr(stmt.test, env, list, index, ctx, false);
                if (stmt.update) stmt.update = this.processExpression(stmt.update, env.copy(), list, index, ctx, false);
                this.processNestedStatement(stmt.body, env.copy(), ctx);
                this.invalidateRegionWrites(writes, env);
                return;
            }
            case "ForInStatement":
            case "ForOfStatement": {
                const writes = this.collectRegionWrites([stmt.left, stmt.body]);
                this.invalidateRegionWrites(writes, env);
                (stmt as TYPE.ForInStatement).right = this.rewriteExpr(
                    (stmt as TYPE.ForInStatement).right, env, list, index, ctx, true);
                this.processNestedStatement(stmt.body, env.copy(), ctx);
                this.invalidateRegionWrites(writes, env);
                return;
            }
            case "BlockStatement":
                this.processStatements(stmt.body, env, ctx);
                return;
            case "LabeledStatement":
                this.processNestedStatement(stmt.body, env, ctx);
                return;
            case "TryStatement": {
                const tryWrites = this.collectRegionWrites([stmt.block, stmt.handler?.body]);
                const writes = {
                    names: new Set(tryWrites.names),
                    members: tryWrites.members.slice(),
                };
                if (stmt.finalizer) {
                    const finalizerWrites = this.collectRegionWrites([stmt.finalizer]);
                    for (const name of finalizerWrites.names) writes.names.add(name);
                    for (const target of finalizerWrites.members) writes.members.push(target);
                }
                this.processNestedStatement(stmt.block, env.copy(), ctx);
                if (stmt.handler) this.processNestedStatement(stmt.handler.body, env.copy(), ctx);
                if (stmt.finalizer) {
                    // finally 可能在 try 的任意位置(含异常路径)执行,不能沿用 try 之前
                    // 的别名关系:try 里写过的名字在 finally 入口必须视为未知,
                    // 否则 `v2 = acc` 会在 acc 已被改写后仍被折叠成 acc。
                    const finalEnv = env.copy();
                    this.invalidateRegionWrites(tryWrites, finalEnv);
                    this.processNestedStatement(stmt.finalizer, finalEnv, ctx);
                }
                this.invalidateRegionWrites(writes, env);
                return;
            }
            case "SwitchStatement": {
                const writes = this.collectRegionWrites(stmt.cases);
                stmt.discriminant = this.rewriteExpr(stmt.discriminant, env, list, index, ctx, true);
                for (const c of stmt.cases) {
                    const caseEnv = env.copy();
                    if (c.test) c.test = this.rewriteExpr(c.test, caseEnv, list, index, ctx, true);
                    this.processStatements(c.consequent, caseEnv, ctx);
                }
                this.invalidateRegionWrites(writes, env);
                return;
            }
            case "ReturnStatement":
            case "ThrowStatement":
                if (stmt.argument) {
                    stmt.argument = this.rewriteExpr(stmt.argument, env, list, index, ctx, true);
                }
                return;
            case "ExportNamedDeclaration":
                if (stmt.declaration && isVariableDeclaration(stmt.declaration)) {
                    this.processVariableDeclaration(stmt.declaration, env, list, index, ctx);
                }
                return;
            case "ExportDefaultDeclaration":
                if (stmt.declaration && !isFunctionLike(stmt.declaration) && !isClassLike(stmt.declaration)
                    && isExpression(stmt.declaration)) {
                    stmt.declaration = this.rewriteExpr(stmt.declaration, env, list, index, ctx, false);
                }
                return;
            default:
                return;
        }
    }

    private processNestedStatement(stmt: TYPE.Statement, env: EnvState, ctx: FunctionContext): void {
        if (isBlockStatement(stmt)) {
            this.processStatements(stmt.body, env, ctx);
        } else {
            this.processStatement(stmt, env, [stmt], 0, ctx);
        }
    }

    private processVariableDeclaration(
        decl: TYPE.VariableDeclaration,
        env: EnvState,
        list: TYPE.Statement[],
        index: number,
        ctx: FunctionContext,
    ): void {
        for (const declarator of decl.declarations) {
            if (!isIdentifier(declarator.id)) {
                if (declarator.init) declarator.init = this.rewriteExpr(declarator.init, env, list, index, ctx, false);
                continue;
            }
            const name = declarator.id.name;
            env.invalidate(name);
            if (!declarator.init) continue;

            // let Y = X; 当 X 当前值是 class/function/new/call 等不可复制值时,
            // 直接把值搬到 Y 的初始化里,避免多一个临时变量。
            if (isIdentifier(declarator.init) && declarator.init.name !== name) {
                const sourceName = declarator.init.name;
                const sourceEntry = env.get(sourceName);
                const sourceInfo = ctx.infos.get(sourceName);
                if (sourceEntry && sourceInfo && !sourceInfo.captured
                    && sourceEntry.unsubstitutedReads <= 1
                    && sourceEntry.list === list && sourceEntry.index < index
                    && this.isSafeToMoveBetween(list, sourceEntry.index + 1, index)) {
                    const definition = sourceEntry.list[sourceEntry.index];
                    const isSimpleDefinition = isExpressionStatement(definition)
                        && isAssignmentExpression(definition.expression)
                        && definition.expression.operator === "="
                        && definition.expression.right === sourceEntry.expr;
                    const deps = collectIdentifierNames(sourceEntry.expr);
                    const liveAfterMove = ctx.liveAfter.get(list[index]);
                    if (isSimpleDefinition && !isCopyable(sourceEntry.expr)
                        && !deps.has(name)
                        && !(liveAfterMove && liveAfterMove.has(sourceName))) {
                        const value = sourceEntry.expr;
                        sourceInfo.refs.delete(declarator.init);
                        ctx.moved.set(value, list[index]);
                        declarator.init = value;
                        env.invalidate(sourceName);
                        if (isTempName(sourceName) && ctx.infos.has(sourceName)) {
                            env.set(sourceName, {
                                expr: identifierBuilder(name),
                                list,
                                index,
                                deps: [name],
                                unsubstitutedReads: 0,
                            });
                        }
                        if (isTempName(name) && ctx.infos.has(name)) this.define(env, name, value, list, index, ctx);
                        this.changed = true;
                        continue;
                    }
                }
            }

            const init = this.rewriteExpr(declarator.init, env, list, index, ctx, false);
            declarator.init = init;
            if (isTempName(name) && ctx.infos.has(name)) {
                this.define(env, name, init, list, index, ctx);
            }
        }
    }

    private processExpression(
        expr: TYPE.Expression,
        env: EnvState,
        list: TYPE.Statement[],
        index: number,
        ctx: FunctionContext,
        allowImpure: boolean = true,
    ): TYPE.Expression {
        if (isAssignmentExpression(expr)) {
            this.processAssignment(expr, env, list, index, ctx, allowImpure);
            return expr;
        }
        return this.rewriteExpr(expr, env, list, index, ctx, allowImpure);
    }

    private processAssignment(
        assign: TYPE.AssignmentExpression,
        env: EnvState,
        list: TYPE.Statement[],
        index: number,
        ctx: FunctionContext,
        allowImpure: boolean = true,
    ): void {
        this.rewriteLVal(assign.left, env, list, index, ctx);
        // LHS 会先于 RHS 求值;只有简单标识符左值才允许把副作用搬到 RHS
        assign.right = this.rewriteExpr(
            assign.right, env, list, index, ctx, allowImpure && this.isPureLVal(assign.left));

        // Y = X:若 X 当前值是不可复制但可搬移的(New/调用/函数/类等),把值搬到 Y,
        // 并让 X 暂时别名到 Y。这样后续 X.method / X.call(Y,...) 能还原成 Y.method(...)。
        if (assign.operator === "=" && isIdentifier(assign.left) && isIdentifier(assign.right)
            && assign.left.name !== assign.right.name) {
            const targetName = assign.left.name;
            const sourceName = assign.right.name;
            const targetInfo = ctx.infos.get(targetName);
            const sourceInfo = ctx.infos.get(sourceName);
            const sourceEntry = env.get(sourceName);
            if (targetInfo && sourceInfo && !targetInfo.captured && !sourceInfo.captured
                && isTempName(targetName) && sourceEntry
                && sourceEntry.unsubstitutedReads <= 1
                && sourceEntry.list === list && sourceEntry.index < index
                && this.isSafeToMoveBetween(list, sourceEntry.index + 1, index)) {
                const definition = sourceEntry.list[sourceEntry.index];
                const isSimpleDefinition = isExpressionStatement(definition)
                    && isAssignmentExpression(definition.expression)
                    && definition.expression.operator === "="
                    && definition.expression.right === sourceEntry.expr;
                const deps = collectIdentifierNames(sourceEntry.expr);
                const liveAfterMove = ctx.liveAfter.get(list[index]);
                if (isSimpleDefinition && isNewExpression(sourceEntry.expr)
                    && !deps.has(targetName)
                    && !(liveAfterMove && liveAfterMove.has(sourceName))) {
                    const value = sourceEntry.expr;
                    sourceInfo.refs.delete(assign.right);
                    ctx.moved.set(value, list[index]);
                    assign.right = value;
                    env.invalidate(sourceName);
                    this.define(env, targetName, value, list, index, ctx);
                    env.set(sourceName, {
                        expr: identifierBuilder(targetName),
                        list,
                        index,
                        deps: [targetName],
                        unsubstitutedReads: 0,
                    });
                    this.changed = true;
                    return;
                }
            }
        }

        // 标识符/解构写入使依赖名字的缓存失效;成员左值(this.x = v)按
        // “同对象.同属性”精确失效——成员写入不改变变量绑定,别名与模板对象
        // 必须跨成员写入存活(ObjectLiteralSimplify 依赖该形态)。
        this.invalidateAssignTarget(assign.left, env);
        if (assign.operator === "=" && isIdentifier(assign.left)) {
            const name = assign.left.name;
            if (isTempName(name) && ctx.infos.has(name)) {
                this.define(env, name, assign.right, list, index, ctx);
            }
        }
    }

    private define(
        env: EnvState,
        name: string,
        expr: TYPE.Expression,
        list: TYPE.Statement[],
        index: number,
        ctx: FunctionContext,
    ): void {
        const info = ctx.infos.get(name);
        if (!info || info.captured) return;
        const deps = Array.from(collectIdentifierNames(expr));
        // v = v + 1 这类自引用不能再传播,否则后续 use(v) 会读到新 v
        if (deps.includes(name)) return;
        // 函数/类表达式只在最后一次引用时整块搬移,不会克隆,可以不受大小限制
        if (!isDeclarationValue(expr)
            && nodeSize(expr, TempVariableSimplify.MAX_PROPAGATED_SIZE + 1) > TempVariableSimplify.MAX_PROPAGATED_SIZE) return;
        env.set(name, { expr, list, index, deps, unsubstitutedReads: 0 });
    }

    // ---------------------------------------------------------------- 表达式

    private rewriteLVal(
        node: TYPE.LVal | TYPE.OptionalMemberExpression,
        env: EnvState,
        list: TYPE.Statement[],
        index: number,
        ctx: FunctionContext,
    ): void {
        if (!node) return;
        if (isIdentifier(node)) return;
        if (isMemberExpression(node) || isOptionalMemberExpression(node)) {
            node.object = this.rewriteExpr(node.object as TYPE.Expression, env, list, index, ctx, false);
            if (node.computed) {
                node.property = this.rewriteExpr(node.property as TYPE.Expression, env, list, index, ctx, false);
            }
            return;
        }
        if (isRestElement(node)) {
            this.rewriteLVal(node.argument as any, env, list, index, ctx);
        } else if (isAssignmentPattern(node)) {
            this.rewriteLVal(node.left as any, env, list, index, ctx);
            node.right = this.rewriteExpr(node.right, env, list, index, ctx, false);
        } else if (isArrayPattern(node)) {
            for (const e of node.elements) if (e) this.rewriteLVal(e as any, env, list, index, ctx);
        } else if (isObjectPattern(node)) {
            for (const p of node.properties) {
                if (isRestElement(p)) this.rewriteLVal(p.argument as any, env, list, index, ctx);
                else if (isObjectProperty(p)) {
                    if (p.computed) p.key = this.rewriteExpr(p.key as TYPE.Expression, env, list, index, ctx, false);
                    this.rewriteLVal(p.value as any, env, list, index, ctx);
                }
            }
        }
    }

    private rewriteExpr(
        node: TYPE.Expression,
        env: EnvState,
        list: TYPE.Statement[],
        index: number,
        ctx: FunctionContext,
        allowImpure: boolean,
    ): TYPE.Expression {
        if (!node) return node;
        if (isIdentifier(node)) {
            return this.resolveIdentifier(node, env, list, index, ctx, allowImpure);
        }
        if (isFunctionLike(node)) return node;
        if (isClassExpression(node)) {
            // 只处理 extends 表达式,不进入 class body(方法有独立作用域)
            if (node.superClass) {
                node.superClass = this.rewriteExpr(
                    node.superClass as TYPE.Expression, env, list, index, ctx, false);
            }
            return node;
        }
        if (isClassDeclaration(node)) return node;

        switch (node.type) {
            case "MemberExpression":
            case "OptionalMemberExpression": {
                const n = node as TYPE.MemberExpression;
                n.object = this.rewriteExpr(n.object as TYPE.Expression, env, list, index, ctx, allowImpure);
                if (n.computed) {
                    n.property = this.rewriteExpr(
                        n.property as TYPE.Expression, env, list, index, ctx,
                        allowImpure && isPureExpression(n.object));
                }
                return n as TYPE.Expression;
            }
            case "AssignmentExpression": {
                const n = node as TYPE.AssignmentExpression;
                this.rewriteLVal(n.left, env, list, index, ctx);
                n.right = this.rewriteExpr(n.right, env, list, index, ctx, false);
                this.invalidateAssignTarget(n.left, env);
                if (n.operator === "=" && isIdentifier(n.left)) {
                    const name = n.left.name;
                    if (isTempName(name) && ctx.infos.has(name)) this.define(env, name, n.right, list, index, ctx);
                }
                return n;
            }
            case "UpdateExpression": {
                const n = node as TYPE.UpdateExpression;
                if (isIdentifier(n.argument)) {
                    env.invalidate(n.argument.name);
                } else {
                    this.rewriteLVal(n.argument as any, env, list, index, ctx);
                    // this.x++ 同样读取并写入成员:按“同对象.同属性”精确失效
                    this.invalidateAssignTarget(n.argument as any, env);
                }
                return n;
            }
            case "SequenceExpression": {
                const n = node as TYPE.SequenceExpression;
                let canMove = allowImpure;
                n.expressions = n.expressions.map((e) => {
                    const rewritten = this.rewriteExpr(e, env, list, index, ctx, canMove);
                    if (canMove && !isPureExpression(rewritten)) canMove = false;
                    return rewritten;
                });
                return n;
            }
            case "LogicalExpression": {
                const n = node as TYPE.LogicalExpression;
                n.left = this.rewriteExpr(n.left, env, list, index, ctx, allowImpure);
                // 右侧是条件求值,不能把前一语句的副作用搬进来
                const rightEnv = env.copy();
                n.right = this.rewriteExpr(n.right, rightEnv, list, index, ctx, false);
                // 右值可能执行,也可能不执行;它写入的变量在 outer env 中必须视为未知,
                // 否则分支里会把 v7 错误地继续当成 acc(acc 已被右值改掉)。
                this.invalidateRegionWrites(this.collectRegionWrites([n.right]), env);
                return n;
            }
            case "BinaryExpression": {
                const n = node as TYPE.BinaryExpression;
                n.left = this.rewriteExpr(n.left as TYPE.Expression, env, list, index, ctx, allowImpure);
                // 右操作数在左侧之后求值:左侧有副作用时不能再把前一语句的调用搬进来
                n.right = this.rewriteExpr(n.right as TYPE.Expression, env, list, index, ctx,
                    allowImpure && isPureExpression(n.left as TYPE.Expression));
                return n;
            }
            case "ConditionalExpression": {
                const n = node as TYPE.ConditionalExpression;
                n.test = this.rewriteExpr(n.test, env, list, index, ctx, allowImpure);
                n.consequent = this.rewriteExpr(n.consequent, env.copy(), list, index, ctx, false);
                n.alternate = this.rewriteExpr(n.alternate, env.copy(), list, index, ctx, false);
                // consequent/alternate 只会执行其中一个,写入的变量在 outer env 中都视为未知
                this.invalidateRegionWrites(this.collectRegionWrites([n.consequent, n.alternate]), env);
                return n;
            }
            case "CallExpression":
            case "NewExpression": {
                const n = node as TYPE.CallExpression;
                n.callee = this.rewriteExpr(n.callee as TYPE.Expression, env, list, index, ctx, allowImpure) as any;
                let canMove = allowImpure && isPureExpression(n.callee as TYPE.Expression);
                n.arguments = n.arguments.map((arg) => {
                    if (isSpreadElement(arg)) {
                        arg.argument = this.rewriteExpr(arg.argument, env, list, index, ctx, canMove);
                        if (canMove && !isPureExpression(arg.argument)) canMove = false;
                        return arg;
                    }
                    const rewritten = this.rewriteExpr(arg as TYPE.Expression, env, list, index, ctx, canMove);
                    if (canMove && !isPureExpression(rewritten)) canMove = false;
                    return rewritten as any;
                });
                return n;
            }
            case "UnaryExpression": {
                const n = node as TYPE.UnaryExpression;
                n.argument = this.rewriteExpr(n.argument, env, list, index, ctx, allowImpure);
                return n;
            }
            case "AwaitExpression": {
                const n = node as TYPE.AwaitExpression;
                n.argument = this.rewriteExpr(n.argument, env, list, index, ctx, allowImpure);
                return n;
            }
            case "YieldExpression": {
                const n = node as TYPE.YieldExpression;
                if (n.argument) n.argument = this.rewriteExpr(n.argument, env, list, index, ctx, allowImpure);
                return n;
            }
            case "TemplateLiteral": {
                const n = node as TYPE.TemplateLiteral;
                let canMove = allowImpure;
                n.expressions = n.expressions.map((e) => {
                    const rewritten = this.rewriteExpr(e as TYPE.Expression, env, list, index, ctx, canMove);
                    if (canMove && !isPureExpression(rewritten)) canMove = false;
                    return rewritten;
                });
                return n;
            }
            case "TaggedTemplateExpression": {
                const n = node as TYPE.TaggedTemplateExpression;
                n.tag = this.rewriteExpr(n.tag, env, list, index, ctx, allowImpure);
                let canMove = allowImpure && isPureExpression(n.tag);
                n.quasi.expressions = n.quasi.expressions.map((e) => {
                    const rewritten = this.rewriteExpr(e as TYPE.Expression, env, list, index, ctx, canMove);
                    if (canMove && !isPureExpression(rewritten)) canMove = false;
                    return rewritten;
                });
                return n;
            }
            case "ArrayExpression": {
                const n = node as TYPE.ArrayExpression;
                let canMove = allowImpure;
                n.elements = n.elements.map((e) => {
                    if (!e) return e;
                    if (isSpreadElement(e)) {
                        e.argument = this.rewriteExpr(e.argument, env, list, index, ctx, canMove);
                        if (canMove && !isPureExpression(e.argument)) canMove = false;
                        return e;
                    }
                    const rewritten = this.rewriteExpr(e as TYPE.Expression, env, list, index, ctx, canMove);
                    if (canMove && !isPureExpression(rewritten)) canMove = false;
                    return rewritten;
                });
                return n;
            }
            case "ObjectExpression": {
                const n = node as TYPE.ObjectExpression;
                let canMove = allowImpure;
                n.properties = n.properties.map((p) => {
                    if (isSpreadElement(p)) {
                        p.argument = this.rewriteExpr(p.argument, env, list, index, ctx, canMove);
                        if (canMove && !isPureExpression(p.argument)) canMove = false;
                        return p;
                    }
                    if (isObjectProperty(p)) {
                        if (p.computed) {
                            p.key = this.rewriteExpr(p.key as TYPE.Expression, env, list, index, ctx, canMove);
                            if (canMove && !isPureExpression(p.key as TYPE.Expression)) canMove = false;
                        }
                        p.value = this.rewriteExpr(p.value as TYPE.Expression, env, list, index, ctx, canMove);
                        if (canMove && !isPureExpression(p.value as TYPE.Expression)) canMove = false;
                    }
                    return p;
                });
                return n;
            }
            case "ParenthesizedExpression": {
                const n = node as any;
                n.expression = this.rewriteExpr(n.expression, env, list, index, ctx, allowImpure);
                return n;
            }
            case "TSAsExpression":
            case "TSTypeAssertion":
            case "TSNonNullExpression":
            case "TypeCastExpression": {
                const n = node as any;
                n.expression = this.rewriteExpr(n.expression, env, list, index, ctx, allowImpure);
                return n;
            }
            default:
                return this.rewriteExprFallback(node, env, list, index, ctx);
        }
    }

    private rewriteExprFallback(
        node: TYPE.Expression,
        env: EnvState,
        list: TYPE.Statement[],
        index: number,
        ctx: FunctionContext,
    ): TYPE.Expression {
        const keys = (VISITOR_KEYS as any)[node.type] as string[] | undefined;
        if (!keys) return node;
        for (const key of keys) {
            const value = (node as any)[key];
            if (Array.isArray(value)) {
                (node as any)[key] = value.map((child: any) =>
                    child && isExpression(child)
                        ? this.rewriteExpr(child, env, list, index, ctx, false)
                        : child);
            } else if (value && isExpression(value)) {
                (node as any)[key] = this.rewriteExpr(value, env, list, index, ctx, false);
            }
        }
        return node;
    }

    private registerCloneRefs(node: TYPE.Node, ctx: FunctionContext): void {
        walkNode(node, (n, parent) => {
            if (isIdentifier(n) && parent && isReferenced(n, parent)) {
                const info = ctx.infos.get(n.name);
                if (info) info.refs.add(n);
            }
        });
    }

    private isPureLVal(node: TYPE.LVal | TYPE.OptionalMemberExpression): boolean {
        if (isIdentifier(node)) return true;
        if (isMemberExpression(node) || isOptionalMemberExpression(node)) {
            return isPureExpression(node.object as TYPE.Node)
                && (!node.computed || isPureExpression(node.property as TYPE.Node));
        }
        return false;
    }

    private isSafeToMoveBetween(list: TYPE.Statement[], from: number, to: number): boolean {
        for (let i = from; i < to && i < list.length; i++) {
            if (!this.isPureStatement(list[i])) return false;
        }
        return true;
    }

    private isPureStatement(stmt: TYPE.Statement): boolean {
        if (isEmptyStatement(stmt)) return true;
        if (isExpressionStatement(stmt)) {
            const expr = stmt.expression;
            if (isAssignmentExpression(expr)) {
                return isIdentifier(expr.left) && isPureExpression(expr.right);
            }
            return isPureExpression(expr);
        }
        if (isVariableDeclaration(stmt)) {
            return stmt.declarations.every((d) => !d.init || isPureExpression(d.init));
        }
        if (isBlockStatement(stmt)) {
            return stmt.body.every((s) => this.isPureStatement(s));
        }
        return false;
    }

    /**
     * 当前语句是否是 `x = x + ...` 形式的自覆盖,且读取的正是本次读取的节点。
     * 只对二元运算放开:这类累加链的旧值在本条语句后失效,可以安全搬移前一条语句的结果。
     */
    private statementOverwritesSelf(stmt: TYPE.Statement | undefined, name: string, id: TYPE.Identifier): boolean {
        if (!stmt || !isExpressionStatement(stmt) || !isAssignmentExpression(stmt.expression)) return false;
        const assign = stmt.expression;
        if (assign.operator !== "=" || !isIdentifier(assign.left) || assign.left.name !== name) return false;
        if (!isBinaryExpression(assign.right)) return false;
        return assign.right.left === id || assign.right.right === id;
    }

    /**
     * 语句形如 `name = RHS`(plain =),且 RHS 里对 name 只有 id 这一次读取:
     * 旧值在本语句执行后立即被覆盖,因此这次读取就是旧值的最后一次使用。
     * 名字级活跃性分不清 acc 的新旧版本(后续读取读到的是新值),这里按值补判。例如:
     *   acc = p0.trim(); acc = acc.length;  ->  acc = p0.trim().length;
     */
    private statementOverwritesSelfAssign(stmt: TYPE.Statement | undefined, name: string, id: TYPE.Identifier): boolean {
        if (!stmt || !isExpressionStatement(stmt) || !isAssignmentExpression(stmt.expression)) return false;
        const assign = stmt.expression;
        if (assign.operator !== "=" || !isIdentifier(assign.left) || assign.left.name !== name) return false;
        return this.countReadsInNode(assign.right, name) === 1 && this.containsNode(assign.right, id);
    }

    /**
     * id 在当前语句里是否以“方法调用接收者”的身份被读取:语句形如 `X = ... X.m(args)`。
     * 当这次读取是靠“本语句覆盖 X”才成为旧值最后用法时,只允许把不可复制的右值
     * (如 `v0 = new RegExp(...)` 的 newExpr)搬进这种形态,搬移后等价于 newExpr.m(args);
     * 裸成员装载(`acc = acc.test`)是 AccCallSimplify 依赖的中间形态,必须保持原样。
     */
    private isCalleeReceiverRead(stmt: TYPE.Statement | null | undefined, id: TYPE.Identifier): boolean {
        if (!stmt || !isExpressionStatement(stmt) || !isAssignmentExpression(stmt.expression)) return false;
        let current: TYPE.Node = stmt.expression.right;
        while (isUnaryExpression(current) && current.prefix) current = current.argument;
        if (!isCallExpression(current)) return false;
        const callee = current.callee;
        return isMemberExpression(callee) && callee.object === id;
    }

    /**
     * 当前语句之后紧跟的是 `name.call(...)`(AccCallSimplify 要还原的方法装载形态)。
     * `name = name.prop` 这种裸成员装载不能提前改成别名读取,否则 AccCallSimplify
     * 匹配不到 `acc = acc.prop; acc.call(recv, ...)`。
     */
    private nextStatementIsAccMethodCall(list: TYPE.Statement[], index: number, name: string): boolean {
        const next = list[index + 1];
        if (!next) return false;
        let expr: TYPE.Node | null = null;
        if (isExpressionStatement(next)) {
            expr = next.expression;
            if (isAssignmentExpression(expr)) expr = expr.right;
        } else if (isReturnStatement(next) && next.argument) {
            expr = next.argument;
        }
        if (!expr) return false;
        while (isUnaryExpression(expr) && expr.prefix) expr = expr.argument;
        if (!isCallExpression(expr)) return false;
        const callee = expr.callee;
        return isMemberExpression(callee)
            && !callee.computed
            && isIdentifier(callee.object) && callee.object.name === name
            && isIdentifier(callee.property) && callee.property.name === "call";
    }

    /**
     * 在 env 中查找当前持有 name 旧值的别名临时变量(前面执行过 `alias = name`,
     * 且两者此后都没有被改写)。返回第一个可用别名。
     */
    private findAliasOf(env: EnvState, name: string, ctx: FunctionContext): string | null {
        for (const [alias, entry] of env.map) {
            if (alias === name || !isTempName(alias)) continue;
            const info = ctx.infos.get(alias);
            if (!info || info.captured) continue;
            if (isIdentifier(entry.expr) && entry.expr.name === name) return alias;
        }
        return null;
    }

    /** 统计一条语句里对 name 的读取次数(不含嵌套函数,复合赋值左侧算读取)。 */
    private countReadsInNode(node: TYPE.Node | null | undefined, name: string): number {
        let count = 0;
        walkNode(node, (n, parent) => {
            if (isFunctionLike(n) || isClassLike(n)) return false;
            if (!isIdentifier(n) || n.name !== name) return true;
            if (!parent || isReferenced(n, parent)) count++;
            else if (isAssignmentExpression(parent) && parent.left === n && parent.operator !== "=") count++;
            return true;
        });
        return count;
    }

    private containsNode(root: TYPE.Node | null | undefined, target: TYPE.Node): boolean {
        let found = false;
        walkNode(root, (n) => {
            if (n === target) { found = true; return false; }
            return true;
        });
        return found;
    }

    /**
     * 分支体是否可能在写入 name 之前读取它。
     * 只按顺序看块内语句;遇到“所有路径都会先写 name”的语句(直接赋值,
     * 或 if/else 两个分支都先写)就认为后续读取都读到新值,可以提前结束。
     * 注意不能对复合语句(嵌套 if)做整子树的 collectReadNames 短路判断:
     * 子分支里 `X = true/false; if (X)` 这类“先写后读”会被误判成
     * “可能读旧值”,导致 test 序列里的死赋值无法清理。
     */
    private branchReadsNameBeforeWrite(stmt: TYPE.Statement | null | undefined, name: string): boolean {
        if (!stmt) return false;
        if (isBlockStatement(stmt)) {
            for (const s of stmt.body) {
                if (this.definitelyWritesBeforeRead(s, name)) return false;
                if (this.branchReadsNameBeforeWrite(s, name)) return true;
            }
            return false;
        }
        if (isIfStatement(stmt)) {
            if (collectReadNames(stmt.test).has(name)) return true;
            return this.branchReadsNameBeforeWrite(stmt.consequent, name)
                || this.branchReadsNameBeforeWrite(stmt.alternate, name);
        }
        return collectReadNames(stmt).has(name);
    }

    /** 语句是否一定会在读取 name 之前写入 name(所有执行路径)。 */
    private definitelyWritesBeforeRead(stmt: TYPE.Statement | null | undefined, name: string): boolean {
        if (!stmt) return false;
        if (isBlockStatement(stmt)) {
            for (const s of stmt.body) {
                if (this.definitelyWritesBeforeRead(s, name)) return true;
                if (collectReadNames(s).has(name)) return false;
            }
            return false;
        }
        if (isIfStatement(stmt)) {
            if (collectReadNames(stmt.test).has(name)) return false;
            return stmt.alternate != null
                && this.definitelyWritesBeforeRead(stmt.consequent, name)
                && this.definitelyWritesBeforeRead(stmt.alternate, name);
        }
        // do-while 先执行 body 再求值 test:body 一定先写 name 时,test 读到的是新值
        if (isDoWhileStatement(stmt)) {
            return this.doWhileKillsTestReads(stmt, name);
        }
        if (isExpressionStatement(stmt) && isAssignmentExpression(stmt.expression)) {
            const assign = stmt.expression;
            return assign.operator === "=" && isIdentifier(assign.left) && assign.left.name === name
                && !collectReadNames(assign.right).has(name);
        }
        return false;
    }

    /**
     * do-while 的 test 在 body 之后执行。只有 body 是“所有路径都会先写 name 再读”
     * 且没有 continue(continue 会跳过后续写入直接进入 test)时,test 读取的才是新值。
     */
    private doWhileKillsTestReads(stmt: TYPE.DoWhileStatement, name: string): boolean {
        let hasContinue = false;
        walkNode(stmt.body, (node) => {
            if (isContinueStatement(node)) {
                hasContinue = true;
                return false;
            }
            return true;
        });
        return !hasContinue && this.definitelyWritesBeforeRead(stmt.body, name);
    }

    /**
     * 当前 id 是否是所在语句里对该名字的最后一次读取。
     * 绝大多数语句里保持原来的保守判断;只有 if 的 test 读取且两个分支都会先写后读时,
     * 才允许把非纯右值搬进 test(例如 `acc = f(); if (acc) { ... acc = x; use(acc) }`)。
     */
    private isLastReadInStatement(stmt: TYPE.Statement | null | undefined, id: TYPE.Identifier): boolean {
        if (!stmt || this.countReadsInNode(stmt, id.name) <= 1) return true;
        if (!isIfStatement(stmt) || !this.containsNode(stmt.test, id)) return false;
        if (this.countReadsInNode(stmt.test, id.name) > 1) return false;
        return !this.branchReadsNameBeforeWrite(stmt.consequent, id.name)
            && !this.branchReadsNameBeforeWrite(stmt.alternate, id.name);
    }

    private resolveIdentifier(
        id: TYPE.Identifier,
        env: EnvState,
        list: TYPE.Statement[],
        index: number,
        ctx: FunctionContext,
        allowImpure: boolean,
    ): TYPE.Expression {
        const info = ctx.infos.get(id.name);
        if (!info || info.captured || !info.refs.has(id)) return id;
        const entry = env.get(id.name);
        if (!entry) return id;

        if (isCopyable(entry.expr) && ctx.cloneBudget > 0) {
            const size = nodeSize(entry.expr);
            if (size <= ctx.cloneBudget) {
                info.refs.delete(id);
                ctx.cloneBudget -= size;
                const clone = cloneNode(entry.expr, true) as TYPE.Expression;
                this.registerCloneRefs(clone, ctx);
                this.changed = true;
                return clone;
            }
        }

        // 当前值的最后一次读取:可以用克隆/搬移代替读取变量。
        // 注意 liveness 只看“名字是否还活着”,分不清 acc 的新旧版本:
        //   acc = f(); acc = x + acc; y = acc;
        // 第 2 条读取的是旧 acc,但旧值在本条语句结束后就被覆盖,因此也应视为 last use。
        // statementOverwritesSelfAssign 把这一点推广到任意 `name = RHS` 且 RHS 只读一次
        // name 的语句(如 acc = acc.length):旧值在本语句后立即失效。
        const liveAfter = ctx.liveAfter.get(list[index]);
        let deadAfter = liveAfter != null && !liveAfter.has(id.name);
        // if 的 test 读取:分支可能通过 break/return 跳出后继续读该变量,
        // liveAfter(if 之后的语句)看不到这条路径,要看分支的 live-in。
        if (deadAfter && isIfStatement(list[index]) && this.containsNode(list[index].test, id)) {
            const branchLive = ctx.branchLive.get(list[index]);
            if (branchLive && branchLive.has(id.name)) deadAfter = false;
        }
        const binarySelf = this.statementOverwritesSelf(list[index], id.name, id);
        // `name = RHS` 且 RHS 只读一次 name:旧值在本语句后立即被覆盖。
        // 这条新路径下若变量名在语句后仍活跃(后续读到的是新值),默认只允许搬进
        // 调用接收者位置,避免破坏 acc = acc.test 这类 AccCallSimplify 依赖的
        // 方法装载形态;若后面不是 name.call(...),则允许搬进成员装载的其它位置
        // (如 acc = acc.length)。binarySelf(二元自累加)保持原有任意位置搬移的行为。
        const assignSelf = !binarySelf && this.statementOverwritesSelfAssign(list[index], id.name, id);
        const overwrittenHere = binarySelf || assignSelf;
        // if 的 test 读取:两个分支都一定会在读取前覆盖 name 时,test 里的这次读取
        // 就是旧值的最后用法(之后任何读取拿到的都是分支写入的新值)。
        // 典型形态:
        //   v0 = new RegExp(...);
        //   if (!v0.test(p0)) { v0 = true } else { v0 = false }
        // 把 new RegExp 搬进 test 后,v0 = new RegExp 成为死存储,
        // 整个结构才能折成 `v0 = A && !new RegExp(...).test(p0)`。
        const ifStmt = list[index];
        const testLastUse = isIfStatement(ifStmt) && ifStmt.alternate != null
            && this.containsNode(ifStmt.test, id)
            && this.definitelyWritesBeforeRead(ifStmt.consequent, id.name)
            && this.definitelyWritesBeforeRead(ifStmt.alternate, id.name);
        // 同一个语句里可能还有别的读取(典型是 if 的 test 和分支体都读同一个
        // 临时变量)。只有分支在读取前会先覆盖该变量时,测试里的这次读取才算
        // 最后一次读取;否则搬移调用会复制一份调用。
        const lastUse = (overwrittenHere || deadAfter || testLastUse) && this.isLastReadInStatement(list[index], id);
        if (lastUse && entry.unsubstitutedReads === 0) {
            if (isPureExpression(entry.expr) && !isDeclarationValue(entry.expr)) {
                // 数组/对象字面量:只在唯一使用处求值一次,原赋值稍后会被作为死存储删除
                info.refs.delete(id);
                let value = entry.expr;
                const size = nodeSize(value);
                if (size <= ctx.cloneBudget) {
                    ctx.cloneBudget -= size;
                    value = cloneNode(value, true) as TYPE.Expression;
                    this.registerCloneRefs(value, ctx);
                } else {
                    ctx.moved.set(value, list[index]);
                }
                env.invalidate(id.name);
                this.changed = true;
                return value;
            }
            // 调用/构造/函数/类表达式:跨过的语句必须无副作用,保持求值顺序。
            // assignSelf 路径(靠本语句覆盖才成为 last-use)只允许调用接收者位置,
            // 见上方 assignSelf 的说明。
            //
            // deadAfter 必须准确(分支里 break/continue 后仍会读取的情况见 branchLive),
            // 否则 `v4 = parse(...); if (v4.completed) break; ... return v4;` 会把调用
            // 搬进 test,造成同一个有副作用的调用执行两次。
            if (allowImpure && entry.list === list && entry.index < index
                && this.isSafeToMoveBetween(list, entry.index + 1, index)
                && (deadAfter || binarySelf || assignSelf || this.isCalleeReceiverRead(list[index], id)
                    || !this.nextStatementIsAccMethodCall(list, index, id.name))) {
                info.refs.delete(id);
                ctx.moved.set(entry.expr, list[index]);
                env.invalidate(id.name);
                this.changed = true;
                return entry.expr;
            }
        }

        // 裸成员装载 `x = x.prop`(RHS 只读一次 x),但 x 之后仍会读取新值,
        // 且旧值是不可复制表达式(如 `acc = v2.slice(v8); v6 = acc; acc = acc.length`)。
        // 此时旧值已经复制给别名 y,把本语句里的 x 改读 y:
        //   acc = v6.length; 后续 if (acc === 0) 再把 v6.length 传播进 test。
        // 这样 x 被覆盖后 y 仍持有旧值,下一轮就能把旧值搬到 y 的赋值处。
        if (assignSelf && !deadAfter && !isCopyable(entry.expr) && !isDeclarationValue(entry.expr)
            && !this.isCalleeReceiverRead(list[index], id)
            && !this.nextStatementIsAccMethodCall(list, index, id.name)) {
            const alias = this.findAliasOf(env, id.name, ctx);
            if (alias && !entry.deps.includes(alias)) {
                info.refs.delete(id);
                ctx.infos.get(alias)?.refs.add(id);
                id.name = alias;
                // 别名原先记为 `alias = x`(依赖 x);x 即将被覆盖,
                // 这里改为直接持有旧值,避免 x 失效时把别名一起级联失效。
                env.set(alias, {
                    expr: entry.expr,
                    list: entry.list,
                    index: entry.index,
                    deps: entry.deps.slice(),
                    unsubstitutedReads: 0,
                });
                this.changed = true;
                return id;
            }
        }

        entry.unsubstitutedReads++;
        return id;
    }

    // ---------------------------------------------------------------- 活跃性(传播前)

    private static loopLive(breakLive: Set<string>, continueLive: Set<string>): LoopLive {
        return { breakLive, continueLive, inSwitch: false };
    }

    private static sameSet(a: Set<string>, b: Set<string>): boolean {
        if (a.size !== b.size) return false;
        for (const name of a) if (!b.has(name)) return false;
        return true;
    }

    /** 不做任何修改的活跃性分析,结果写入 ctx.liveAfter。 */
    private analyzeList(stmts: TYPE.Statement[], liveOut: Set<string>, ctx: FunctionContext, loop?: LoopLive): Set<string> {
        const live = new Set(liveOut);
        for (let i = stmts.length - 1; i >= 0; i--) {
            const stmt = stmts[i];
            ctx.liveAfter.set(stmt, new Set(live));
            const before = this.transfer(stmt, live, ctx, loop, false);
            live.clear();
            for (const name of before) live.add(name);
        }
        return live;
    }

    private analyzeNested(stmt: TYPE.Statement, liveOut: Set<string>, ctx: FunctionContext, loop?: LoopLive): Set<string> {
        if (isBlockStatement(stmt)) return this.analyzeList(stmt.body, liveOut, ctx, loop);
        return this.transfer(stmt, liveOut, ctx, loop, false);
    }

    // ---------------------------------------------------------------- 死存储

    private tempReads(node: TYPE.Node | null | undefined, ctx: FunctionContext): Set<string> {
        const result = new Set<string>();
        for (const name of collectReadNames(node)) {
            if (ctx.infos.has(name)) result.add(name);
        }
        return result;
    }

    private tempWrites(node: TYPE.Node | null | undefined, ctx: FunctionContext): Set<string> {
        const result = new Set<string>();
        for (const name of collectAssignedNames(node)) {
            if (ctx.infos.has(name)) result.add(name);
        }
        return result;
    }

    /** 同时收集读取/写入;只保留当前函数里登记的临时变量名。 */
    private tempReadWrites(node: TYPE.Node | null | undefined, ctx: FunctionContext): { reads: Set<string>; writes: Set<string> } {
        const { reads, writes } = collectReadWriteNames(node);
        const tempReads = new Set<string>();
        const tempWrites = new Set<string>();
        for (const name of reads) if (ctx.infos.has(name)) tempReads.add(name);
        for (const name of writes) if (ctx.infos.has(name)) tempWrites.add(name);
        return { reads: tempReads, writes: tempWrites };
    }

    private static union(...sets: Set<string>[]): Set<string> {
        const result = new Set<string>();
        for (const set of sets) for (const name of set) result.add(name);
        return result;
    }

    /**
     * 反向活跃性分析 + 死存储删除。
     * @param liveOut 当前语句列表之后仍然活跃的 temp
     * @returns 语句列表之前仍然活跃的 temp
     */
    private cleanupStatements(stmts: TYPE.Statement[], ctx: FunctionContext, liveOut: Set<string>, loop?: LoopLive): Set<string> {
        const live = new Set(liveOut);
        for (let i = stmts.length - 1; i >= 0; i--) {
            const stmt = stmts[i];
            const dead = this.tryDeadStore(stmt, ctx, live);
            if (dead) {
                this.changed = true;
                this.cleanupVersion++;
                if (dead.replace === null) {
                    stmts.splice(i, 1);
                } else {
                    stmts[i] = dead.replace;
                }
                for (const name of dead.remainingReads) live.add(name);
                continue;
            }
            const before = this.transfer(stmt, live, ctx, loop, true);
            live.clear();
            for (const name of before) live.add(name);
        }
        return live;
    }

    /**
     * 活跃性传递。两种模式共用同一套控制流结构:
     *   cleanup=false 只做分析(结果登记到 ctx.liveAfter / branchLive / loopBodyIn);
     *   cleanup=true  同时删除死存储(由 cleanupStatements 驱动)。
     * 唯一的语义差异是 if 分支的 live-out(分析时减去 test 的写入)和嵌套处理方式,
     * 之前 analyze/cleanup 各维护一份几乎相同的 switch,改一处容易漏掉另一处。
     */
    private transfer(
        stmt: TYPE.Statement,
        liveOut: Set<string>,
        ctx: FunctionContext,
        loop: LoopLive | undefined,
        cleanup: boolean,
    ): Set<string> {
        if (!cleanup) {
            // 非列表位置(else-if 链的 if、直接作为循环体的语句等)也要登记 liveAfter,
            // 否则 isNameDeadAfterTest / matchConditionPattern 拿到 undefined 会放弃折叠。
            ctx.liveAfter.set(stmt, new Set(liveOut));
        }
        switch (stmt.type) {
            case "ExpressionStatement":
            case "VariableDeclaration": {
                const { reads, writes } = this.tempReadWrites(stmt, ctx);
                const result = new Set(reads);
                for (const name of liveOut) if (!writes.has(name)) result.add(name);
                return result;
            }
            case "IfStatement": {
                // 分支的 live-out 就是 if 之后的 live-out。清理模式不能减去 test 的写入:
                // test 里的临时赋值不会让分支里的同名赋值变成死代码。
                const testReads = this.tempReads(stmt.test, ctx);
                let branchOut: Set<string>;
                if (cleanup) {
                    branchOut = new Set(liveOut);
                } else {
                    const testWrites = this.tempWrites(stmt.test, ctx);
                    branchOut = new Set();
                    for (const name of liveOut) if (!testWrites.has(name)) branchOut.add(name);
                }
                const consequentIn = this.transferNested(stmt.consequent, branchOut, ctx, loop, cleanup);
                const alternateIn = stmt.alternate
                    ? this.transferNested(stmt.alternate, branchOut, ctx, loop, cleanup)
                    : branchOut;
                ctx.branchLive.set(stmt, TempVariableSimplify.union(consequentIn, alternateIn));
                return TempVariableSimplify.union(testReads, consequentIn, alternateIn);
            }
            case "WhileStatement":
            case "DoWhileStatement": {
                const testReads = this.tempReads(stmt.test, ctx);
                const initialOut = TempVariableSimplify.union(liveOut, testReads);
                const body = this.analyzeLoopBody(stmt.body, initialOut, ctx, liveOut);
                if (!cleanup) ctx.loopBodyIn.set(stmt, new Set(body.bodyIn));
                const resultIn = cleanup
                    ? this.cleanupNested(stmt.body, ctx, body.bodyOut, TempVariableSimplify.loopLive(liveOut, body.bodyOut))
                    : body.bodyIn;
                if (stmt.type === "WhileStatement") {
                    return TempVariableSimplify.union(testReads, resultIn, liveOut);
                }
                // do-while 的 test 在 body 之后执行:body 一定先写 name 时,test 读到的是新值,
                // 不应把这次读取算作循环入口处旧值的活跃使用。
                const result = new Set(resultIn);
                for (const name of testReads) if (!this.doWhileKillsTestReads(stmt, name)) result.add(name);
                for (const name of liveOut) result.add(name);
                return result;
            }
            case "ForStatement": {
                const testReads = stmt.test ? this.tempReads(stmt.test, ctx) : new Set<string>();
                const updateReads = stmt.update ? this.tempReads(stmt.update, ctx) : new Set<string>();
                const body = this.analyzeLoopBody(
                    stmt.body,
                    TempVariableSimplify.union(liveOut, testReads, updateReads),
                    ctx,
                    liveOut,
                );
                if (!cleanup) ctx.loopBodyIn.set(stmt, new Set(body.bodyIn));
                const resultIn = cleanup
                    ? this.cleanupNested(stmt.body, ctx, body.bodyOut, TempVariableSimplify.loopLive(liveOut, body.bodyOut))
                    : body.bodyIn;
                const initReads = stmt.init ? this.tempReads(stmt.init, ctx) : new Set<string>();
                const initWrites = stmt.init ? this.tempWrites(stmt.init, ctx) : new Set<string>();
                const afterInit = TempVariableSimplify.union(resultIn, testReads, updateReads, liveOut);
                const result = new Set(initReads);
                for (const name of afterInit) if (!initWrites.has(name)) result.add(name);
                return result;
            }
            case "ForInStatement":
            case "ForOfStatement": {
                const rightReads = this.tempReads((stmt as TYPE.ForInStatement).right, ctx);
                const body = this.analyzeLoopBody(stmt.body, new Set(liveOut), ctx, liveOut);
                const resultIn = cleanup
                    ? this.cleanupNested(stmt.body, ctx, body.bodyOut, TempVariableSimplify.loopLive(liveOut, body.bodyOut))
                    : body.bodyIn;
                return TempVariableSimplify.union(rightReads, resultIn, liveOut);
            }
            case "BlockStatement":
                return this.transferNested(stmt, liveOut, ctx, loop, cleanup);
            case "LabeledStatement":
                return this.transferNested(stmt.body, liveOut, ctx, loop, cleanup);
            case "TryStatement": {
                const finalizerReads = stmt.finalizer ? this.tempReads(stmt.finalizer, ctx) : new Set<string>();
                const after = TempVariableSimplify.union(liveOut, finalizerReads);
                // finally 会在 try/handler 的 return/throw/break/continue 出口上执行,
                // try 里一旦有 finally 就可能在任何位置抛异常。出口活跃集必须并入
                // finally 的读取,否则 finally 之前最后一次赋值会被当成死存储删掉
                // (`v14 = request` 被删后 finally 只剩 try 之前的 `v14 = null`)。
                let nestedLoop = loop;
                if (stmt.finalizer) {
                    const finallyLive = TempVariableSimplify.union(loop?.finallyLive ?? new Set<string>(), finalizerReads);
                    nestedLoop = {
                        breakLive: TempVariableSimplify.union(loop?.breakLive ?? liveOut, finalizerReads),
                        continueLive: TempVariableSimplify.union(loop?.continueLive ?? liveOut, finalizerReads),
                        inSwitch: loop?.inSwitch ?? false,
                        finallyLive,
                    };
                }
                const blockIn = this.transferNested(stmt.block, after, ctx, nestedLoop, cleanup);
                const handlerIn = stmt.handler
                    ? this.transferNested(stmt.handler.body, after, ctx, nestedLoop, cleanup)
                    : after;
                const finalizerIn = stmt.finalizer
                    ? this.transferNested(stmt.finalizer, liveOut, ctx, loop, cleanup)
                    : liveOut;
                return TempVariableSimplify.union(blockIn, handlerIn, finalizerIn, liveOut);
            }
            case "SwitchStatement": {
                const result = this.tempReads(stmt.discriminant, ctx);
                const caseLoop: LoopLive = {
                    breakLive: liveOut,
                    continueLive: loop?.continueLive ?? liveOut,
                    inSwitch: true,
                };
                for (const c of stmt.cases) {
                    const caseIn = cleanup
                        ? this.cleanupStatements(c.consequent, ctx, liveOut, caseLoop)
                        : this.analyzeList(c.consequent, liveOut, ctx, caseLoop);
                    for (const name of caseIn) result.add(name);
                    for (const name of liveOut) result.add(name);
                }
                return result;
            }
            case "ReturnStatement":
            case "ThrowStatement":
                // return/throw 之后没有代码,只有返回表达式里的读取需要保留;
                // 外层 try/finally 的 finally 读取在出口处也仍然活跃。
                return TempVariableSimplify.union(
                    this.tempReads(stmt.argument, ctx),
                    loop?.finallyLive ?? new Set<string>(),
                );
            case "ExportNamedDeclaration":
                if (stmt.declaration && isStatementNode(stmt.declaration)) {
                    return this.transfer(stmt.declaration as TYPE.Statement, liveOut, ctx, loop, cleanup);
                }
                return new Set(liveOut);
            case "ExportDefaultDeclaration":
                return this.tempReads(stmt.declaration as TYPE.Node, ctx);
            case "BreakStatement":
                // break 跳出循环后,活跃集是循环之后的代码;switch 里的 break 只跳出 switch。
                // 必须返回副本:调用方会 live.clear() 后把返回值写回 live,
                // 直接返回 liveOut 时 before 与 live 是同一个 Set,clear() 会一起清空。
                return TempVariableSimplify.union(
                    loop && !loop.inSwitch ? loop.breakLive : liveOut,
                    loop?.finallyLive ?? new Set<string>(),
                );
            case "ContinueStatement":
                // continue 跳到循环头(test/update),循环头的读取仍然活跃;
                // 外层 try/finally 的 finally 会先执行,它的读取也要算进来。
                return TempVariableSimplify.union(
                    loop ? loop.continueLive : liveOut,
                    loop?.finallyLive ?? new Set<string>(),
                );
            default:
                return new Set(liveOut);
        }
    }

    private transferNested(
        stmt: TYPE.Statement,
        liveOut: Set<string>,
        ctx: FunctionContext,
        loop: LoopLive | undefined,
        cleanup: boolean,
    ): Set<string> {
        return cleanup
            ? this.cleanupNested(stmt, ctx, liveOut, loop)
            : this.analyzeNested(stmt, liveOut, ctx, loop);
    }

    /** 循环体的活跃性定点迭代:bodyOut 收敛后同时返回入口活跃集与最终 live-out。 */
    private analyzeLoopBody(
        body: TYPE.Statement,
        initialOut: Set<string>,
        ctx: FunctionContext,
        liveOut: Set<string>,
    ): { bodyIn: Set<string>; bodyOut: Set<string> } {
        let bodyOut = initialOut;
        let bodyIn = this.analyzeNested(body, bodyOut, ctx, TempVariableSimplify.loopLive(liveOut, bodyOut));
        for (let k = 0; k < 4; k++) {
            const next = TempVariableSimplify.union(bodyOut, bodyIn);
            if (TempVariableSimplify.sameSet(next, bodyOut)) break;
            bodyOut = next;
            bodyIn = this.analyzeNested(body, bodyOut, ctx, TempVariableSimplify.loopLive(liveOut, bodyOut));
        }
        return { bodyIn, bodyOut };
    }

    private cleanupNested(stmt: TYPE.Statement, ctx: FunctionContext, liveOut: Set<string>, loop?: LoopLive): Set<string> {
        if (isBlockStatement(stmt)) return this.cleanupStatements(stmt.body, ctx, liveOut, loop);
        return this.transfer(stmt, liveOut, ctx, loop, true);
    }

    /**
     * 判断并删除一条死赋值。
     * @returns null 表示不是死赋值;否则给出替换语句(或 null 表示删除)以及仍需保留的读取
     */
    private tryDeadStore(
        stmt: TYPE.Statement,
        ctx: FunctionContext,
        live: Set<string>,
    ): { replace: TYPE.Statement | null; remainingReads: Set<string> } | null {
        if (!isExpressionStatement(stmt) || !isAssignmentExpression(stmt.expression)) return null;
        const assign = stmt.expression;
        if (assign.operator !== "=" || !isIdentifier(assign.left)) return null;
        const name = assign.left.name;
        if (!isTempName(name)) return null;
        const info = ctx.infos.get(name);
        if (!info || info.captured) return null;
        // 返回表达式里直接使用该变量时,保守保留有副作用的调用结果赋值,避免活跃性误判丢失返回值
        // (已经被复制传播搬进 return 的调用不受此限,否则会同时留下调用语句和 return 调用)。
        // 纯调用(p0.trim() 等)没有副作用,删除死存储不可能丢失任何值,不适用该守卫:
        // 否则 `acc = E; X = acc; ... return acc(新版本)` 会留下 `acc = E` 死赋值,
        // 并让 X 复制出第二份调用(`acc = p0.trim(); v2 = p0.trim();`)。
        if (ctx.returned.has(name) && isCallExpression(assign.right)
            && !isPureExpression(assign.right) && !ctx.moved.has(assign.right)) return null;
        // v = v 恒等于无操作,无论 v 之后是否活跃都可以删除
        if (isIdentifier(assign.right) && assign.right.name === name) {
            this.removeRefs(assign.right, ctx);
            return { replace: null, remainingReads: new Set() };
        }
        if (live.has(name)) return null;
        const reads = this.tempReads(assign.right, ctx);
        const rhs = assign.right;
        if (ctx.moved.has(rhs)) {
            // 中间副本直接删除;最终落点若也是死代码,则保留有副作用的表达式
            const isFinalDestination = ctx.moved.get(rhs) === stmt;
            if (!isFinalDestination || isPureExpression(rhs) || isDeclarationValue(rhs)) {
                return { replace: null, remainingReads: new Set() };
            }
            return { replace: expressionStatement(rhs), remainingReads: reads };
        }
        if (isDeclarationValue(rhs)) {
            // 函数/类表达式需要保留,SyntaxRewriteSimplify/ClassSyntaxSimplify 会转成声明
            return { replace: expressionStatement(rhs), remainingReads: reads };
        }
        if (isPureExpression(rhs)) {
            this.removeRefs(rhs, ctx);
            return { replace: null, remainingReads: new Set() };
        }
        // 调用等有副作用:保留表达式本身
        return { replace: expressionStatement(rhs), remainingReads: reads };
    }
}
