import { Program } from "@babel/types";
import { ISimplify } from "./ISimplify";
import traverse, { NodePath } from "@babel/traverse";
import * as TYPE from "@babel/types";
import {
    addPatternNames,
    collectAssignedNames,
    collectIdentifierNames,
    collectReadNames,
    isClassLike,
    isCopyable,
    isDeclarationValue,
    isFunctionLike,
    isPureExpression,
    isTempName,
    nodeSize,
    walkNode,
} from "./AstUtils";

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
}

class EnvState {
    readonly map = new Map<string, EnvEntry>();
    private readonly deps = new Map<string, Set<string>>();

    get(name: string): EnvEntry | undefined {
        return this.map.get(name);
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
            const entry = this.map.get(current);
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

    simplify(node: Program): boolean {
        this.changed = false;
        this.conditionsOnly = false;
        traverse(TYPE.file(node), {
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
        traverse(TYPE.file(node), {
            Program: (path) => pass.processScope(path),
            Function: (path) => pass.processScope(path),
        });
        return pass.changed;
    }

    private processScope(path: NodePath<TYPE.Program> | NodePath<TYPE.Function>): void {
        const scope = path.scope;
        const body: TYPE.Statement[] | null = TYPE.isProgram(path.node)
            ? path.node.body
            : (TYPE.isBlockStatement(path.node.body) ? path.node.body.body : null);
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
        };
        this.renameCatchParameters(path, ctx);
        walkNode({ type: "BlockStatement", body } as TYPE.BlockStatement, (node) => {
            if (isFunctionLike(node) || isClassLike(node)) return false;
            if (TYPE.isReturnStatement(node) && node.argument) {
                for (const name of collectIdentifierNames(node.argument)) ctx.returned.add(name);
            }
            return true;
        });
        // 复制传播前先算一遍活跃性,用于判断某次读取是否是当前值的最后一次使用
        this.analyzeList(body, new Set(), ctx);
        if (!this.conditionsOnly) {
            this.processStatements(body, new EnvState(), ctx);
            // 复制传播结束后做基于活跃性的死存储消除;最多 3 轮处理级联死代码
            for (let i = 0; i < 3; i++) {
                const version = this.cleanupVersion;
                this.cleanupStatements(body, ctx, new Set());
                if (this.cleanupVersion === version) break;
            }
            this.cleanupSequenceExpressions(body, ctx);
        }
        this.foldTestSequences(body, ctx);
        this.cleanupConditionAssignments(body, ctx);
        if (!this.conditionsOnly) {
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
        for (let i = stmts.length - 2; i >= 0; i--) {
            const assignStmt = stmts[i];
            const returnStmt = stmts[i + 1];
            if (!TYPE.isExpressionStatement(assignStmt) || !TYPE.isAssignmentExpression(assignStmt.expression)) continue;
            const assign = assignStmt.expression;
            if (assign.operator !== "=" || !TYPE.isIdentifier(assign.left)) continue;
            if (!TYPE.isReturnStatement(returnStmt) || !TYPE.isIdentifier(returnStmt.argument)) continue;
            if (returnStmt.argument.name !== assign.left.name) continue;
            // 直接读取右值里的 X(如 new Promise(acc))在赋值前求值,折叠后仍是同一个旧值;
            // 若右值会写入 X(X++ / X = ...),折叠会改变写入次数,直接跳过。
            if (collectAssignedNames(assign.right).has(assign.left.name)) continue;
            // 只有闭包/类字段里延迟读取 X 时,赋值是否发生才会影响结果,必须保守跳过。
            if (this.hasDeferredSelfReference(assign.right, assign.left.name)) continue;
            ctx.infos.get(assign.left.name)?.refs.delete(returnStmt.argument);
            returnStmt.argument = assign.right;
            stmts.splice(i, 1);
            this.changed = true;
            i--;
        }
    }

    /** 右值中是否存在位于函数/类内部、可能在赋值之后才执行的同名读取。 */
    private hasDeferredSelfReference(node: TYPE.Node | null | undefined, name: string): boolean {
        let found = false;
        const visit = (current: TYPE.Node | null | undefined, inDeferred: boolean): void => {
            if (found || !current || typeof (current as any).type !== "string") return;
            if (inDeferred && TYPE.isIdentifier(current) && current.name === name) {
                found = true;
                return;
            }
            const nested = inDeferred || isFunctionLike(current) || isClassLike(current);
            const keys = (TYPE.VISITOR_KEYS as any)[current.type] as string[] | undefined;
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
            if (!TYPE.isExpressionStatement(stmt) || !TYPE.isAssignmentExpression(stmt.expression)) continue;
            const assign = stmt.expression;
            if (assign.operator !== "=" || !TYPE.isIdentifier(assign.left)) continue;
            if (!/^local_\d+_\d+$/.test(assign.left.name)) continue;
            if (TYPE.isFunctionExpression(assign.right) && assign.right.id) return true;
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
        const isProgram = TYPE.isProgram(functionNode);
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
                if (TYPE.isIdentifier(node)) {
                    nameCounts.set(node.name, (nameCounts.get(node.name) || 0) + 1);
                }
                if (TYPE.isAssignmentExpression(node) && TYPE.isIdentifier(node.left)) {
                    let list = writes.get(node.left.name);
                    if (!list) { list = []; writes.set(node.left.name, list); }
                    list.push(stmt);
                } else if (TYPE.isUpdateExpression(node) && TYPE.isIdentifier(node.argument)) {
                    let list = writes.get(node.argument.name);
                    if (!list) { list = []; writes.set(node.argument.name, list); }
                    list.push(stmt);
                }
                return true;
            });
        }

        const candidates: Array<{ stmt: TYPE.Statement; name: string; fn: TYPE.FunctionExpression }> = [];
        for (const stmt of stmts) {
            if (!TYPE.isExpressionStatement(stmt) || !TYPE.isAssignmentExpression(stmt.expression)) continue;
            const assign = stmt.expression;
            if (assign.operator !== "=" || !TYPE.isIdentifier(assign.left)) continue;
            const name = assign.left.name;
            if (!/^local_\d+_\d+$/.test(name)) continue;
            if (!TYPE.isFunctionExpression(assign.right) || !assign.right.id) continue;
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
                if (TYPE.isIdentifier(ref)) ref.name = functionName;
            }
            info.refs.clear();
            stmts[index] = TYPE.functionDeclaration(fn.id!, fn.params, fn.body, fn.generator, fn.async);
            this.removeDeclarator(stmts, name);
            this.changed = true;
        }
    }

    private countIdentifiers(node: TYPE.Node, name: string): number {
        let count = 0;
        walkNode(node, (child) => {
            if (TYPE.isIdentifier(child) && child.name === name) count++;
            return true;
        });
        return count;
    }

