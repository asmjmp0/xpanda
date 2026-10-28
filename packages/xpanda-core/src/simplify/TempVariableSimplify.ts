import { Program } from "@babel/types";
import { ISimplify } from "./ISimplify";
import traverse, { NodePath } from "@babel/traverse";
import * as TYPE from "@babel/types";
import {
    file,
    isAssignmentExpression,
    isBlockStatement,
    isExpressionStatement,
    isForInStatement,
    isForOfStatement,
    isIdentifier,
    isMemberExpression,
    isNodesEquivalent,
    isOptionalMemberExpression,
    isProgram as isProgramNode,
    isReturnStatement,
    isUpdateExpression,
    isVariableDeclaration,
} from "@babel/types";
import {
    addPatternNames,
    collectIdentifierNames,
    isClassLike,
    isFunctionLike,
    isPureExpression,
    isTempName,
    walkNode,
} from "./AstUtils";
import { EnvState } from "./temp/env";
import { LivenessAnalyzer } from "./temp/liveness";
import { AssignmentFolds } from "./temp/assignment-folds";
import { ConditionFolds } from "./temp/condition-folds";
import { TestFolds } from "./temp/test-folds";
import { CopyPropagation } from "./temp/copy-propagation";
import {
    BindingInfo,
    CLONE_BUDGET,
    FunctionContext,
    PassState,
    createPassState,
} from "./temp/types";
import { isCapturedBinding } from "./temp/queries";
import { removeRefs, renameCatchParameters } from "./temp/context";

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
 * 具体实现按职责拆到 ./temp/ 下:复制传播、活跃性、赋值折叠、条件折叠、test 折叠。
 *
 * @Author: jmp0
 */
export class TempVariableSimplify implements ISimplify {
    private readonly state: PassState = createPassState();
    private readonly liveness = new LivenessAnalyzer(this.state);
    private readonly assignments = new AssignmentFolds(this.state);
    private readonly conditions = new ConditionFolds(this.state);
    private readonly testFolds = new TestFolds(this.state);
    private readonly copy = new CopyPropagation(this.state);

    simplify(node: Program): boolean {
        this.state.changed = false;
        this.state.conditionsOnly = false;
        traverse(file(node), {
            Program: (path) => this.processScope(path),
            Function: (path) => this.processScope(path),
        });
        return this.state.changed;
    }

    /**
     * 只折叠条件赋值模式。HighLevelGrammarSimplify 会把
     * `if (!X) { X = true } else { X = false }` 合成为 `X = !X`,
     * 与 callruntime.isfalse 生成的 `X = !X` 构成连续自取反链,
     * 需要在流水线末尾补一轮。此时不再做复制传播,避免推翻已稳定的输出。
     */
    static foldConditionAssignments(node: Program): boolean {
        const pass = new TempVariableSimplify();
        pass.state.changed = false;
        pass.state.conditionsOnly = true;
        traverse(file(node), {
            Program: (path) => pass.processScope(path),
            Function: (path) => pass.processScope(path),
        });
        return pass.state.changed;
    }

    /**
     * 只做活跃性死存储消除和未用声明清理(不做复制传播/条件折叠)。
     *
     * 流水线末尾的整结构改写(重复尾块消除、else 展开、三目合成、条件 test
     * 归一化)会暴露出新的死存储:区域归约预装载寄存器的 `v7 = this.asRecord`
     * 在最终形态里往往“先在 test 里被重写、再被读取”,定点迭代阶段的活跃性
     * 看不到这种语句内部的求值顺序,轮到末尾时已经没有新一轮清理了。
     */
    public static cleanupDeadStores(node: Program): boolean {
        const pass = new TempVariableSimplify();
        pass.state.changed = false;
        pass.state.cleanupOnly = true;
        traverse(file(node), {
            Program: (path) => pass.processScope(path),
            Function: (path) => pass.processScope(path),
        });
        return pass.state.changed;
    }

