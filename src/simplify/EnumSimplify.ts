import { Program } from "@babel/types";
import { ISimplify } from "./ISimplify";
import * as TYPE from "@babel/types";
import { isFunctionLike, isPureExpression, isTempName, scanCapturedRead, walkNode, walkStatementSkipFunctions } from "./AstUtils";

/**
 * ArkTS enum 初始化还原。
 *
 * ArkTS 把 `export enum E { A = "a", B = "b" }` 编译成四条固定语句
 * (即 TypeScript 经典的 `(function (E) { ... })(E || (E = {}))` 的字节码展开):
 *
 *   v0 = function (p0) { p0.A = "a"; p0.B = "b"; };  // 成员填充函数
 *   v1 = E;                                          // 读全局变量
 *   if (!E) { acc = {}; v1 = acc; E = acc; }         // 惰性创建空对象
 *   v0(v1);                                          // 填充成员
 *
 * 本 pass 在确认安全后把它还原成一条 `E = { A: "a", B: "b" };`,
 * 并顺带删除之前已证明死代码的 `E = undefined;`。
 * 其余引用(v0/v1/acc 的声明)交给 TempVariableSimplify 在同一轮清理。
 *
 * 安全条件(任一不满足就放弃,保持原样输出):
 *   1. 填充函数体只有 `p.MEMBER = 纯表达式`,参数只作为成员赋值目标,
 *      且成员值不引用参数和任何临时变量;
 *   2. 模式之前 EnumName 只被赋过 undefined/null/hole,没有被非嵌套读取;
 *      若区域内存在"未知"调用,则整个作用域不能有任何嵌套函数写 EnumName
 *      —— 排除"调用触发闭包把 EnumName 改成真值"的可能;
 *   3. 涉及的临时变量(fnTemp / v / 分支里的别名)在模式之后、被顶层语句
 *      无条件重新赋值之前不被读取,也没有被任何嵌套函数捕获
 *      —— 删除模式语句不会改变它们对后续代码的可见值。
 *
 * 区域内的 `fnTemp(arg)` 调用如果本身就是另一个(结构匹配的)enum 模式的
 * 填充调用,则视为纯操作豁免:填充函数只往传入对象上挂常量属性,
 * 既不会写 EnumName,也不会调用任何闭包。
 *
 * @Author: jmp0
 * @Email: jmp0@qq.com
 */

/** 填充函数解析出的一个枚举成员 */
interface EnumMember {
    key: TYPE.Identifier | TYPE.StringLiteral | TYPE.NumericLiteral;
    value: TYPE.Expression;
}

/** 四条语句的结构匹配结果(不含安全检查) */
interface PatternMatch {
    filler: { fnTemp: string; members: EnumMember[] };
    enumName: string;
    valueTemp: string;
    lazyInit: { object: TYPE.ObjectExpression; aliases: Set<string> };
}

/** 一次成功改写时登记的删除候选:defer 到整个语句列表处理完后统一核对删除 */
interface PendingUndefDelete {
    list: TYPE.Statement[];
    undefStmt: TYPE.Statement;
    patternStmt: TYPE.Statement;
}

/** undefined / null / hole 都能让 `if (!E)` 走创建分支 */
function isFalsyInitValue(expr: TYPE.Expression): boolean {
    if (TYPE.isIdentifier(expr)) return expr.name === "undefined" || expr.name === "hole";
    if (TYPE.isNullLiteral(expr)) return true;
    if (TYPE.isUnaryExpression(expr) && expr.operator === "void") return isPureExpression(expr.argument);
    return false;
}

/** 只有这两种 `= undefined` 可以随模式一起删除(void 0 / null 保留,避免过度改写) */
function isDeletableUndefined(expr: TYPE.Expression): boolean {
    if (TYPE.isIdentifier(expr) && expr.name === "undefined") return true;
    return TYPE.isUnaryExpression(expr) && expr.operator === "void" && isPureExpression(expr.argument);
}

