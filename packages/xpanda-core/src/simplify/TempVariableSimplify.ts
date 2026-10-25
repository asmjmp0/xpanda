import { Program } from "@babel/types";
import { ISimplify } from "./ISimplify";
import traverse, { NodePath } from "@babel/traverse";
import * as TYPE from "@babel/types";
import {
    file,
    isAssignmentExpression,
    isBlockStatement,
    isForInStatement,
    isForOfStatement,
    isIdentifier,
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
        };
        if (renameCatchParameters(path, ctx)) this.state.changed = true;
        walkNode({ type: "BlockStatement", body } as TYPE.BlockStatement, (node) => {
            if (isFunctionLike(node) || isClassLike(node)) return false;
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