    /**
     * 空 catch 的 try 体里,同一个成员读取被编译器写成两组赋值:
     *
     * ```
     * try {
     *   v5 = deviceInfo.sdkApiVersion;   // try 体内(异常路径需要)
     *   …
     *   v5 = deviceInfo.sdkApiVersion;   // 正常完成块(结果拷贝)
     * } catch {}
     * ```
     *
     * 前面一组在异常路径上必须保留(默认值已在 try 前/内),后面一组是正常完成
     * 的拷贝;两者引用同一个值,保留第一次读取既符合源码的读取次数/顺序,也避免
     * 重复触发 getter。只在空 catch 的平直语句段里做,遇到控制流/声明/调用即停止。
     */
    public static foldEmptyCatchDuplicateReads(node: Program): boolean {
        let changed = false;
        traverse(file(node), {
            TryStatement(path) {
                const tryNode = path.node;
                if (!tryNode.handler || tryNode.handler.body.type !== "BlockStatement") return;
                if (tryNode.handler.body.body.length !== 0) return;
                if (tryNode.block.type !== "BlockStatement") return;
                if (foldDuplicateMemberReads(tryNode.block.body)) changed = true;
            },
        });
        return changed;
    }

    /**
     * 删除完全未使用的块级词法变量声明(local_X_Y / sendable_X_Y)以及随之为空的块。
     *
     * newLexEnv 会为编译器预留的每个槽生成 `let local_X_Y`,但循环变量未被闭包捕获时
     * 槽可能从未被读写;块级声明又不在 TempVariableSimplify 的函数级 ctx.infos 里,
     * 旧的清理逻辑不会删除它们。这里按 Babel binding 精确判断(读写都为 0)。
     */
    public static removeUnusedLexicalDeclarations(node: Program, includeTemps = false): boolean {
        let changed = false;
        const pattern = includeTemps
            ? /^(acc|v\d+|(local|sendable)_\d+_\d+(_\d+)?)$/
            : /^(local|sendable)_\d+_\d+(_\d+)?$/;
        traverse(file(node), {
            VariableDeclaration(path) {
                const parent = path.parentPath;
                if (!parent || !(isBlockStatement(parent.node) || isProgramNode(parent.node))) return;
                const kept = path.node.declarations.filter((declarator) => {
                    if (!isIdentifier(declarator.id) || declarator.init) return true;
                    if (!pattern.test(declarator.id.name)) return true;
                    const binding = path.scope.getBinding(declarator.id.name);
                    if (!binding || binding.identifier !== declarator.id) return true;
                    if (!includeTemps) {
                        return binding.referencePaths.length !== 0 || binding.constantViolations.length !== 0;
                    }
                    // 复制传播替换掉读取后,binding 里会留下 node 已经为 null 的路径。
                    // 只认还挂在当前 AST 上、且不是声明自身的引用。
                    const live = (ref: { node: TYPE.Node | null }) => !!ref.node && ref.node !== declarator.id;
                    return binding.referencePaths.some(live) || binding.constantViolations.some(live);
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
        pass.state.changed = false;
        pass.state.shortCircuitOnly = true;
        traverse(file(node), {
            Program: (path) => pass.processScope(path),
            Function: (path) => pass.processScope(path),
        });
        return pass.state.changed;
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
        pass.state.changed = false;
        pass.state.returnsOnly = true;
        traverse(file(node), {
            Program: (path) => pass.processScope(path),
            Function: (path) => pass.processScope(path),
        });
        return pass.state.changed;
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
        pass.state.changed = false;
        pass.state.accumulatorOnly = true;
        traverse(file(node), {
            Program: (path) => pass.processScope(path),
            Function: (path) => pass.processScope(path),
        });
        return pass.state.changed;
    }

    /**
     * 只折叠 `X = E; <下一条语句里对 X 的唯一一次读取>`,其余一律不动。
     *
     * 可选链还原(`tryRestoreOptionalChain`)与 `??` 折叠发生在流水线尾部/三目
     * 合成之后,轮内的复制传播来不及把 `acc = v20?.client; v6 = f(acc)` 合并;
     * simplifyTail 之后补一轮。
     */
    static foldNextReadAssignments(node: Program): boolean {
        const pass = new TempVariableSimplify();
        pass.state.changed = false;
        pass.state.nextReadOnly = true;
        traverse(file(node), {
            Program: (path) => pass.processScope(path),
            Function: (path) => pass.processScope(path),
        });
        return pass.state.changed;
    }

    /**
     * 只折叠 hub 链 `X = F(X); C(X)`(X 在消费位置只读一次、之后已死),
     * 把 F(X) 代进 C。流水线尾部的结构改写会生成新的 hub 链(空 catch 汇合后的
     * 日志拼接 `v5 = "..."; v4 = v5 + ...; ...; f(v2)`),轮内折叠已经错过;
     * 这里在最后补一轮,并清理失去引用的声明。
     */
    static foldHubChains(node: Program): boolean {
        const pass = new TempVariableSimplify();
        pass.state.changed = false;
        pass.state.hubOnly = true;
        traverse(file(node), {
            Program: (path) => pass.processScope(path),
            Function: (path) => pass.processScope(path),
        });
        return pass.state.changed;
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
            const captured = isCapturedBinding(binding, path.node);
            infos.set(name, { name, refs, captured });
        }
        if (infos.size === 0) return;

        const ctx: FunctionContext = {
            infos,
            moved: new Map(),
            liveAfter: new Map(),
            cloneBudget: CLONE_BUDGET,
            returned: new Set(),
            branchLive: new Map(),
            loopBodyIn: new Map(),
            labels: new Map(),
            labelLive: new Map(),
        };
        if (renameCatchParameters(path, ctx)) this.state.changed = true;
        walkNode({ type: "BlockStatement", body } as TYPE.BlockStatement, (node) => {
            if (isFunctionLike(node) || isClassLike(node)) return false;
            if (node.type === "LabeledStatement") {
                // 同名标签(区域复制)以最后一个为准:活跃性按最近的标签位置计算。
                ctx.labels.set((node as TYPE.LabeledStatement).label.name, node);
                return true;
            }
            if (isReturnStatement(node) && node.argument) {
                for (const name of collectIdentifierNames(node.argument)) ctx.returned.add(name);
            }
            return true;
        });
        if (this.state.returnsOnly) {
            // 尾部三元合成后可能留下累加器链/临时变量别名(见 foldAccumulatorChains /
            // foldTempAliasAssignments),需要活跃性判断被搬移的旧值是否已死。
            this.liveness.analyzeList(body, new Set(), ctx);
            // 尾部三元合成后可能留下累加器链(见 foldAccumulatorChains),
            // 先折链再折 return,才能把整段拼接还原成单个表达式。
            this.assignments.foldReturnAssignments(body, ctx);
            this.removeUnusedDeclarations(body, ctx);
            return;
        }
        if (this.state.accumulatorOnly) {
            this.assignments.foldAccumulatorChainsDeep(body, ctx);
            return;
        }
        if (this.state.nextReadOnly) {
            this.liveness.analyzeList(body, new Set(), ctx);
            this.assignments.foldTempLastUseIntoNextRead(body, ctx);
            this.removeUnusedDeclarations(body, ctx);
            return;
        }
        if (this.state.hubOnly) {
            this.liveness.analyzeList(body, new Set(), ctx);
            this.assignments.foldSelfUpdateIntoNextRead(body, ctx);
            this.removeUnusedDeclarations(body, ctx);
            return;
        }
        if (this.state.cleanupOnly) {
            ctx.aggressiveCleanup = true;
            // 末尾结构改写后补一轮死存储清理:先分析活跃性再删(级联最多 3 轮)
            this.liveness.analyzeList(body, new Set(), ctx);
            for (let i = 0; i < 3; i++) {
                const version = this.state.cleanupVersion;
                this.liveness.cleanupStatements(body, ctx, new Set());
                if (this.state.cleanupVersion === version) break;
            }
            this.removeUnusedDeclarations(body, ctx);
            return;
        }
        if (this.state.shortCircuitOnly) {
            this.testFolds.foldShortCircuitChains(body, ctx);
            this.removeUnusedDeclarations(body, ctx);
            return;
        }
        // 复制传播前先算一遍活跃性,用于判断某次读取是否是当前值的最后一次使用
        this.liveness.analyzeList(body, new Set(), ctx);
        if (!this.state.conditionsOnly) {
            // 自引用链(`X = X.length; X = f(X)`)先折叠,让后续活跃性/传播看到更紧凑的形态
            this.testFolds.foldSelfReadChains(body, ctx);
            // `X = F(X); Y = <只读一次 X>`:把更新值代进读取位置,分支里只剩一条赋值,
            // 后续三目合成才能还原出 `pending.substring(nl + 1)` 这类形态。
            this.assignments.foldSelfUpdateIntoNextRead(body, ctx);
            this.copy.processStatements(body, new EnvState(), ctx);
            // do { ...; X = E; } while (!X) -> do { ... } while (!E)
            this.conditions.foldDoWhileTestAssignments(body, ctx);
            // 复制传播结束后做基于活跃性的死存储消除;最多 3 轮处理级联死代码
            for (let i = 0; i < 3; i++) {
                const version = this.state.cleanupVersion;
                this.liveness.cleanupStatements(body, ctx, new Set());
                if (this.state.cleanupVersion === version) break;
            }
            this.testFolds.cleanupSequenceExpressions(body, ctx);
        }
        this.testFolds.foldTestSequences(body, ctx);
        if (this.state.conditionsOnly) this.conditions.foldBooleanAliasAssignments(body, ctx);
        this.conditions.cleanupConditionAssignments(body, ctx);
        if (!this.state.conditionsOnly) {
            // `while (true) { X = E; if (COND) break; ... }` -> `while (!COND) { ... }`。
            // 放在条件折叠之后:守卫前的死保存/条件物化要先并进 if test,否则
            // HighLevelGrammarSimplify 的 for/for-in 还原看不到以 if 开头的循环体。
            this.testFolds.foldWhileTrueBreakGuards(body, ctx);
            // 循环 test 是表达式序列,不在语句列表里,单独的活跃性/死存储逻辑覆盖不到它:
            //   do { ... } while ((acc = f(v), v = acc, acc = !(acc !== undefined), v === undefined) || ...)
            // 守卫提成 test 后同样要靠它清理新生成的序列。
            this.testFolds.foldLoopTestTemps(body, ctx);
            this.testFolds.foldShortCircuitChains(body, ctx);
            this.assignments.foldReturnAssignments(body, ctx);
            this.assignments.hoistNamedFunctionExpressions(body, ctx, scope);
            this.assignments.foldSplitStringArrays(body, ctx);
        }
        this.removeUnusedDeclarations(body, ctx);
    }

    /**
     * `let X;` 与紧随其后的 `X = RHS;` 合并为 `let X = RHS;`。
     *
     * 生成器把整组寄存器/词法槽先声明成无初始化的 `let`,再逐条赋值,输出里留下
     * `let local_0_0; local_0_0 = "content_filter_views";` 这样的两段式。赋值语句
     * 是复制传播、模块类定义折叠(`local_1_0 = acc` 别名链)、静态初始化接收链
     * 回溯等 pass 的输入形态,合并必须放在它们全部结束之后做(见 SimplifyExport)。
     *
     * 安全规则:
     *   1. 只处理语句列表位置(Program/BlockStatement body)的 let/var 声明,
     *      且每个 declarator 都是无初始化的标识符(生成器输出的固定形态);
     *   2. 声明之后必须是连续的 `名字 = 右值` 赋值前缀,目标都在声明组里;
     *      中间插入任何其它语句即停止——把赋值搬过它会重排副作用的求值顺序;
     *   3. 右值不得出现声明组里"尚未初始化"的名字(保守起见嵌套函数里的出现
     *      也算读取):合并后这些名字处于 TDZ,读取从 undefined 变成 ReferenceError
     *      (`let X; X = X + 1` 是 NaN,`let X = X + 1` 直接抛错);
     *   4. 未合并的名字保持在最前(声明位置不变,TDZ 边界不后移),合并的按赋值
     *      顺序输出——这样每条合并声明恰好落在原赋值语句的位置上,求值顺序零重排。
     */
    public static mergeDeclarationInitializers(node: Program): boolean {
        const lists: TYPE.Statement[][] = [];
        walkNode(node, (n) => {
            if (isProgramNode(n) || isBlockStatement(n)) lists.push((n as TYPE.BlockStatement).body);
            return true;
        });
        let changed = false;
        for (const list of lists) {
            if (mergeDeclarationInitializersInList(list)) changed = true;
        }
        return changed;
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
                        // refs 在语句被删掉或替换后不会同步清空。当前 AST 里这个名字
                        // 只剩声明本身(nameCount)、且没有被闭包捕获时,声明就是死的。
                        if (!info || info.captured) return true;
                        if (written.has(name)) return true;
                        if (declarator.init && !isPureExpression(declarator.init)) return true;
                        if (declarator.init) removeRefs(declarator.init, ctx);
                        this.state.changed = true;
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
}

/**
 * 右值里是否出现 names 中"尚未初始化"的名字。不跳过嵌套函数:闭包体里的出现
 * 也可能只是立刻执行的 IIFE(`X = (function () { return X; })()`),合并后该
 * 读取会从 undefined 变成 TDZ ReferenceError,宁可放弃合并。
 */
function referencesUninitializedName(
    node: TYPE.Node | null | undefined,
    names: Set<string>,
    initialized: Set<string>,
): boolean {
    let found = false;
    walkNode(node, (n) => {
        if (found) return false;
        if (isIdentifier(n) && names.has(n.name) && !initialized.has(n.name)) {
            found = true;
            return false;
        }
        return true;
    });
    return found;
}

/** 合并一个语句列表里的 `let X; X = RHS;`;返回是否修改。规则见 mergeDeclarationInitializers。 */
function mergeDeclarationInitializersInList(list: TYPE.Statement[]): boolean {
    let changed = false;
    for (let i = 0; i < list.length; i++) {
        const decl = list[i];
        if (!isVariableDeclaration(decl) || (decl.kind !== "let" && decl.kind !== "var")) continue;

        // 形态检查:所有 declarator 都是无初始化的标识符,且组内无重名
        const declarators = new Map<string, TYPE.VariableDeclarator>();
        let wellFormed = true;
        for (const d of decl.declarations) {
            if (!isIdentifier(d.id) || d.init || declarators.has(d.id.name)) {
                wellFormed = false;
                break;
            }
            declarators.set(d.id.name, d);
        }
        if (!wellFormed) continue;
        const groupNames = new Set<string>(declarators.keys());

        // 从声明后连续的 `名字 = 右值` 赋值前缀里收集可合并的赋值(首个不满足即停)
        const merged: Array<{ name: string; value: TYPE.Expression }> = [];
        const initialized = new Set<string>();
        let j = i + 1;
        for (; j < list.length; j++) {
            const stmt = list[j];
            if (!isExpressionStatement(stmt) || !isAssignmentExpression(stmt.expression)) break;
            const assign = stmt.expression;
            if (assign.operator !== "=" || !isIdentifier(assign.left)) break;
            const name = assign.left.name;
            if (!groupNames.has(name) || initialized.has(name)) break;
            if (referencesUninitializedName(assign.right, groupNames, initialized)) break;
            merged.push({ name, value: assign.right });
            initialized.add(name);
        }
        if (merged.length === 0) continue;

        // 未合并的名字保持在最前,合并的按赋值顺序输出,整段替换原声明 + 被消费的赋值
        const newStatements: TYPE.VariableDeclaration[] = [];
        const unmerged = decl.declarations.filter(
            (d) => !initialized.has((d.id as TYPE.Identifier).name));
        if (unmerged.length > 0) newStatements.push(TYPE.variableDeclaration(decl.kind, unmerged));
        for (const m of merged) {
            const declarator = declarators.get(m.name)!;
            declarator.init = m.value;
            newStatements.push(TYPE.variableDeclaration(decl.kind, [declarator]));
        }
        list.splice(i, 1 + merged.length, ...newStatements);
        changed = true;
        i += newStatements.length - 1; // for 的 i++ 跳过刚插入的语句
    }
    return changed;
}

/**
 * 在平直的语句段里去掉重复的 `X = obj.prop`(X 为 temp,右侧是同一个成员读取)。
 * 遇到非赋值语句/声明/非成员右值就清空记录,避免跨越控制流误删。
 */
function foldDuplicateMemberReads(statements: TYPE.Statement[]): boolean {
    const seen = new Map<string, TYPE.Expression>();
    const remove: number[] = [];
    for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i];
        if (stmt.type !== "ExpressionStatement") { seen.clear(); continue; }
        const expr = stmt.expression;
        if (!isAssignmentExpression(expr) || expr.operator !== "="
            || !isIdentifier(expr.left) || !isTempName(expr.left.name)
            || !(isMemberExpression(expr.right) || isOptionalMemberExpression(expr.right))) {
            seen.clear();
            continue;
        }
        const name = expr.left.name;
        const previous = seen.get(name);
        if (previous && isNodesEquivalent(previous, expr.right)) {
            remove.push(i);
            continue;
        }
        const written = collectIdentifierNames(expr.left);
        for (const [key, value] of Array.from(seen.entries())) {
            if (written.has(key) || Array.from(collectIdentifierNames(value)).some((dep) => written.has(dep))) {
                seen.delete(key);
            }
        }
        seen.set(name, expr.right);
    }
    for (let i = remove.length - 1; i >= 0; i--) statements.splice(remove[i], 1);
    return remove.length > 0;
}