export class EnumSimplify implements ISimplify {
    simplify(node: Program): boolean {
        let changed = this.processScope(node);
        const functions: TYPE.Function[] = [];
        walkNode(node, (n) => {
            if (isFunctionLike(n)) functions.push(n as TYPE.Function);
            // 不跳过子树:类方法/嵌套函数体内的 enum 初始化也要处理
            return true;
        });
        for (const fn of functions) {
            if (TYPE.isBlockStatement(fn.body)) {
                changed = this.processScope(fn.body) || changed;
            }
        }
        return changed;
    }

    private processScope(scope: TYPE.Program | TYPE.BlockStatement): boolean {
        const stmts = scope.body;
        // 预扫描:先找出所有结构匹配的模式,它们的填充调用(fnTemp(v))是纯操作,
        // 后续安全检查与死初始化删除可以放心豁免这些调用。
        const fillerCalls = new Set<TYPE.Statement>();
        for (let i = stmts.length - 4; i >= 0; i--) {
            const match = this.matchPattern(stmts, i);
            if (match) fillerCalls.add(stmts[i + 3]);
        }
        let changed = false;
        // `E = undefined` 的删除候选 defer 到循环结束后统一核对:
        // 处理后面的模式时,前面模式的填充调用可能还在列表里挡路,
        // 而它们会在自己的轮次里被改写消失。
        const pendingDeletes: PendingUndefDelete[] = [];
        // 从后往前匹配:连续多个 enum 模式共享同一组临时变量(v0/v1/acc),
        // 先处理后面的模式,前面模式的"之后无读取"检查才不会被后面的调用挡住。
        for (let i = stmts.length - 4; i >= 0; i--) {
            if (this.tryRewrite(stmts, i, scope, fillerCalls, pendingDeletes)) changed = true;
        }
        for (const pending of pendingDeletes) {
            const list = pending.list;
            const undefIndex = list.indexOf(pending.undefStmt);
            const patternIndex = list.indexOf(pending.patternStmt);
            if (undefIndex < 0 || patternIndex < 0 || undefIndex >= patternIndex) continue;
            if (this.hasUnknownInvocationBetween(list, undefIndex + 1, patternIndex, fillerCalls)) continue;
            list.splice(undefIndex, 1);
        }
        return changed;
    }

    // ---------------------------------------------------------------- 模式匹配

    private matchPattern(stmts: TYPE.Statement[], i: number): PatternMatch | null {        // S0:fnTemp = function (p) { p.M = expr; ... }; 成员填充函数
        const filler = this.matchFillerFunction(stmts[i]);
        if (!filler) return null;

        // S1: v = E;(E 只要求是标识符,temp 风格的局部名也允许;
        // 是否真的持有"初始为假值的本模块变量"由声明检查与区域检查保证)
        const load = this.matchSimpleAssign(stmts[i + 1]);
        if (!load || !TYPE.isIdentifier(load.right)) return null;
        const enumName = load.right.name;
        const valueTemp = load.left;
        if (valueTemp === enumName) return null;

        // S2: if (!E / !v) { acc = {}; v = acc; E = acc; }
        const lazyInit = this.matchLazyInit(stmts[i + 2], enumName, valueTemp);
        if (!lazyInit) return null;

        // S3: fnTemp(v) 或 fnTemp(E)
        const callStmt = stmts[i + 3];
        if (!TYPE.isExpressionStatement(callStmt) || !TYPE.isCallExpression(callStmt.expression)) return null;
        const call = callStmt.expression;
        if (call.optional || !TYPE.isIdentifier(call.callee) || call.callee.name !== filler.fnTemp) return null;
        if (call.arguments.length !== 1 || !TYPE.isIdentifier(call.arguments[0])) return null;
        const argName = call.arguments[0].name;
        if (argName !== valueTemp && argName !== enumName) return null;

        return { filler, enumName, valueTemp, lazyInit };
    }