    /** X = "abcdef".split(""); ... X[i] ... -> 直接使用 "abcdef"[i],删除 X。 */
    private foldSplitStringArrays(stmts: TYPE.Statement[], ctx: FunctionContext): void {
        for (let i = stmts.length - 1; i >= 0; i--) {
            const stmt = stmts[i];
            if (!TYPE.isExpressionStatement(stmt) || !TYPE.isAssignmentExpression(stmt.expression)) continue;
            const assign = stmt.expression;
            if (assign.operator !== "=" || !TYPE.isIdentifier(assign.left)) continue;
            if (!TYPE.isCallExpression(assign.right) || !TYPE.isMemberExpression(assign.right.callee)) continue;
            const callee = assign.right.callee;
            if (!TYPE.isStringLiteral(callee.object)) continue;
            const property = callee.property;
            const method = !callee.computed && TYPE.isIdentifier(property) ? property.name
                : (TYPE.isStringLiteral(property) ? property.value : "");
            if (method !== "split" || assign.right.arguments.length !== 1) continue;
            const separator = assign.right.arguments[0];
            if (!TYPE.isStringLiteral(separator) || separator.value !== "") continue;

            const name = assign.left.name;
            if (!isTempName(name)) continue;

            // 允许清理候选之前的 local = undefined/hole 死赋值;其余写入都会使折叠不安全
            let candidateIndex = i;
            let canFold = true;
            for (let j = stmts.length - 1; j >= 0; j--) {
                if (j === candidateIndex) continue;
                const other = stmts[j];
                if (TYPE.isExpressionStatement(other) && TYPE.isAssignmentExpression(other.expression)
                    && TYPE.isIdentifier(other.expression.left) && other.expression.left.name === name) {
                    const rhs = other.expression.right;
                    const isUndefined = (TYPE.isIdentifier(rhs) && (rhs.name === "undefined" || rhs.name === "hole"))
                        || (TYPE.isUnaryExpression(rhs) && rhs.operator === "void");
                    if (j < candidateIndex && isUndefined) {
                        stmts.splice(j, 1);
                        candidateIndex--;
                    } else {
                        canFold = false;
                        break;
                    }
                } else if (TYPE.isUpdateExpression(other) || (TYPE.isForInStatement(other) || TYPE.isForOfStatement(other))) {
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
                if (!TYPE.isIdentifier(node) || node.name !== name) return true;
                if (parent && TYPE.isVariableDeclarator(parent) && parent.id === node) return true;
                if (parent && TYPE.isMemberExpression(parent) && parent.object === node && parent.computed) {
                    members.push(parent);
                    return false;
                }
                valid = false;
                return false;
            });
            if (!valid || members.length === 0) continue;

            for (const member of members) member.object = TYPE.stringLiteral(value);
            ctx.infos.get(name)?.refs.clear();
            stmts.splice(candidateIndex, 1);
            this.removeDeclarator(stmts, name);
            this.changed = true;
        }
    }

    private hasWriteAnywhere(stmts: TYPE.Statement[], name: string, candidate: TYPE.Statement): boolean {
        let found = false;
        for (const stmt of stmts) {
            walkNode(stmt, (node) => {
                if (found) return false;
                if (node === candidate) return false;
                if (TYPE.isAssignmentExpression(node) && TYPE.isIdentifier(node.left) && node.left.name === name) {
                    found = true;
                    return false;
                }
                if (TYPE.isUpdateExpression(node) && TYPE.isIdentifier(node.argument) && node.argument.name === name) {
                    found = true;
                    return false;
                }
                return true;
            });
        }
        return found;
    }

    private removeDeclarator(stmts: TYPE.Statement[], name: string): void {
        for (let i = stmts.length - 1; i >= 0; i--) {
            const stmt = stmts[i];
            if (!TYPE.isVariableDeclaration(stmt)) continue;
            const kept = stmt.declarations.filter((d) => !(TYPE.isIdentifier(d.id) && d.id.name === name));
            if (kept.length === stmt.declarations.length) continue;
            if (kept.length === 0) stmts.splice(i, 1);
            else stmt.declarations = kept;
        }
    }