    private tryRewrite(
        stmts: TYPE.Statement[],
        i: number,
        scope: TYPE.Program | TYPE.BlockStatement,
        fillerCalls: Set<TYPE.Statement>,
        pendingDeletes: PendingUndefDelete[],
    ): boolean {
        const match = this.matchPattern(stmts, i);
        if (!match) return false;
        // E 必须在本语句列表顶层声明过,排除被其他模块赋真值的隐式全局变量
        if (!this.isDeclaredInList(stmts, match.enumName)) return false;

        // 模式删除后值会改变的名字:函数、别名 v、分支里所有被赋值的名字。
        // EnumName 本身不算 —— 它的赋值被对象字面量在同位置等价替换,
        // 嵌套函数(如业务函数)读取它看到的都是初始化后的对象。
        const involved = new Set<string>([match.filler.fnTemp, match.valueTemp, ...match.lazyInit.aliases]);
        involved.delete(match.enumName);

        const region = this.analyzeEnumRegion(stmts, i, match.enumName, scope, fillerCalls);
        if (!region) return false;
        if (!this.tempsUnusedAfter(stmts, i, involved, scope)) return false;

        // 四条语句 -> 一条对象字面量赋值(成员值节点直接搬移,表达式纯且不引用会变的变量)
        const object = TYPE.objectExpression(match.filler.members.map((m) => {
            let key: EnumMember["key"] = m.key;
            // 字符串键尽量还原成标识符键;__proto__ 必须保持 computed,
            // 否则对象字面量会把语义从"普通属性"变成"设置原型"。
            if (TYPE.isStringLiteral(key) && key.value !== "__proto__"
                && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key.value)) {
                key = TYPE.identifier(key.value);
            }
            return TYPE.objectProperty(key, m.value, TYPE.isStringLiteral(key) && key.value === "__proto__");
        }));
        const replacement = TYPE.expressionStatement(
            TYPE.assignmentExpression("=", TYPE.identifier(match.enumName), object));
        stmts.splice(i, 4, replacement);

        // 之前证明已死的 `E = undefined;` 登记为删除候选,由 processScope 统一核对删除
        const undef = region.lastUndefIndex;
        if (undef >= 0) {
            pendingDeletes.push({ list: stmts, undefStmt: stmts[undef], patternStmt: replacement });
        }
        return true;
    }

    /** S0:fnTemp = function (p) { p.M = expr; ... }; 成员填充函数 */
    private matchFillerFunction(stmt: TYPE.Statement): { fnTemp: string; members: EnumMember[] } | null {
        if (!TYPE.isExpressionStatement(stmt) || !TYPE.isAssignmentExpression(stmt.expression)) return null;
        const assign = stmt.expression;
        if (assign.operator !== "=" || !TYPE.isIdentifier(assign.left) || !isTempName(assign.left.name)) return null;
        const fn = assign.right;
        if (!TYPE.isFunctionExpression(fn) && !TYPE.isArrowFunctionExpression(fn)) return null;
        if (fn.generator || fn.async || !TYPE.isBlockStatement(fn.body)) return null;
        if (fn.params.length !== 1 || !TYPE.isIdentifier(fn.params[0])) return null;
        const param = fn.params[0].name;

        const members: EnumMember[] = [];
        for (let idx = 0; idx < fn.body.body.length; idx++) {
            const inner = fn.body.body[idx];
            // 原始输出里函数末尾带一条空 `return;`;只允许它出现在最后,
            // 出现在中间会让后面的成员赋值不可达,语义对不上。
            if (TYPE.isReturnStatement(inner)) {
                if (idx === fn.body.body.length - 1 && !inner.argument) break;
                return null;
            }
            if (!TYPE.isExpressionStatement(inner) || !TYPE.isAssignmentExpression(inner.expression)) return null;
            const a = inner.expression;
            if (a.operator !== "=" || !TYPE.isMemberExpression(a.left) || a.left.optional) return null;
            if (!TYPE.isIdentifier(a.left.object) || a.left.object.name !== param) return null;
            let key: EnumMember["key"];
            if (!a.left.computed && TYPE.isIdentifier(a.left.property)) {
                key = a.left.property;
            } else if (a.left.computed
                && (TYPE.isStringLiteral(a.left.property) || TYPE.isNumericLiteral(a.left.property))) {
                key = a.left.property;
            } else {
                return null;
            }
            if (!isPureExpression(a.right)) return null;
            // 值不能引用填充参数,也不能引用任何临时变量(模式删除后它们的值会变)
            let bad = false;
            walkNode(a.right, (n) => {
                if (TYPE.isIdentifier(n) && (n.name === param || isTempName(n.name))) {
                    bad = true;
                    return false;
                }
                return true;
            });
            if (bad) return null;
            members.push({ key, value: a.right });
        }
        return { fnTemp: assign.left.name, members };
    }

    /** enumName 必须在本语句列表顶层的 let/var 声明里出现过,排除隐式全局变量 */
    private isDeclaredInList(stmts: TYPE.Statement[], name: string): boolean {
        for (const stmt of stmts) {
            if (!TYPE.isVariableDeclaration(stmt)) continue;
            for (const d of stmt.declarations) {
                if (TYPE.isIdentifier(d.id) && d.id.name === name) return true;
            }
        }
        return false;
    }

    private matchSimpleAssign(stmt: TYPE.Statement): { left: string; right: TYPE.Expression } | null {
        if (!TYPE.isExpressionStatement(stmt) || !TYPE.isAssignmentExpression(stmt.expression)) return null;
        const a = stmt.expression;
        if (a.operator !== "=" || !TYPE.isIdentifier(a.left)) return null;
        return { left: a.left.name, right: a.right };
    }

    /** S2:if (!E / !v) { 若干 `名字 = 名字/空对象` 赋值,EnumName 与 v 最终都解析到同一个空对象 } */
    private matchLazyInit(stmt: TYPE.Statement, enumName: string, valueTemp: string):
        { object: TYPE.ObjectExpression; aliases: Set<string> } | null {
        if (!TYPE.isIfStatement(stmt) || stmt.alternate) return null;
        const test = stmt.test;
        if (!TYPE.isUnaryExpression(test) || test.operator !== "!" || !TYPE.isIdentifier(test.argument)) return null;
        if (test.argument.name !== enumName && test.argument.name !== valueTemp) return null;
        if (!TYPE.isBlockStatement(stmt.consequent)) return null;

        const map = new Map<string, TYPE.Expression>();
        for (const inner of stmt.consequent.body) {
            const a = this.matchSimpleAssign(inner);
            if (!a) return null;
            map.set(a.left, a.right);
        }
        if (map.size === 0) return null;

        let object: TYPE.ObjectExpression | null = null;
        for (const rhs of map.values()) {
            if (TYPE.isObjectExpression(rhs) && rhs.properties.length === 0) {
                if (object) return null; // 出现两个空对象:无法确定共享的是哪一个
                object = rhs;
            }
        }
        if (!object) return null;
        if (this.resolveAlias(map, enumName, new Set()) !== object) return null;
        if (this.resolveAlias(map, valueTemp, new Set()) !== object) return null;
        return { object, aliases: new Set(map.keys()) };
    }

    /** 沿分支内的赋值链解析别名;返回最终指向的节点(带环检测) */
    private resolveAlias(
        map: Map<string, TYPE.Expression>,
        name: string,
        seen: Set<string>,
    ): TYPE.Expression | null {
        if (seen.has(name)) return null;
        seen.add(name);
        const next = map.get(name);
        if (!next) return TYPE.identifier(name);
        if (TYPE.isIdentifier(next)) return this.resolveAlias(map, next.name, seen);
        return next;
    }

    // ---------------------------------------------------------------- 安全检查

    /**
     * EnumName 在模式之前的全部出现都必须与"初始为假值"相容:
     *   - 不能有非嵌套读取;
     *   - 写操作只允许 `E = undefined/null/hole`(成员写/复合写/更新/delete 都不行);
     *   - 区域内有未知调用时,整个作用域不能有嵌套函数写 EnumName。
     */
    private analyzeEnumRegion(
        stmts: TYPE.Statement[],
        i: number,
        enumName: string,
        scope: TYPE.Program | TYPE.BlockStatement,
        fillerCalls: Set<TYPE.Statement>,
    ): { lastUndefIndex: number } | null {
        let hasRead = false;
        let hasBadWrite = false;
        let hasUnknownInvocation = false;
        let lastUndefIndex = -1;
        for (let j = 0; j < i; j++) {
            const stmt = stmts[j];
            walkStatementSkipFunctions(stmt, (node, parent) => {
                if (TYPE.isIdentifier(node) && node.name === enumName
                    && parent && TYPE.isReferenced(node, parent)) {
                    hasRead = true;
                }
                if (!fillerCalls.has(stmt) && this.isInvocation(node)) hasUnknownInvocation = true;
                if (this.isUnsafeWriteTo(node, enumName, true)) hasBadWrite = true;
                if (TYPE.isAssignmentExpression(node) && node.operator === "="
                    && TYPE.isIdentifier(node.left) && node.left.name === enumName
                    && isDeletableUndefined(node.right)) {
                    lastUndefIndex = j;
                }
            });
            if (hasRead || hasBadWrite) return null;
        }
        if (hasUnknownInvocation && this.hasNestedEnumWrite(scope, enumName)) return null;
        return { lastUndefIndex };
    }

    /**
     * 模式删除后,involved 里的名字对后续代码的可见值不能变:
     *   1. 任何嵌套函数(整个作用域内,考虑内层作用域遮蔽)都不得读取
     *      —— 闭包可能在任意时机看到新值;
     *   2. 模式之后的线性代码里,读取之前必须有**顺序上先执行**的顶层无条件赋值
     *      把旧值覆盖掉(块与块之间顺序展开;if/循环/switch/catch 体内的写入是
     *      条件执行,不参与 kill);余下代码里若出现对 involved 名字的重新声明
     *      (块级遮蔽),读写归属不可靠,直接放弃。
     */
    private tempsUnusedAfter(
        stmts: TYPE.Statement[],
        i: number,
        involved: Set<string>,
        scope: TYPE.Program | TYPE.BlockStatement,
    ): boolean {
        if (scanCapturedRead(scope, null, involved, new Set(), false)) return false;

        for (const name of involved) {
            if (this.sequenceFlowUnsafe(stmts, i + 4, name, { killed: false })) return false;
        }
        return true;
    }

    /**
     * 顺序数据流检查:从 from 开始的语句里,是否存在对 name 的读取
     * 发生在"能覆盖旧值的无条件赋值"之前。
     */
    private sequenceFlowUnsafe(
        stmts: TYPE.Statement[],
        from: number,
        name: string,
        state: { killed: boolean },
    ): boolean {
        for (let j = from; j < stmts.length; j++) {
            if (this.statementFlowUnsafe(stmts[j], name, state)) return true;
        }
        return false;
    }

    private statementFlowUnsafe(stmt: TYPE.Statement, name: string, state: { killed: boolean }): boolean {
        if (TYPE.isExpressionStatement(stmt)) {
            const expr = stmt.expression;
            if (TYPE.isAssignmentExpression(expr) && expr.operator === "="
                && TYPE.isIdentifier(expr.left) && expr.left.name === name) {
                // RHS 先求值:RHS 里读取旧值仍然危险;赋值完成后旧值失效
                if (!state.killed && this.exprReadsUnsafe(expr.right, name)) return true;
                state.killed = true;
                return false;
            }
            return !state.killed && this.exprReadsUnsafe(expr, name);
        }
        if (TYPE.isBlockStatement(stmt)) {
            return this.sequenceFlowUnsafe(stmt.body, 0, name, state);
        }
        if (TYPE.isLabeledStatement(stmt)) {
            return TYPE.isBlockStatement(stmt.body)
                ? this.sequenceFlowUnsafe(stmt.body.body, 0, name, state)
                : this.statementFlowUnsafe(stmt.body, name, state);
        }
        if (TYPE.isVariableDeclaration(stmt)) {
            for (const d of stmt.declarations) {
                if (TYPE.isIdentifier(d.id) && d.id.name === name) return true; // 重新声明,遮蔽
                if (!state.killed && d.init && this.exprReadsUnsafe(d.init, name)) return true;
            }
            return false;
        }
        if (TYPE.isIfStatement(stmt)) {
            if (!state.killed && this.exprReadsUnsafe(stmt.test, name)) return true;
            return this.branchFlowUnsafe(stmt.consequent, name, state.killed)
                || (!!stmt.alternate && this.branchFlowUnsafe(stmt.alternate, name, state.killed));
        }
        if (TYPE.isWhileStatement(stmt) || TYPE.isForStatement(stmt)
            || TYPE.isForInStatement(stmt) || TYPE.isForOfStatement(stmt)) {
            const s: any = stmt;
            if (!state.killed) {
                if (stmt.type === "WhileStatement" && this.exprReadsUnsafe(stmt.test, name)) return true;
                if (stmt.type === "ForStatement") {
                    if (stmt.test && this.exprReadsUnsafe(stmt.test, name)) return true;
                    if (stmt.update && this.exprReadsUnsafe(stmt.update, name)) return true;
                }
                if ((stmt.type === "ForInStatement" || stmt.type === "ForOfStatement")
                    && this.exprReadsUnsafe(s.right, name)) return true;
            }
            return this.branchFlowUnsafe(stmt.body, name, state.killed);
        }
        if (TYPE.isDoWhileStatement(stmt)) {
            if (this.branchFlowUnsafe(stmt.body, name, state.killed)) return true;
            return !state.killed && this.exprReadsUnsafe(stmt.test, name);
        }
        if (TYPE.isSwitchStatement(stmt)) {
            if (!state.killed && this.exprReadsUnsafe(stmt.discriminant, name)) return true;
            for (const c of stmt.cases) {
                if (c.test && !state.killed && this.exprReadsUnsafe(c.test, name)) return true;
                if (this.branchFlowUnsafeMultiple(c.consequent, name, state.killed)) return true;
            }
            return false;
        }
        if (TYPE.isTryStatement(stmt)) {
            // block / finalizer 无条件执行,可以传播 kill;handler 条件执行。
            // 异常可能中断 block 提前进入 handler:handler/finalizer 检查时用进入前的 kill 状态。
            const saved = state.killed;
            if (this.sequenceFlowUnsafe(stmt.block.body, 0, name, state)) return true;
            state.killed = saved;
            if (stmt.handler && this.branchFlowUnsafe(stmt.handler.body, name, saved)) return true;
            if (stmt.finalizer && this.sequenceFlowUnsafe(stmt.finalizer.body, 0, name, state)) return true;
            return false;
        }
        // return/throw/break/continue 等:表达式里的读取照常检查
        return !state.killed && this.exprReadsUnsafe(stmt as unknown as TYPE.Node, name);
    }

    /** 条件执行的语句体:读取按当前 killed 检查,但里面的写入不影响 kill 状态 */
    private branchFlowUnsafe(stmt: TYPE.Statement, name: string, killed: boolean): boolean {
        if (killed) return false;
        let read = false;
        let redeclared = false;
        walkStatementSkipFunctions(stmt, (node, parent) => {
            if (TYPE.isIdentifier(node) && node.name === name
                && parent && TYPE.isReferenced(node, parent)) {
                read = true;
            }
            if (TYPE.isVariableDeclaration(node)) {
                for (const d of node.declarations) {
                    if (TYPE.isIdentifier(d.id) && d.id.name === name) redeclared = true;
                }
            }
        });
        return read || redeclared;
    }

    private branchFlowUnsafeMultiple(stmts: TYPE.Statement[], name: string, killed: boolean): boolean {
        for (const stmt of stmts) {
            if (this.branchFlowUnsafe(stmt, name, killed)) return true;
        }
        return false;
    }

    /** 表达式里是否存在对 name 的读取(不进入嵌套函数;根本身就是标识符也算) */
    private exprReadsUnsafe(expr: TYPE.Node | null | undefined, name: string): boolean {
        if (!expr) return false;
        if (TYPE.isIdentifier(expr) && expr.name === name) return true;
        let read = false;
        walkStatementSkipFunctions(expr, (node, parent) => {
            if (TYPE.isIdentifier(node) && node.name === name
                && parent && TYPE.isReferenced(node, parent)) {
                read = true;
            }
        });
        return read;
    }

    // ---------------------------------------------------------------- 工具

    /** 可能执行任意代码的表达式(调用/构造/await/yield/标签模板) */
    private isInvocation(node: TYPE.Node): boolean {
        return TYPE.isCallExpression(node) || TYPE.isNewExpression(node)
            || TYPE.isAwaitExpression(node) || TYPE.isYieldExpression(node)
            || TYPE.isTaggedTemplateExpression(node);
    }

    /**
     * node 是否是对 name 的不安全写操作。
     * allowUndefinedRhs 为 true 时,`name = undefined/null/hole` 不算不安全;
     * 成员写(E.x = ... / E[x] = ... / E.x++ / delete E.x)和复合赋值(E += ...)一律不安全。
     */
    private isUnsafeWriteTo(node: TYPE.Node, name: string, allowUndefinedRhs: boolean): boolean {
        if (TYPE.isAssignmentExpression(node)) {
            if (TYPE.isIdentifier(node.left)) {
                if (node.left.name !== name) return false;
                if (node.operator !== "=") return true; // 复合赋值会读旧值
                return allowUndefinedRhs ? !isFalsyInitValue(node.right) : true;
            }
            return this.isMemberOf(node.left, name);
        }
        if (TYPE.isUpdateExpression(node)) {
            return (TYPE.isIdentifier(node.argument) && node.argument.name === name)
                || this.isMemberOf(node.argument, name);
        }
        if (TYPE.isUnaryExpression(node) && node.operator === "delete") {
            return this.isMemberOf(node.argument, name);
        }
        return false;
    }

    private isMemberOf(node: TYPE.Node | null | undefined, name: string): boolean {
        return !!node && TYPE.isMemberExpression(node) && !node.optional
            && TYPE.isIdentifier(node.object) && node.object.name === name;
    }

    private hasNestedEnumWrite(scope: TYPE.Program | TYPE.BlockStatement, enumName: string): boolean {
        let found = false;
        walkNode(scope, (node) => {
            if (found) return false;
            if (isFunctionLike(node)) {
                const body = (node as TYPE.Function).body;
                if (TYPE.isBlockStatement(body)) {
                    walkStatementSkipFunctions(body, (n) => {
                        if (this.isUnsafeWriteTo(n, enumName, true)) found = true;
                    });
                }
            }
            return !found;
        });
        return found;
    }

    private hasUnknownInvocationBetween(
        stmts: TYPE.Statement[],
        from: number,
        to: number,
        fillerCalls: Set<TYPE.Statement>,
    ): boolean {
        for (let j = from; j < to && j < stmts.length; j++) {
            const stmt = stmts[j];
            if (fillerCalls.has(stmt)) continue; // 其他模式的填充调用:纯操作
            let found = false;
            walkStatementSkipFunctions(stmt, (node) => {
                if (this.isInvocation(node)) found = true;
            });
            if (found) return true;
        }
        return false;
    }
}