    /** X = E; (X = !X;)? if (!X / X) -> if (E / !E) */
    private cleanupConditionAssignments(stmts: TYPE.Statement[], ctx: FunctionContext): void {
        for (let i = 0; i < stmts.length; i++) {
            const stmt = stmts[i];
            if (TYPE.isIfStatement(stmt)) {
                const pattern = this.matchConditionPattern(stmts, i, ctx);
                if (pattern) {
                    const { start, expr, invert } = pattern;
                    const oldTest = stmt.test;
                    stmt.test = invert ? TYPE.unaryExpression("!", expr) : expr;
                    // 只删除消失的引用:旧 test 和 X = !X 里的 X。
                    // E 被搬到 test 中,它的引用必须保留。
                    this.removeRefs(oldTest, ctx);
                    if (i - start > 1) {
                        // 删除整条 `X = !X` 取反链(可能有多条)里的引用
                        for (let j = start + 1; j < i; j++) {
                            const negation = stmts[j];
                            if (TYPE.isExpressionStatement(negation) && TYPE.isAssignmentExpression(negation.expression)) {
                                this.removeRefs(negation.expression.right, ctx);
                            }
                        }
                    }
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
                if (TYPE.isBlockStatement(stmt.consequent)) this.cleanupConditionAssignments(stmt.consequent.body, ctx);
                if (stmt.alternate) {
                    if (TYPE.isBlockStatement(stmt.alternate)) this.cleanupConditionAssignments(stmt.alternate.body, ctx);
                    else this.cleanupConditionChildren(stmt.alternate, ctx);
                }
                break;
            case "WhileStatement":
            case "DoWhileStatement":
            case "ForStatement":
            case "ForInStatement":
            case "ForOfStatement":
            case "LabeledStatement":
                if (TYPE.isBlockStatement(stmt.body)) this.cleanupConditionAssignments(stmt.body.body, ctx);
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
    ): { start: number; name: string; expr: TYPE.Expression; invert: boolean } | null {
        const ifStmt = stmts[ifIndex];
        if (!TYPE.isIfStatement(ifStmt)) return null;
        const test = ifStmt.test;
        let name: string;
        let testNegated = false;
        if (TYPE.isIdentifier(test)) {
            name = test.name;
        } else if (TYPE.isUnaryExpression(test) && test.operator === "!"
            && TYPE.isIdentifier(test.argument)) {
            name = test.argument.name;
            testNegated = true;
        } else {
            return null;
        }
        if (!isTempName(name)) return null;
        const info = ctx.infos.get(name);
        if (!info || info.captured) return null;

        let start = ifIndex - 1;
        let negations = 0;
        // 编译器把 if 条件里的取反 lowering 成 istrue + 分支 + ldtrue/ldfalse,
        // 反编译后会出现连续多条 `X = !X`(通常是 1~2 条)。按取反次数的奇偶性
        // 决定最终条件,避免把 `!T` 误当成 T 或只折叠一层。
        while (start >= 0) {
            const prev = stmts[start];
            if (!TYPE.isExpressionStatement(prev) || !TYPE.isAssignmentExpression(prev.expression)) break;
            const negation = prev.expression;
            if (negation.operator !== "="
                || !TYPE.isIdentifier(negation.left) || negation.left.name !== name
                || !TYPE.isUnaryExpression(negation.right) || negation.right.operator !== "!"
                || !TYPE.isIdentifier(negation.right.argument) || negation.right.argument.name !== name) break;
            negations++;
            start--;
        }
        if (start < 0) return null;
        const assign = stmts[start];
        if (!TYPE.isExpressionStatement(assign) || !TYPE.isAssignmentExpression(assign.expression)) return null;
        const expression = assign.expression;
        if (expression.operator !== "=" || !TYPE.isIdentifier(expression.left) || expression.left.name !== name) {
            return null;
        }
        if (isDeclarationValue(expression.right)) return null;

        // X 只能在当前模式里被读取,不能影响模式之后/之前的代码。
        // 但 acc 是字节码累加器,通常在整个函数里反复复用(模式之外还有大量读写),
        // 此时退一步:只要模式之后 X 已死、且 if 分支体不读取 X,删除这几条赋值仍然安全。
        const patternRefs = new Set<TYPE.Node>();
        for (let j = start; j <= ifIndex; j++) {
            walkNode(stmts[j], (node, parent) => {
                if (TYPE.isIdentifier(node) && node.name === name && parent && TYPE.isReferenced(node, parent)) {
                    patternRefs.add(node);
                }
            });
        }
        if (info.refs.size !== patternRefs.size) {
            for (const ref of patternRefs) if (!info.refs.has(ref)) return null;
            const liveAfterIf = ctx.liveAfter.get(ifStmt);
            if (!liveAfterIf || liveAfterIf.has(name)) return null;
            if (collectIdentifierNames(ifStmt.consequent).has(name)) return null;
            if (ifStmt.alternate && collectIdentifierNames(ifStmt.alternate).has(name)) return null;
        } else {
            for (const ref of patternRefs) if (!info.refs.has(ref)) return null;
        }

        return {
            start,
            name,
            expr: expression.right,
            invert: testNegated !== (negations % 2 === 1),
        };
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

    private foldBooleanExpr(expr: TYPE.Expression, stmt: TYPE.Statement, ctx: FunctionContext): TYPE.Expression {
        if (TYPE.isLogicalExpression(expr)) {
            expr.left = this.foldBooleanExpr(expr.left, stmt, ctx);
            expr.right = this.foldBooleanExpr(expr.right, stmt, ctx);
            return expr;
        }
        if (TYPE.isUnaryExpression(expr) && expr.operator === "!") {
            expr.argument = this.foldBooleanExpr(expr.argument as TYPE.Expression, stmt, ctx);
            return expr;
        }
        if (TYPE.isSequenceExpression(expr)) {
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
        stmt: TYPE.Statement,
        ctx: FunctionContext,
    ): TYPE.Expression | null {
        const exprs = seq.expressions;
        if (exprs.length < 2) return null;
        const last = exprs[exprs.length - 1];
        let name: string | null = null;
        let lastBang = false;
        if (TYPE.isIdentifier(last)) {
            name = last.name;
        } else if (TYPE.isUnaryExpression(last) && last.operator === "!"
            && TYPE.isIdentifier(last.argument)) {
            name = last.argument.name;
            lastBang = true;
        }
        if (name !== null && isTempName(name)) {
            // (X = E, X = !X, ..., X/!X)
            let neg = 0;
            let j = exprs.length - 2;
            while (j >= 0) {
                const e = exprs[j];
                if (TYPE.isAssignmentExpression(e) && e.operator === "="
                    && TYPE.isIdentifier(e.left) && e.left.name === name
                    && TYPE.isUnaryExpression(e.right) && e.right.operator === "!"
                    && TYPE.isIdentifier(e.right.argument) && e.right.argument.name === name) {
                    neg++;
                    j--;
                    continue;
                }
                break;
            }
            const base = j >= 0 ? exprs[j] : null;
            if (base && TYPE.isAssignmentExpression(base) && base.operator === "="
                && TYPE.isIdentifier(base.left) && base.left.name === name
                && !this.headReadsNameBeforeWrite(exprs, j, name)
                && this.isNameDeadAfterTest(stmt, name, ctx)
                && this.countReadsInNode(stmt, name) === this.countReadsInNode(seq, name)) {
                const parity = (neg + (lastBang ? 1 : 0)) % 2;
                const replacement = parity === 0 ? base.right : TYPE.unaryExpression("!", base.right);
                const kept = exprs.slice(0, j) as TYPE.Expression[];
                kept.push(replacement);
                return kept.length === 1 ? kept[0] : TYPE.sequenceExpression(kept);
            }
        }
        // (X = E, <last>) 且 E 无副作用、last 不读取 X、X 在 test 后已死:直接丢掉 X = E
        const base = exprs[exprs.length - 2];
        if (TYPE.isAssignmentExpression(base) && base.operator === "="
            && TYPE.isIdentifier(base.left) && isTempName(base.left.name)
            && isPureExpression(base.right)
            && !this.headReadsNameBeforeWrite(exprs, exprs.length - 2, base.left.name)
            && this.countReadsInNode(last, base.left.name) === 0
            && this.isNameDeadAfterTest(stmt, base.left.name, ctx)
            && this.countReadsInNode(stmt, base.left.name) === this.countReadsInNode(seq, base.left.name)) {
            const kept = exprs.slice(0, exprs.length - 2) as TYPE.Expression[];
            kept.push(last);
            return kept.length === 1 ? kept[0] : TYPE.sequenceExpression(kept);
        }
        return null;
    }

    /** 序列前缀是否可能在写入 name 之前读取它(循环里会把上一轮的值带进来)。 */
    private headReadsNameBeforeWrite(exprs: TYPE.Expression[], end: number, name: string): boolean {
        let killed = false;
        for (let i = 0; i < end; i++) {
            const e = exprs[i];
            if (TYPE.isAssignmentExpression(e) && e.operator === "="
                && TYPE.isIdentifier(e.left) && e.left.name === name) {
                if (!killed && this.countReadsInNode(e.right, name) > 0) return true;
                killed = true;
                continue;
            }
            if (!killed && this.countReadsInNode(e, name) > 0) return true;
        }
        return false;
    }

    /** X 在该 test 之后(含分支体)是否已经不再被读取。 */
    private isNameDeadAfterTest(stmt: TYPE.Statement, name: string, ctx: FunctionContext): boolean {
        if (!TYPE.isIfStatement(stmt)) return false;
        const liveAfter = ctx.liveAfter.get(stmt);
        if (!liveAfter || liveAfter.has(name)) return false;
        if (this.branchReadsNameBeforeWrite(stmt.consequent, name)) return false;
        if (this.branchReadsNameBeforeWrite(stmt.alternate, name)) return false;
        return true;
    }

    /** 清理 SequenceExpression 中的死赋值,例如 if 条件里的 (v0 = x, v1 = y, ...)。 */
    private cleanupSequenceExpressions(stmts: TYPE.Statement[], ctx: FunctionContext): void {
        for (const stmt of stmts) {
            // 整条语句的读取集合只算一次,避免多个 SequenceExpression 造成重复扫描
            const stmtLive = new Set<string>(ctx.liveAfter.get(stmt) || []);
            for (const name of this.tempReads(stmt, ctx)) stmtLive.add(name);
            walkNode(stmt, (node) => {
                if (isFunctionLike(node) || isClassLike(node)) return false;
                if (!TYPE.isSequenceExpression(node)) return true;

                const live = new Set(stmtLive);

                const kept: TYPE.Expression[] = [];
                for (let i = node.expressions.length - 1; i >= 0; i--) {
                    const expr = node.expressions[i];
                    const reads = this.tempReads(expr, ctx);
                    if (TYPE.isAssignmentExpression(expr) && expr.operator === "="
                        && TYPE.isIdentifier(expr.left) && isTempName(expr.left.name)) {
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
        walkNode({ type: "BlockStatement", body: stmts } as TYPE.BlockStatement, (node) => {
            if (isFunctionLike(node) || isClassLike(node)) return false;
            if (TYPE.isAssignmentExpression(node)) addPatternNames(node.left, written);
            else if (TYPE.isUpdateExpression(node) && TYPE.isIdentifier(node.argument)) written.add(node.argument.name);
            else if (TYPE.isForInStatement(node) || TYPE.isForOfStatement(node)) addPatternNames(node.left, written);
            return true;
        });

        const removeFrom = (list: TYPE.Statement[]): void => {
            for (let i = list.length - 1; i >= 0; i--) {
                const stmt = list[i];
                if (TYPE.isVariableDeclaration(stmt)) {
                    const kept = stmt.declarations.filter((declarator) => {
                        if (!TYPE.isIdentifier(declarator.id)) return true;
                        const name = declarator.id.name;
                        if (!isTempName(name)) return true;
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
                if (TYPE.isBlockStatement(stmt.consequent)) fn(stmt.consequent.body);
                if (stmt.alternate && TYPE.isBlockStatement(stmt.alternate)) fn(stmt.alternate.body);
                break;
            case "WhileStatement":
            case "DoWhileStatement":
            case "ForStatement":
            case "ForInStatement":
            case "ForOfStatement":
            case "LabeledStatement":
                if (TYPE.isBlockStatement(stmt.body)) fn(stmt.body.body);
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
            if (TYPE.isIdentifier(n)) ctx.infos.get(n.name)?.refs.delete(n);
        });
    }

    // ---------------------------------------------------------------- 语句

    /**
     * catch (acc) 的 acc 会遮蔽函数级 acc。把它重命名为独立的 catchAcc,
     * 避免优化器把 catch 参数和函数累加器 acc 混为一谈。
     */
    private renameCatchParameters(path: NodePath<TYPE.Program> | NodePath<TYPE.Function>, ctx: FunctionContext): void {
        const rootBody: TYPE.Node = TYPE.isProgram(path.node) ? path.node : path.node.body;
        let hasCatch = false;
        walkNode(rootBody, (node) => {
            if (node !== rootBody && (isFunctionLike(node) || isClassLike(node))) return false;
            if (TYPE.isCatchClause(node)) {
                hasCatch = true;
                return false;
            }
            return true;
        });
        if (!hasCatch) return;

        const currentFunction = TYPE.isProgram(path.node) ? null : path.node;
        path.traverse({
            CatchClause: (catchPath) => {
                const functionParent = catchPath.getFunctionParent();
                if ((functionParent ? functionParent.node : null) !== currentFunction) return;
                const param = catchPath.node.param;
                if (!TYPE.isIdentifier(param)) return;
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
                const writes = collectAssignedNames(stmt.consequent);
                if (stmt.alternate) for (const name of collectAssignedNames(stmt.alternate)) writes.add(name);
                this.processNestedStatement(stmt.consequent, env.copy(), ctx);
                if (stmt.alternate) this.processNestedStatement(stmt.alternate, env.copy(), ctx);
                for (const name of writes) env.invalidate(name);
                return;
            }
            case "WhileStatement": {
                const writes = collectAssignedNames(stmt.test);
                for (const name of collectAssignedNames(stmt.body)) writes.add(name);
                for (const name of writes) env.invalidate(name);
                stmt.test = this.rewriteExpr(stmt.test, env, list, index, ctx, false);
                this.processNestedStatement(stmt.body, env.copy(), ctx);
                for (const name of writes) env.invalidate(name);
                return;
            }
            case "DoWhileStatement": {
                const writes = collectAssignedNames(stmt.body);
                for (const name of collectAssignedNames(stmt.test)) writes.add(name);
                for (const name of writes) env.invalidate(name);
                this.processNestedStatement(stmt.body, env.copy(), ctx);
                stmt.test = this.rewriteExpr(stmt.test, env, list, index, ctx, false);
                for (const name of writes) env.invalidate(name);
                return;
            }
            case "ForStatement": {
                const writes = new Set<string>();
                if (stmt.init) for (const name of collectAssignedNames(stmt.init)) writes.add(name);
                for (const name of collectAssignedNames(stmt.test)) writes.add(name);
                if (stmt.update) for (const name of collectAssignedNames(stmt.update)) writes.add(name);
                for (const name of collectAssignedNames(stmt.body)) writes.add(name);
                for (const name of writes) env.invalidate(name);
                if (stmt.init) {
                    if (TYPE.isVariableDeclaration(stmt.init)) {
                        this.processVariableDeclaration(stmt.init, env, list, index, ctx);
                    } else {
                        stmt.init = this.processExpression(stmt.init, env, list, index, ctx);
                    }
                }
                stmt.test = this.rewriteExpr(stmt.test, env, list, index, ctx, false);
                if (stmt.update) stmt.update = this.processExpression(stmt.update, env.copy(), list, index, ctx, false);
                this.processNestedStatement(stmt.body, env.copy(), ctx);
                for (const name of writes) env.invalidate(name);
                return;
            }
            case "ForInStatement":
            case "ForOfStatement": {
                const writes = collectAssignedNames(stmt.left);
                for (const name of collectAssignedNames(stmt.body)) writes.add(name);
                for (const name of writes) env.invalidate(name);
                (stmt as TYPE.ForInStatement).right = this.rewriteExpr(
                    (stmt as TYPE.ForInStatement).right, env, list, index, ctx, true);
                this.processNestedStatement(stmt.body, env.copy(), ctx);
                for (const name of writes) env.invalidate(name);
                return;
            }
            case "BlockStatement":
                this.processStatements(stmt.body, env, ctx);
                return;
            case "LabeledStatement":
                this.processNestedStatement(stmt.body, env, ctx);
                return;
            case "TryStatement": {
                const writes = collectAssignedNames(stmt.block);
                if (stmt.handler) for (const name of collectAssignedNames(stmt.handler.body)) writes.add(name);
                if (stmt.finalizer) for (const name of collectAssignedNames(stmt.finalizer)) writes.add(name);
                this.processNestedStatement(stmt.block, env.copy(), ctx);
                if (stmt.handler) this.processNestedStatement(stmt.handler.body, env.copy(), ctx);
                if (stmt.finalizer) this.processNestedStatement(stmt.finalizer, env.copy(), ctx);
                for (const name of writes) env.invalidate(name);
                return;
            }
            case "SwitchStatement": {
                const writes = new Set<string>();
                for (const c of stmt.cases) for (const name of collectAssignedNames(c)) writes.add(name);
                stmt.discriminant = this.rewriteExpr(stmt.discriminant, env, list, index, ctx, true);
                for (const c of stmt.cases) {
                    const caseEnv = env.copy();
                    if (c.test) c.test = this.rewriteExpr(c.test, caseEnv, list, index, ctx, true);
                    this.processStatements(c.consequent, caseEnv, ctx);
                }
                for (const name of writes) env.invalidate(name);
                return;
            }
            case "ReturnStatement":
            case "ThrowStatement":
                if (stmt.argument) {
                    stmt.argument = this.rewriteExpr(stmt.argument, env, list, index, ctx, true);
                }
                return;
            case "ExportNamedDeclaration":
                if (stmt.declaration && TYPE.isVariableDeclaration(stmt.declaration)) {
                    this.processVariableDeclaration(stmt.declaration, env, list, index, ctx);
                }
                return;
            case "ExportDefaultDeclaration":
                if (stmt.declaration && !isFunctionLike(stmt.declaration) && !isClassLike(stmt.declaration)
                    && TYPE.isExpression(stmt.declaration)) {
                    stmt.declaration = this.rewriteExpr(stmt.declaration, env, list, index, ctx, false);
                }
                return;
            default:
                return;
        }
    }

    private processNestedStatement(stmt: TYPE.Statement, env: EnvState, ctx: FunctionContext): void {
        if (TYPE.isBlockStatement(stmt)) {
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
            if (!TYPE.isIdentifier(declarator.id)) {
                if (declarator.init) declarator.init = this.rewriteExpr(declarator.init, env, list, index, ctx, false);
                continue;
            }
            const name = declarator.id.name;
            env.invalidate(name);
            if (!declarator.init) continue;

            // let Y = X; 当 X 当前值是 class/function/new/call 等不可复制值时,
            // 直接把值搬到 Y 的初始化里,避免多一个临时变量。
            if (TYPE.isIdentifier(declarator.init) && declarator.init.name !== name) {
                const sourceName = declarator.init.name;
                const sourceEntry = env.get(sourceName);
                const sourceInfo = ctx.infos.get(sourceName);
                if (sourceEntry && sourceInfo && !sourceInfo.captured
                    && sourceEntry.unsubstitutedReads <= 1
                    && sourceEntry.list === list && sourceEntry.index < index
                    && this.isSafeToMoveBetween(list, sourceEntry.index + 1, index)) {
                    const definition = sourceEntry.list[sourceEntry.index];
                    const isSimpleDefinition = TYPE.isExpressionStatement(definition)
                        && TYPE.isAssignmentExpression(definition.expression)
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
                                expr: TYPE.identifier(name),
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
        if (TYPE.isAssignmentExpression(expr)) {
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
        if (assign.operator === "=" && TYPE.isIdentifier(assign.left) && TYPE.isIdentifier(assign.right)
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
                const isSimpleDefinition = TYPE.isExpressionStatement(definition)
                    && TYPE.isAssignmentExpression(definition.expression)
                    && definition.expression.operator === "="
                    && definition.expression.right === sourceEntry.expr;
                const deps = collectIdentifierNames(sourceEntry.expr);
                const liveAfterMove = ctx.liveAfter.get(list[index]);
                if (isSimpleDefinition && TYPE.isNewExpression(sourceEntry.expr)
                    && !deps.has(targetName)
                    && !(liveAfterMove && liveAfterMove.has(sourceName))) {
                    const value = sourceEntry.expr;
                    sourceInfo.refs.delete(assign.right);
                    ctx.moved.set(value, list[index]);
                    assign.right = value;
                    env.invalidate(sourceName);
                    this.define(env, targetName, value, list, index, ctx);
                    env.set(sourceName, {
                        expr: TYPE.identifier(targetName),
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

        const writes = new Set<string>();
        addPatternNames(assign.left, writes);
        for (const name of writes) env.invalidate(name);
        if (assign.operator === "=" && TYPE.isIdentifier(assign.left)) {
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
        if (TYPE.isIdentifier(node)) return;
        if (TYPE.isMemberExpression(node) || TYPE.isOptionalMemberExpression(node)) {
            node.object = this.rewriteExpr(node.object as TYPE.Expression, env, list, index, ctx, false);
            if (node.computed) {
                node.property = this.rewriteExpr(node.property as TYPE.Expression, env, list, index, ctx, false);
            }
            return;
        }
        if (TYPE.isRestElement(node)) {
            this.rewriteLVal(node.argument as any, env, list, index, ctx);
        } else if (TYPE.isAssignmentPattern(node)) {
            this.rewriteLVal(node.left as any, env, list, index, ctx);
            node.right = this.rewriteExpr(node.right, env, list, index, ctx, false);
        } else if (TYPE.isArrayPattern(node)) {
            for (const e of node.elements) if (e) this.rewriteLVal(e as any, env, list, index, ctx);
        } else if (TYPE.isObjectPattern(node)) {
            for (const p of node.properties) {
                if (TYPE.isRestElement(p)) this.rewriteLVal(p.argument as any, env, list, index, ctx);
                else if (TYPE.isObjectProperty(p)) {
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
        if (TYPE.isIdentifier(node)) {
            return this.resolveIdentifier(node, env, list, index, ctx, allowImpure);
        }
        if (isFunctionLike(node)) return node;
        if (TYPE.isClassExpression(node)) {
            // 只处理 extends 表达式,不进入 class body(方法有独立作用域)
            if (node.superClass) {
                node.superClass = this.rewriteExpr(
                    node.superClass as TYPE.Expression, env, list, index, ctx, false);
            }
            return node;
        }
        if (TYPE.isClassDeclaration(node)) return node;

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
                const writes = new Set<string>();
                addPatternNames(n.left, writes);
                for (const name of writes) env.invalidate(name);
                if (n.operator === "=" && TYPE.isIdentifier(n.left)) {
                    const name = n.left.name;
                    if (isTempName(name) && ctx.infos.has(name)) this.define(env, name, n.right, list, index, ctx);
                }
                return n;
            }
            case "UpdateExpression": {
                const n = node as TYPE.UpdateExpression;
                if (TYPE.isIdentifier(n.argument)) {
                    env.invalidate(n.argument.name);
                } else {
                    this.rewriteLVal(n.argument as any, env, list, index, ctx);
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
                for (const name of collectAssignedNames(n.right)) env.invalidate(name);
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
                const writes = new Set<string>();
                collectAssignedNames(n.consequent, writes);
                collectAssignedNames(n.alternate, writes);
                for (const name of writes) env.invalidate(name);
                return n;
            }
            case "CallExpression":
            case "NewExpression": {
                const n = node as TYPE.CallExpression;
                n.callee = this.rewriteExpr(n.callee as TYPE.Expression, env, list, index, ctx, allowImpure) as any;
                let canMove = allowImpure && isPureExpression(n.callee as TYPE.Expression);
                n.arguments = n.arguments.map((arg) => {
                    if (TYPE.isSpreadElement(arg)) {
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
                    if (TYPE.isSpreadElement(e)) {
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
                    if (TYPE.isSpreadElement(p)) {
                        p.argument = this.rewriteExpr(p.argument, env, list, index, ctx, canMove);
                        if (canMove && !isPureExpression(p.argument)) canMove = false;
                        return p;
                    }
                    if (TYPE.isObjectProperty(p)) {
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
        const keys = (TYPE.VISITOR_KEYS as any)[node.type] as string[] | undefined;
        if (!keys) return node;
        for (const key of keys) {
            const value = (node as any)[key];
            if (Array.isArray(value)) {
                (node as any)[key] = value.map((child: any) =>
                    child && TYPE.isExpression(child)
                        ? this.rewriteExpr(child, env, list, index, ctx, false)
                        : child);
            } else if (value && TYPE.isExpression(value)) {
                (node as any)[key] = this.rewriteExpr(value, env, list, index, ctx, false);
            }
        }
        return node;
    }

    private registerCloneRefs(node: TYPE.Node, ctx: FunctionContext): void {
        walkNode(node, (n, parent) => {
            if (TYPE.isIdentifier(n) && parent && TYPE.isReferenced(n, parent)) {
                const info = ctx.infos.get(n.name);
                if (info) info.refs.add(n);
            }
        });
    }

    private isPureLVal(node: TYPE.LVal | TYPE.OptionalMemberExpression): boolean {
        if (TYPE.isIdentifier(node)) return true;
        if (TYPE.isMemberExpression(node) || TYPE.isOptionalMemberExpression(node)) {
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
        if (TYPE.isEmptyStatement(stmt)) return true;
        if (TYPE.isExpressionStatement(stmt)) {
            const expr = stmt.expression;
            if (TYPE.isAssignmentExpression(expr)) {
                return TYPE.isIdentifier(expr.left) && isPureExpression(expr.right);
            }
            return isPureExpression(expr);
        }
        if (TYPE.isVariableDeclaration(stmt)) {
            return stmt.declarations.every((d) => !d.init || isPureExpression(d.init));
        }
        if (TYPE.isBlockStatement(stmt)) {
            return stmt.body.every((s) => this.isPureStatement(s));
        }
        return false;
    }

    /**
     * 当前语句是否是 `x = x + ...` 形式的自覆盖,且读取的正是本次读取的节点。
     * 只对二元运算放开:这类累加链的旧值在本条语句后失效,可以安全搬移前一条语句的结果。
     */
    private statementOverwritesSelf(stmt: TYPE.Statement | undefined, name: string, id: TYPE.Identifier): boolean {
        if (!stmt || !TYPE.isExpressionStatement(stmt) || !TYPE.isAssignmentExpression(stmt.expression)) return false;
        const assign = stmt.expression;
        if (assign.operator !== "=" || !TYPE.isIdentifier(assign.left) || assign.left.name !== name) return false;
        if (!TYPE.isBinaryExpression(assign.right)) return false;
        return assign.right.left === id || assign.right.right === id;
    }

    /** 统计一条语句里对 name 的读取次数(不含嵌套函数,复合赋值左侧算读取)。 */
    private countReadsInNode(node: TYPE.Node | null | undefined, name: string): number {
        let count = 0;
        walkNode(node, (n, parent) => {
            if (isFunctionLike(n) || isClassLike(n)) return false;
            if (!TYPE.isIdentifier(n) || n.name !== name) return true;
            if (!parent || TYPE.isReferenced(n, parent)) count++;
            else if (TYPE.isAssignmentExpression(parent) && parent.left === n && parent.operator !== "=") count++;
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
     */
    private branchReadsNameBeforeWrite(stmt: TYPE.Statement | null | undefined, name: string): boolean {
        if (!stmt) return false;
        if (TYPE.isBlockStatement(stmt)) {
            for (const s of stmt.body) {
                if (this.definitelyWritesBeforeRead(s, name)) return false;
                if (collectReadNames(s).has(name)) return true;
                if (this.branchReadsNameBeforeWrite(s, name)) return true;
            }
            return false;
        }
        if (TYPE.isIfStatement(stmt)) {
            if (collectReadNames(stmt.test).has(name)) return true;
            return this.branchReadsNameBeforeWrite(stmt.consequent, name)
                || this.branchReadsNameBeforeWrite(stmt.alternate, name);
        }
        return collectReadNames(stmt).has(name);
    }

    /** 语句是否一定会在读取 name 之前写入 name(所有执行路径)。 */
    private definitelyWritesBeforeRead(stmt: TYPE.Statement | null | undefined, name: string): boolean {
        if (!stmt) return false;
        if (TYPE.isBlockStatement(stmt)) {
            for (const s of stmt.body) {
                if (this.definitelyWritesBeforeRead(s, name)) return true;
                if (collectReadNames(s).has(name)) return false;
            }
            return false;
        }
        if (TYPE.isIfStatement(stmt)) {
            if (collectReadNames(stmt.test).has(name)) return false;
            return stmt.alternate != null
                && this.definitelyWritesBeforeRead(stmt.consequent, name)
                && this.definitelyWritesBeforeRead(stmt.alternate, name);
        }
        if (TYPE.isExpressionStatement(stmt) && TYPE.isAssignmentExpression(stmt.expression)) {
            const assign = stmt.expression;
            return assign.operator === "=" && TYPE.isIdentifier(assign.left) && assign.left.name === name
                && !collectReadNames(assign.right).has(name);
        }
        return false;
    }

    /**
     * 当前 id 是否是所在语句里对该名字的最后一次读取。
     * 绝大多数语句里保持原来的保守判断;只有 if 的 test 读取且两个分支都会先写后读时,
     * 才允许把非纯右值搬进 test(例如 `acc = f(); if (acc) { ... acc = x; use(acc) }`)。
     */
    private isLastReadInStatement(stmt: TYPE.Statement | null | undefined, id: TYPE.Identifier): boolean {
        if (!stmt || this.countReadsInNode(stmt, id.name) <= 1) return true;
        if (!TYPE.isIfStatement(stmt) || !this.containsNode(stmt.test, id)) return false;
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
                const clone = TYPE.cloneNode(entry.expr, true) as TYPE.Expression;
                this.registerCloneRefs(clone, ctx);
                this.changed = true;
                return clone;
            }
        }

        // 当前值的最后一次读取:可以用克隆/搬移代替读取变量。
        // 注意 liveness 只看“名字是否还活着”,分不清 acc 的新旧版本:
        //   acc = f(); acc = x + acc; y = acc;
        // 第 2 条读取的是旧 acc,但旧值在本条语句结束后就被覆盖,因此也应视为 last use。
        const liveAfter = ctx.liveAfter.get(list[index]);
        const overwrittenHere = this.statementOverwritesSelf(list[index], id.name, id);
        // 同一个语句里可能还有别的读取(典型是 if 的 test 和分支体都读同一个
        // 临时变量)。只有分支在读取前会先覆盖该变量时,测试里的这次读取才算
        // 最后一次读取;否则搬移调用会复制一份调用。
        const lastUse = (overwrittenHere || (liveAfter != null && !liveAfter.has(id.name)))
            && this.isLastReadInStatement(list[index], id);
        if (lastUse && entry.unsubstitutedReads === 0) {
            if (isPureExpression(entry.expr) && !isDeclarationValue(entry.expr)) {
                // 数组/对象字面量:只在唯一使用处求值一次,原赋值稍后会被作为死存储删除
                info.refs.delete(id);
                let value = entry.expr;
                const size = nodeSize(value);
                if (size <= ctx.cloneBudget) {
                    ctx.cloneBudget -= size;
                    value = TYPE.cloneNode(value, true) as TYPE.Expression;
                    this.registerCloneRefs(value, ctx);
                } else {
                    ctx.moved.set(value, list[index]);
                }
                env.invalidate(id.name);
                this.changed = true;
                return value;
            }
            // 调用/构造/函数/类表达式:跨过的语句必须无副作用,保持求值顺序
            if (allowImpure && entry.list === list && entry.index < index
                && this.isSafeToMoveBetween(list, entry.index + 1, index)) {
                info.refs.delete(id);
                ctx.moved.set(entry.expr, list[index]);
                env.invalidate(id.name);
                this.changed = true;
                return entry.expr;
            }
        }

        entry.unsubstitutedReads++;
        return id;
    }

    // ---------------------------------------------------------------- 活跃性(传播前)

    private static sameSet(a: Set<string>, b: Set<string>): boolean {
        if (a.size !== b.size) return false;
        for (const name of a) if (!b.has(name)) return false;
        return true;
    }

    /** 不做任何修改的活跃性分析,结果写入 ctx.liveAfter。 */
    private analyzeList(stmts: TYPE.Statement[], liveOut: Set<string>, ctx: FunctionContext): Set<string> {
        const live = new Set(liveOut);
        for (let i = stmts.length - 1; i >= 0; i--) {
            const stmt = stmts[i];
            ctx.liveAfter.set(stmt, new Set(live));
            const before = this.transferLive(stmt, live, ctx);
            live.clear();
            for (const name of before) live.add(name);
        }
        return live;
    }

    private analyzeNested(stmt: TYPE.Statement, liveOut: Set<string>, ctx: FunctionContext): Set<string> {
        if (TYPE.isBlockStatement(stmt)) return this.analyzeList(stmt.body, liveOut, ctx);
        return this.transferLive(stmt, liveOut, ctx);
    }

    private transferLive(stmt: TYPE.Statement, liveOut: Set<string>, ctx: FunctionContext): Set<string> {
        switch (stmt.type) {
            case "ExpressionStatement":
            case "VariableDeclaration": {
                const reads = this.tempReads(stmt, ctx);
                const writes = this.tempWrites(stmt, ctx);
                const result = new Set(reads);
                for (const name of liveOut) if (!writes.has(name)) result.add(name);
                return result;
            }
            case "IfStatement": {
                const testReads = this.tempReads(stmt.test, ctx);
                const testWrites = this.tempWrites(stmt.test, ctx);
                const after = new Set<string>();
                for (const name of liveOut) if (!testWrites.has(name)) after.add(name);
                const consequentIn = this.analyzeNested(stmt.consequent, after, ctx);
                const alternateIn = stmt.alternate
                    ? this.analyzeNested(stmt.alternate, after, ctx)
                    : after;
                return TempVariableSimplify.union(testReads, consequentIn, alternateIn);
            }
            case "WhileStatement": {
                const testReads = this.tempReads(stmt.test, ctx);
                let bodyOut = TempVariableSimplify.union(liveOut, testReads);
                let bodyIn = this.analyzeNested(stmt.body, bodyOut, ctx);
                for (let k = 0; k < 4; k++) {
                    const next = TempVariableSimplify.union(bodyOut, bodyIn);
                    if (TempVariableSimplify.sameSet(next, bodyOut)) break;
                    bodyOut = next;
                    bodyIn = this.analyzeNested(stmt.body, bodyOut, ctx);
                }
                return TempVariableSimplify.union(testReads, bodyIn, liveOut);
            }
            case "DoWhileStatement": {
                const testReads = this.tempReads(stmt.test, ctx);
                let bodyOut = TempVariableSimplify.union(liveOut, testReads);
                let bodyIn = this.analyzeNested(stmt.body, bodyOut, ctx);
                for (let k = 0; k < 4; k++) {
                    const next = TempVariableSimplify.union(bodyOut, bodyIn);
                    if (TempVariableSimplify.sameSet(next, bodyOut)) break;
                    bodyOut = next;
                    bodyIn = this.analyzeNested(stmt.body, bodyOut, ctx);
                }
                return TempVariableSimplify.union(bodyIn, testReads, liveOut);
            }
            case "ForStatement": {
                const testReads = stmt.test ? this.tempReads(stmt.test, ctx) : new Set<string>();
                const updateReads = stmt.update ? this.tempReads(stmt.update, ctx) : new Set<string>();
                let bodyOut = TempVariableSimplify.union(liveOut, testReads, updateReads);
                let bodyIn = this.analyzeNested(stmt.body, bodyOut, ctx);
                for (let k = 0; k < 4; k++) {
                    const next = TempVariableSimplify.union(bodyOut, bodyIn);
                    if (TempVariableSimplify.sameSet(next, bodyOut)) break;
                    bodyOut = next;
                    bodyIn = this.analyzeNested(stmt.body, bodyOut, ctx);
                }
                const updateIn = stmt.update
                    ? this.transferLive(stmt.update as unknown as TYPE.Statement, TempVariableSimplify.union(bodyOut, bodyIn), ctx)
                    : new Set<string>();
                const afterInit = TempVariableSimplify.union(bodyIn, testReads, updateIn, liveOut);
                const initReads = stmt.init ? this.tempReads(stmt.init, ctx) : new Set<string>();
                const initWrites = stmt.init ? this.tempWrites(stmt.init, ctx) : new Set<string>();
                const result = new Set(initReads);
                for (const name of afterInit) if (!initWrites.has(name)) result.add(name);
                return result;
            }
            case "ForInStatement":
            case "ForOfStatement": {
                const rightReads = this.tempReads((stmt as TYPE.ForInStatement).right, ctx);
                let bodyOut = new Set(liveOut);
                let bodyIn = this.analyzeNested(stmt.body, bodyOut, ctx);
                for (let k = 0; k < 4; k++) {
                    const next = TempVariableSimplify.union(bodyOut, bodyIn);
                    if (TempVariableSimplify.sameSet(next, bodyOut)) break;
                    bodyOut = next;
                    bodyIn = this.analyzeNested(stmt.body, bodyOut, ctx);
                }
                return TempVariableSimplify.union(rightReads, bodyIn, liveOut);
            }
            case "BlockStatement":
                return this.analyzeList(stmt.body, liveOut, ctx);
            case "LabeledStatement":
                return this.analyzeNested(stmt.body, liveOut, ctx);
            case "TryStatement": {
                const finalizerReads = stmt.finalizer ? this.tempReads(stmt.finalizer, ctx) : new Set<string>();
                const after = TempVariableSimplify.union(liveOut, finalizerReads);
                const blockIn = this.analyzeNested(stmt.block, after, ctx);
                const handlerIn = stmt.handler
                    ? this.analyzeNested(stmt.handler.body, after, ctx)
                    : after;
                const finalizerIn = stmt.finalizer
                    ? this.analyzeNested(stmt.finalizer, liveOut, ctx)
                    : liveOut;
                return TempVariableSimplify.union(blockIn, handlerIn, finalizerIn, liveOut);
            }
            case "SwitchStatement": {
                const result = this.tempReads(stmt.discriminant, ctx);
                for (const c of stmt.cases) {
                    const caseIn = this.analyzeList(c.consequent, liveOut, ctx);
                    for (const name of caseIn) result.add(name);
                    for (const name of liveOut) result.add(name);
                }
                return result;
            }
            case "ReturnStatement":
            case "ThrowStatement":
                return this.tempReads(stmt.argument, ctx);
            case "ExportNamedDeclaration":
                if (stmt.declaration && TYPE.isStatement(stmt.declaration)) {
                    return this.transferLive(stmt.declaration as TYPE.Statement, liveOut, ctx);
                }
                return liveOut;
            case "ExportDefaultDeclaration":
                return this.tempReads(stmt.declaration as TYPE.Node, ctx);
            case "BreakStatement":
            case "ContinueStatement":
                return liveOut;
            default:
                return liveOut;
        }
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
    private cleanupStatements(stmts: TYPE.Statement[], ctx: FunctionContext, liveOut: Set<string>): Set<string> {
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
            const before = this.transfer(stmt, live, ctx);
            live.clear();
            for (const name of before) live.add(name);
        }
        return live;
    }

    private transfer(stmt: TYPE.Statement, liveOut: Set<string>, ctx: FunctionContext): Set<string> {
        switch (stmt.type) {
            case "ExpressionStatement":
            case "VariableDeclaration": {
                const reads = this.tempReads(stmt, ctx);
                const writes = this.tempWrites(stmt, ctx);
                const result = new Set(reads);
                for (const name of liveOut) if (!writes.has(name)) result.add(name);
                return result;
            }
            case "IfStatement": {
                // 分支的 live-out 就是 if 之后的 live-out。
                // 不能减去 test 的写入:test 里的临时赋值不会让分支里的同名赋值变成死代码
                // (例如 test 写 acc、两个分支也分别写 acc,而 if 之后还要读 acc)。
                const testReads = this.tempReads(stmt.test, ctx);
                const branchOut = new Set(liveOut);
                const consequentIn = this.cleanupNested(stmt.consequent, ctx, branchOut);
                const alternateIn = stmt.alternate
                    ? this.cleanupNested(stmt.alternate, ctx, branchOut)
                    : new Set(branchOut);
                return TempVariableSimplify.union(testReads, consequentIn, alternateIn);
            }
            case "WhileStatement": {
                const testReads = this.tempReads(stmt.test, ctx);
                let bodyOut = TempVariableSimplify.union(liveOut, testReads);
                let bodyIn = this.analyzeNested(stmt.body, bodyOut, ctx);
                for (let k = 0; k < 4; k++) {
                    const next = TempVariableSimplify.union(bodyOut, bodyIn);
                    if (TempVariableSimplify.sameSet(next, bodyOut)) break;
                    bodyOut = next;
                    bodyIn = this.analyzeNested(stmt.body, bodyOut, ctx);
                }
                const cleaned = this.cleanupNested(stmt.body, ctx, bodyOut);
                return TempVariableSimplify.union(testReads, cleaned, liveOut);
            }
            case "DoWhileStatement": {
                const testReads = this.tempReads(stmt.test, ctx);
                let bodyOut = TempVariableSimplify.union(liveOut, testReads);
                let bodyIn = this.analyzeNested(stmt.body, bodyOut, ctx);
                for (let k = 0; k < 4; k++) {
                    const next = TempVariableSimplify.union(bodyOut, bodyIn);
                    if (TempVariableSimplify.sameSet(next, bodyOut)) break;
                    bodyOut = next;
                    bodyIn = this.analyzeNested(stmt.body, bodyOut, ctx);
                }
                const cleaned = this.cleanupNested(stmt.body, ctx, bodyOut);
                return TempVariableSimplify.union(cleaned, testReads, liveOut);
            }
            case "ForStatement": {
                const testReads = stmt.test ? this.tempReads(stmt.test, ctx) : new Set<string>();
                const updateReads = stmt.update ? this.tempReads(stmt.update, ctx) : new Set<string>();
                let bodyOut = TempVariableSimplify.union(liveOut, testReads, updateReads);
                let bodyIn = this.analyzeNested(stmt.body, bodyOut, ctx);
                for (let k = 0; k < 4; k++) {
                    const next = TempVariableSimplify.union(bodyOut, bodyIn);
                    if (TempVariableSimplify.sameSet(next, bodyOut)) break;
                    bodyOut = next;
                    bodyIn = this.analyzeNested(stmt.body, bodyOut, ctx);
                }
                const cleaned = this.cleanupNested(stmt.body, ctx, bodyOut);
                const initReads = stmt.init ? this.tempReads(stmt.init, ctx) : new Set<string>();
                const initWrites = stmt.init ? this.tempWrites(stmt.init, ctx) : new Set<string>();
                const afterInit = TempVariableSimplify.union(cleaned, testReads, updateReads, liveOut);
                const result = new Set(initReads);
                for (const name of afterInit) if (!initWrites.has(name)) result.add(name);
                return result;
            }
            case "ForInStatement":
            case "ForOfStatement": {
                const rightReads = this.tempReads((stmt as TYPE.ForInStatement).right, ctx);
                let bodyOut = new Set(liveOut);
                let bodyIn = this.analyzeNested(stmt.body, bodyOut, ctx);
                for (let k = 0; k < 4; k++) {
                    const next = TempVariableSimplify.union(bodyOut, bodyIn);
                    if (TempVariableSimplify.sameSet(next, bodyOut)) break;
                    bodyOut = next;
                    bodyIn = this.analyzeNested(stmt.body, bodyOut, ctx);
                }
                const cleaned = this.cleanupNested(stmt.body, ctx, bodyOut);
                return TempVariableSimplify.union(rightReads, cleaned, liveOut);
            }
            case "BlockStatement":
                return this.cleanupStatements(stmt.body, ctx, liveOut);
            case "LabeledStatement":
                return this.cleanupNested(stmt.body, ctx, liveOut);
            case "TryStatement": {
                const finalizerReads = stmt.finalizer ? this.tempReads(stmt.finalizer, ctx) : new Set<string>();
                const afterFinalizer = TempVariableSimplify.union(liveOut, finalizerReads);
                const finalizerIn = stmt.finalizer
                    ? this.cleanupNested(stmt.finalizer, ctx, liveOut)
                    : liveOut;
                const handlerIn = stmt.handler
                    ? this.cleanupNested(stmt.handler.body, ctx, afterFinalizer)
                    : afterFinalizer;
                const blockIn = this.cleanupNested(stmt.block, ctx, afterFinalizer);
                return TempVariableSimplify.union(blockIn, handlerIn, finalizerIn, liveOut);
            }
            case "SwitchStatement": {
                const reads = this.tempReads(stmt.discriminant, ctx);
                const result = new Set(reads);
                for (const c of stmt.cases) {
                    const caseIn = this.cleanupStatements(c.consequent, ctx, liveOut);
                    for (const name of caseIn) result.add(name);
                    for (const name of liveOut) result.add(name);
                }
                return result;
            }
            case "ReturnStatement":
            case "ThrowStatement":
                // return/throw 之后没有代码,只有返回表达式里的读取需要保留
                return this.tempReads(stmt.argument, ctx);
            case "ExportNamedDeclaration":
                if (stmt.declaration) return this.transfer(stmt.declaration as TYPE.Statement, liveOut, ctx);
                return liveOut;
            case "ExportDefaultDeclaration":
                return this.tempReads(stmt.declaration as TYPE.Node, ctx);
            case "BreakStatement":
            case "ContinueStatement":
                return liveOut;
            default:
                return liveOut;
        }
    }

    private cleanupNested(stmt: TYPE.Statement, ctx: FunctionContext, liveOut: Set<string>): Set<string> {
        if (TYPE.isBlockStatement(stmt)) return this.cleanupStatements(stmt.body, ctx, liveOut);
        return this.transfer(stmt, liveOut, ctx);
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
        if (!TYPE.isExpressionStatement(stmt) || !TYPE.isAssignmentExpression(stmt.expression)) return null;
        const assign = stmt.expression;
        if (assign.operator !== "=" || !TYPE.isIdentifier(assign.left)) return null;
        const name = assign.left.name;
        if (!isTempName(name)) return null;
        const info = ctx.infos.get(name);
        if (!info || info.captured) return null;
        // 返回表达式里直接使用该变量时,保守保留调用结果赋值,避免活跃性误判丢失返回值
        // (已经被复制传播搬进 return 的调用不受此限,否则会同时留下调用语句和 return 调用)
        if (ctx.returned.has(name) && TYPE.isCallExpression(assign.right) && !ctx.moved.has(assign.right)) return null;
        // v = v 恒等于无操作,无论 v 之后是否活跃都可以删除
        if (TYPE.isIdentifier(assign.right) && assign.right.name === name) {
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
            return { replace: TYPE.expressionStatement(rhs), remainingReads: reads };
        }
        if (isDeclarationValue(rhs)) {
            // 函数/类表达式需要保留,SyntaxRewriteSimplify/ClassSyntaxSimplify 会转成声明
            return { replace: TYPE.expressionStatement(rhs), remainingReads: reads };
        }
        if (isPureExpression(rhs)) {
            this.removeRefs(rhs, ctx);
            return { replace: null, remainingReads: new Set() };
        }
        // 调用等有副作用:保留表达式本身
        return { replace: TYPE.expressionStatement(rhs), remainingReads: reads };
    }
}
