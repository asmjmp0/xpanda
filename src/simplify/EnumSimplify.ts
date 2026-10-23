import { Program } from "@babel/types";
import { ISimplify } from "./ISimplify";
import * as TYPE from "@babel/types";
import { isFunctionLike, isPureExpression, isTempName, scanCapturedRead, walkNode, walkStatementSkipFunctions } from "./AstUtils";


const {
    assignmentExpression,
    expressionStatement,
    identifier,
    isArrowFunctionExpression,
    isAssignmentExpression,
    isAwaitExpression,
    isBlockStatement,
    isCallExpression,
    isDoWhileStatement,
    isExpressionStatement,
    isForInStatement,
    isForOfStatement,
    isForStatement,
    isFunctionExpression,
    isIdentifier,
    isIfStatement,
    isLabeledStatement,
    isMemberExpression,
    isNewExpression,
    isNullLiteral,
    isNumericLiteral,
    isObjectExpression,
    isReferenced,
    isReturnStatement,
    isStringLiteral,
    isSwitchStatement,
    isTaggedTemplateExpression,
    isTryStatement,
    isUnaryExpression,
    isUpdateExpression,
    isVariableDeclaration,
    isWhileStatement,
    isYieldExpression,
    objectExpression,
    objectProperty,
} = TYPE;

/**
 * ArkTS enum 初始化还原。
 *
 * ArkTS 把 `export enum E { A = "a", B = "b" }` 编译成
 * (即 TypeScript 经典的 `(function (E) { ... })(E || (E = {}))` 的字节码展开):
 *
 * 装载形态(4 条语句,字节码 13.0.1.0 等):
 *   v0 = function (p0) { p0.A = "a"; p0.B = "b"; };  // 成员填充函数
 *   v1 = E;                                          // 读全局变量
 *   if (!E) { acc = {}; v1 = acc; E = acc; }         // 惰性创建空对象
 *   v0(v1);                                          // 填充成员
 *
 * 直接形态(3 条语句,更新的字节码):区域归约会把 if 汇合点上的公共装载
 * `v = E` 复制进两条分支的尾部,得到 if/else 结构,中间装载语句消失:
 *   v0 = function (p0) { p0.A = "a"; ... };
 *   if (!E) { acc = {}; E = acc; } else { acc = E; }
 *   v0(acc);
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
 *      —— 删除模式语句不会改变它们对后续代码的可见值;
 *   4. 带 else 分支时,else 里只能是简单赋值、不得重写 EnumName(解析后仍
 *      指向它自身),且调用参数在两个分支里都解析到"EnumName 当前持有的值"
 *      —— 结合条件 2,EnumName 在此处必为假值,else 分支实际不可达,
 *      把模式改写成 `E = {...}` 才与原语义等价。
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
    key: TYPE.Identifier | TYPE.StringLiteral | TYPE.NumericLiteral | TYPE.UnaryExpression;
    value: TYPE.Expression;
}

/** 四条/五条语句的结构匹配结果(不含安全检查) */
interface PatternMatch {
    filler: { fnTemp: string; members: EnumMember[] };
    enumName: string;
    /** if 之前的装载别名(`v1 = E`);没有为 null */
    valueTemp: string | null;
    /** if 之后、调用之前的装载别名(`v5 = acc`);没有为 null */
    postLoad: AliasLoad | null;
    lazyInit: { object: TYPE.ObjectExpression; aliases: Set<string> };
    /** 模式占据的语句条数(3 ~ 5) */
    length: number;
}

/** 惰性初始化 if 语句的分支结构解析结果(不含枚举名相关的校验) */
interface LazyInitBranches {
    /** `!X` 里的 X */
    testArg: string;
    /** then 分支里的简单赋值:名字 -> 右值 */
    thenMap: Map<string, TYPE.Expression>;
    /** else 分支里的简单赋值;没有 else 分支时为 null */
    elseMap: Map<string, TYPE.Expression> | null;
    /** then 分支里唯一的空对象字面量 */
    object: TYPE.ObjectExpression;
}

/** 调用前后的单条别名装载(`v1 = E` / `v5 = acc`):随模式一起删除的语句 */
interface AliasLoad {
    left: string;
    right: string;
}

/** 一次成功改写时登记的删除候选:defer 到整个语句列表处理完后统一核对删除 */
interface PendingUndefDelete {
    list: TYPE.Statement[];
    undefStmt: TYPE.Statement;
    patternStmt: TYPE.Statement;
}

/** undefined / null / hole 都能让 `if (!E)` 走创建分支 */
function isFalsyInitValue(expr: TYPE.Expression): boolean {
    if (isIdentifier(expr)) return expr.name === "undefined" || expr.name === "hole";
    if (isNullLiteral(expr)) return true;
    if (isUnaryExpression(expr) && expr.operator === "void") return isPureExpression(expr.argument);
    return false;
}

/** 只有这两种 `= undefined` 可以随模式一起删除(void 0 / null 保留,避免过度改写) */
function isDeletableUndefined(expr: TYPE.Expression): boolean {
    if (isIdentifier(expr) && expr.name === "undefined") return true;
    return isUnaryExpression(expr) && expr.operator === "void" && isPureExpression(expr.argument);
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
            if (isBlockStatement(fn.body)) {
                changed = this.processScope(fn.body) || changed;
            }
        }
        return changed;
    }

    private processScope(scope: TYPE.Program | TYPE.BlockStatement): boolean {
        const stmts = scope.body;
        // 预扫描:先找出所有结构匹配的模式,它们的填充调用(fnTemp(v))是纯操作,
        // 后续安全检查与死初始化删除可以放心豁免这些调用。
        // 下界 stmts.length - 3:最短形态(填充函数 + if/else + 调用)占 3 条语句。
        const fillerCalls = new Set<TYPE.Statement>();
        for (let i = stmts.length - 3; i >= 0; i--) {
            const match = this.matchPattern(stmts, i);
            if (match) fillerCalls.add(stmts[i + match.length - 1]);
        }
        let changed = false;
        // `E = undefined` 的删除候选 defer 到循环结束后统一核对:
        // 处理后面的模式时,前面模式的填充调用可能还在列表里挡路,
        // 而它们会在自己的轮次里被改写消失。
        const pendingDeletes: PendingUndefDelete[] = [];
        // 从后往前匹配:连续多个 enum 模式共享同一组临时变量(v0/v1/acc),
        // 先处理后面的模式,前面模式的"之后无读取"检查才不会被后面的调用挡住。
        for (let i = stmts.length - 3; i >= 0; i--) {
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

    /**
     * S0:fnTemp = function (p) { p.M = expr; ... }; 成员填充函数;
     * S1(可选):`v1 = E` —— if 之前把枚举对象装进临时变量(装载形态);
     * S2:if (!E / !v) { acc = {}; E = acc; } [else { acc = E; }] —— 惰性初始化。
     * 区域归约可能把汇合点上的公共装载 `v = E` 复制进两条分支尾部得到 else;
     * S3(可选):`v5 = acc` —— if 之后把对象装进实参寄存器;
     * S4:fnTemp(v1 / v5 / acc / E) —— 填充调用。
     */
    private matchPattern(stmts: TYPE.Statement[], i: number): PatternMatch | null {
        const filler = this.matchFillerFunction(stmts[i]);
        if (!filler) return null;

        // if 的位置二选一:i+1(直接形态)或 i+2(带前置装载的形态)。
        // i+1 是 if 时就是直接形态,是 `X = Y` 时才尝试前置装载,二者不会歧义。
        const direct = this.matchLazyInitBranches(stmts[i + 1]);
        let preLoad: AliasLoad | null = null;
        let branches: LazyInitBranches | null;
        if (direct) {
            branches = direct;
        } else {
            const s1 = this.matchSimpleAssign(stmts[i + 1]);
            if (!s1 || !isIdentifier(s1.right) || s1.left === s1.right.name) return null;
            preLoad = { left: s1.left, right: s1.right.name };
            branches = i + 2 < stmts.length ? this.matchLazyInitBranches(stmts[i + 2]) : null;
            if (!branches) return null;
        }

        // if 之后允许至多一条别名装载(`v5 = acc`),编译器把汇合后的对象装进实参
        let postLoad: AliasLoad | null = null;
        let j = i + (preLoad ? 3 : 2);
        if (j < stmts.length - 1) {
            const s3 = this.matchSimpleAssign(stmts[j]);
            if (s3 && isIdentifier(s3.right) && s3.left !== s3.right.name) {
                postLoad = { left: s3.left, right: s3.right.name };
                j++;
            }
        }

        // 填充调用:fnTemp(v1 / v5 / acc / E)
        const callArg = this.matchFillerCall(stmts[j], filler.fnTemp);
        if (!callArg) return null;
        const length = j - i + 1;

        // 枚举名:装载形态取 `v1 = E` 的右值;直接形态从分支赋值里发现
        // (非临时名且解析到空对象的必须恰好一个)。
        let enumName: string;
        if (preLoad) {
            enumName = preLoad.right;
            // test 必须直接判断 E 或刚装载的 v1
            if (branches.testArg !== enumName && branches.testArg !== preLoad.left) return null;
            const lazyInit = this.resolveLazyInit(branches, enumName, preLoad.left);
            if (!lazyInit) return null;
            if (!this.callArgHoldsEnum(callArg, enumName, preLoad.left, branches, postLoad)) return null;
            return { filler, enumName, valueTemp: preLoad.left, postLoad, lazyInit, length };
        }
        // 枚举名从分支赋值里发现:必须解析到空对象;带 else 分支时,
        // 枚举本体在 else 里保持自身(else 只把别名重新装载成 E 的值)。
        let candidates = [...branches.thenMap.keys()]
            .filter((name) => this.resolveAlias(branches.thenMap, name, new Set()) === branches.object
                && (!branches.elseMap || this.resolvesToIdentifier(branches.elseMap, name, name)));
        if (candidates.length > 1) {
            // 仍有歧义时优先非 temp 风格的名字(枚举名通常不是 vN/acc)
            const nonTemp = candidates.filter((name) => !isTempName(name));
            if (nonTemp.length >= 1) candidates = nonTemp;
        }
        if (candidates.length !== 1) return null;
        enumName = candidates[0];
        // 没有前置装载,分支里也不一定先给别名赋值,所以 test 必须直接判断枚举名
        if (branches.testArg !== enumName) return null;
        const lazyInit = this.resolveLazyInit(branches, enumName, null);
        if (!lazyInit) return null;
        if (!this.callArgHoldsEnum(callArg, enumName, null, branches, postLoad)) return null;
        return { filler, enumName, valueTemp: null, postLoad, lazyInit, length };
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

        // 模式删除后值会改变的名字:函数、装载别名 v1/v5、分支里所有被赋值的名字。
        // EnumName 本身不算 —— 它的赋值被对象字面量在同位置等价替换,
        // 嵌套函数(如业务函数)读取它看到的都是初始化后的对象。
        const involved = new Set<string>([match.filler.fnTemp, ...match.lazyInit.aliases]);
        if (match.valueTemp) involved.add(match.valueTemp);
        if (match.postLoad) involved.add(match.postLoad.left);
        involved.delete(match.enumName);

        const region = this.analyzeEnumRegion(stmts, i, match.enumName, scope, fillerCalls);
        if (!region) return false;
        if (!this.tempsUnusedAfter(stmts, i, involved, scope, match.length)) return false;

        // 模式语句 -> 一条对象字面量赋值(成员值节点直接搬移,表达式纯且不引用会变的变量)
        const object = objectExpression(match.filler.members.map((m) => {
            let key: EnumMember["key"] = m.key;
            // 字符串键尽量还原成标识符键;__proto__ 必须保持 computed,
            // 否则对象字面量会把语义从"普通属性"变成"设置原型"。
            if (isStringLiteral(key) && key.value !== "__proto__"
                && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key.value)) {
                key = identifier(key.value);
            }
            // 负数字面量键只能是 computed(`[-1]: "Unknown"`)
            const computed = isUnaryExpression(key)
                || (isStringLiteral(key) && key.value === "__proto__");
            return objectProperty(key, m.value, computed);
        }));
        const replacement = expressionStatement(
            assignmentExpression("=", identifier(match.enumName), object));
        stmts.splice(i, match.length, replacement);

        // 之前证明已死的 `E = undefined;` 登记为删除候选,由 processScope 统一核对删除
        const undef = region.lastUndefIndex;
        if (undef >= 0) {
            pendingDeletes.push({ list: stmts, undefStmt: stmts[undef], patternStmt: replacement });
        }
        return true;
    }

    /** S0:fnTemp = function (p) { p.M = expr; ... }; 成员填充函数 */
    private matchFillerFunction(stmt: TYPE.Statement): { fnTemp: string; members: EnumMember[] } | null {
        if (!isExpressionStatement(stmt) || !isAssignmentExpression(stmt.expression)) return null;
        const assign = stmt.expression;
        if (assign.operator !== "=" || !isIdentifier(assign.left) || !isTempName(assign.left.name)) return null;
        const fn = assign.right;
        if (!isFunctionExpression(fn) && !isArrowFunctionExpression(fn)) return null;
        if (fn.generator || fn.async || !isBlockStatement(fn.body)) return null;
        if (fn.params.length !== 1 || !isIdentifier(fn.params[0])) return null;
        const param = fn.params[0].name;

        const members: EnumMember[] = [];
        for (let idx = 0; idx < fn.body.body.length; idx++) {
            const inner = fn.body.body[idx];
            // 原始输出里函数末尾带一条空 `return;`;只允许它出现在最后,
            // 出现在中间会让后面的成员赋值不可达,语义对不上。
            if (isReturnStatement(inner)) {
                if (idx === fn.body.body.length - 1 && !inner.argument) break;
                return null;
            }
            if (!isExpressionStatement(inner) || !isAssignmentExpression(inner.expression)) return null;
            const a = inner.expression;
            if (a.operator !== "=" || !isMemberExpression(a.left) || a.left.optional) return null;
            if (!isIdentifier(a.left.object) || a.left.object.name !== param) return null;
            let key: EnumMember["key"];
            if (!a.left.computed && isIdentifier(a.left.property)) {
                key = a.left.property;
            } else if (a.left.computed
                && (isStringLiteral(a.left.property) || isNumericLiteral(a.left.property))) {
                key = a.left.property;
            } else if (a.left.computed
                && isUnaryExpression(a.left.property) && a.left.property.operator === "-"
                && isNumericLiteral(a.left.property.argument)) {
                // 负数键(如 TS enum 的负成员值)编译成 `p0[-1] = "Unknown"`
                key = a.left.property;
            } else {
                return null;
            }
            if (!isPureExpression(a.right)) return null;
            // 值不能引用填充参数,也不能引用任何临时变量(模式删除后它们的值会变)
            let bad = false;
            walkNode(a.right, (n) => {
                if (isIdentifier(n) && (n.name === param || isTempName(n.name))) {
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
            if (!isVariableDeclaration(stmt)) continue;
            for (const d of stmt.declarations) {
                if (isIdentifier(d.id) && d.id.name === name) return true;
            }
        }
        return false;
    }

    private matchSimpleAssign(stmt: TYPE.Statement): { left: string; right: TYPE.Expression } | null {
        if (!isExpressionStatement(stmt) || !isAssignmentExpression(stmt.expression)) return null;
        const a = stmt.expression;
        if (a.operator !== "=" || !isIdentifier(a.left)) return null;
        return { left: a.left.name, right: a.right };
    }

    /**
     * S(if):if (!X) { 若干 `名字 = 名字/空对象` 赋值 } [else { 若干简单赋值 }];
     * X 是标识符;then 分支必须恰好出现一个空对象字面量;else 分支(直接
     * if/else 形态)只能是简单赋值。枚举名相关的校验在 resolveLazyInit 里做。
     */
    private matchLazyInitBranches(stmt: TYPE.Statement): LazyInitBranches | null {
        if (!isIfStatement(stmt)) return null;
        const test = stmt.test;
        if (!isUnaryExpression(test) || test.operator !== "!" || !isIdentifier(test.argument)) return null;
        if (!isBlockStatement(stmt.consequent)) return null;

        const thenMap = new Map<string, TYPE.Expression>();
        for (const inner of stmt.consequent.body) {
            const a = this.matchSimpleAssign(inner);
            if (!a) return null;
            thenMap.set(a.left, a.right);
        }
        if (thenMap.size === 0) return null;

        let object: TYPE.ObjectExpression | null = null;
        for (const rhs of thenMap.values()) {
            if (isObjectExpression(rhs) && rhs.properties.length === 0) {
                if (object) return null; // 出现两个空对象:无法确定共享的是哪一个
                object = rhs;
            }
        }
        if (!object) return null;

        let elseMap: Map<string, TYPE.Expression> | null = null;
        if (stmt.alternate) {
            if (!isBlockStatement(stmt.alternate)) return null;
            elseMap = new Map<string, TYPE.Expression>();
            for (const inner of stmt.alternate.body) {
                const a = this.matchSimpleAssign(inner);
                if (!a) return null;
                elseMap.set(a.left, a.right);
            }
        }
        return { testArg: test.argument.name, thenMap, elseMap, object };
    }

    /**
     * 分支结构与枚举名的相容性检查:
     *   - then 分支:enumName(以及装载形态的 v)最终都解析到空对象;
     *   - else 分支(若有):enumName 解析后仍指向它自身 —— else 不得重写 E。
     * 结合区域检查(E 此前只被赋过假值),else 分支实际不可达,
     * 把模式改写成 `E = {...}` 才不改变语义。
     */
    private resolveLazyInit(
        branches: LazyInitBranches,
        enumName: string,
        valueTemp: string | null,
    ): { object: TYPE.ObjectExpression; aliases: Set<string> } | null {
        const { thenMap, elseMap, object } = branches;
        if (this.resolveAlias(thenMap, enumName, new Set()) !== object) return null;
        if (valueTemp && this.resolveAlias(thenMap, valueTemp, new Set()) !== object) return null;
        if (elseMap && !this.resolvesToIdentifier(elseMap, enumName, enumName)) return null;
        const aliases = new Set<string>([...thenMap.keys(), ...(elseMap ? elseMap.keys() : [])]);
        return { object, aliases };
    }

    /** S(调用):fnTemp(arg);返回实参名 */
    private matchFillerCall(stmt: TYPE.Statement, fnTemp: string): string | null {
        if (!isExpressionStatement(stmt) || !isCallExpression(stmt.expression)) return null;
        const call = stmt.expression;
        if (call.optional || !isIdentifier(call.callee) || call.callee.name !== fnTemp) return null;
        if (call.arguments.length !== 1 || !isIdentifier(call.arguments[0])) return null;
        return call.arguments[0].name;
    }

    /**
     * 实参在两条分支里都必须持有"E 当前持有的值"(即要被填充的那个对象):
     *   - 实参就是 enumName:then 里被赋成空对象,else 里本就持有对象;
     *   - 装载形态的 v1:`v1 = E` 在 if 之前装载,两个分支初始都指向 E;
     *   - 分支别名(如 acc):then 里必须解析到空对象;else 里若被重新装载,
     *     必须装载自 E,否则放弃(保守:不确认两个分支填同一对象就不改写);
     *   - 后置装载 `v5 = acc`:拿的是右值(acc)的检查结果。
     */
    private callArgHoldsEnum(
        argName: string,
        enumName: string,
        valueTemp: string | null,
        branches: LazyInitBranches,
        postLoad: AliasLoad | null,
    ): boolean {
        const arg = postLoad && argName === postLoad.left ? postLoad.right : argName;
        if (arg !== enumName && (valueTemp === null || arg !== valueTemp)) {
            if (this.resolveAlias(branches.thenMap, arg, new Set()) !== branches.object) return false;
        }
        if (!branches.elseMap) return true;
        if (arg === enumName) return true;
        if (branches.elseMap.has(arg)) {
            return this.resolvesToIdentifier(branches.elseMap, arg, enumName);
        }
        // else 里没有给实参赋值:只有"if 之前装载过 E"的 v1 才仍持有 E 的值
        return valueTemp !== null && arg === valueTemp;
    }

    /** map 里 name 解析后是否最终指向标识符 target(如 else 分支里的 `acc = E`) */
    private resolvesToIdentifier(
        map: Map<string, TYPE.Expression>,
        name: string,
        target: string,
    ): boolean {
        const r = this.resolveAlias(map, name, new Set());
        return !!r && isIdentifier(r) && r.name === target;
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
        if (!next) return identifier(name);
        if (isIdentifier(next)) return this.resolveAlias(map, next.name, seen);
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
                if (isIdentifier(node) && node.name === enumName
                    && parent && isReferenced(node, parent)) {
                    hasRead = true;
                }
                if (!fillerCalls.has(stmt) && this.isInvocation(node)) hasUnknownInvocation = true;
                if (this.isUnsafeWriteTo(node, enumName, true)) hasBadWrite = true;
                if (isAssignmentExpression(node) && node.operator === "="
                    && isIdentifier(node.left) && node.left.name === enumName
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
     *      条件执行,不参与 kill);余下代码里对 involved 名字的 let/const 重新声明
     *      按静态作用域遮蔽处理(声明之后读写的是新绑定),var 重新声明保守放弃。
     */
    private tempsUnusedAfter(
        stmts: TYPE.Statement[],
        i: number,
        involved: Set<string>,
        scope: TYPE.Program | TYPE.BlockStatement,
        patternLength: number,
    ): boolean {
        if (scanCapturedRead(scope, null, involved, new Set(), false)) return false;

        for (const name of involved) {
            if (this.sequenceFlowUnsafe(stmts, i + patternLength, name, { killed: false, shadowed: false })) {
                return false;
            }
        }
        return true;
    }

    /**
     * 顺序数据流检查:从 from 开始的语句里,是否存在对 name 的读取
     * 发生在"能覆盖旧值的无条件赋值"之前。
     * shadowed 为 true 表示 name 已被内层 let/const 重新声明遮蔽:
     * 静态作用域下后续读写的都是新绑定,与外层旧值无关,直接按安全处理。
     */
    private sequenceFlowUnsafe(
        stmts: TYPE.Statement[],
        from: number,
        name: string,
        state: { killed: boolean; shadowed: boolean },
    ): boolean {
        for (let j = from; j < stmts.length; j++) {
            if (this.statementFlowUnsafe(stmts[j], name, state)) return true;
        }
        return false;
    }

    private statementFlowUnsafe(stmt: TYPE.Statement, name: string, state: { killed: boolean; shadowed: boolean }): boolean {
        if (state.shadowed) return false; // 已被遮蔽:后续读写都是新绑定
        if (isExpressionStatement(stmt)) {
            const expr = stmt.expression;
            if (isAssignmentExpression(expr) && expr.operator === "="
                && isIdentifier(expr.left) && expr.left.name === name) {
                // RHS 先求值:RHS 里读取旧值仍然危险;赋值完成后旧值失效
                if (!state.killed && this.exprReadsUnsafe(expr.right, name)) return true;
                state.killed = true;
                return false;
            }
            return !state.killed && this.exprReadsUnsafe(expr, name);
        }
        if (isBlockStatement(stmt)) {
            const savedKilled = state.killed;
            const savedShadowed = state.shadowed;
            const unsafe = this.sequenceFlowUnsafe(stmt.body, 0, name, state);
            if (state.shadowed !== savedShadowed) {
                // 块内发生的 let/const 遮蔽只在块内生效:块结束后旧绑定恢复可见;
                // killed 一并回退 —— 遮蔽之后的赋值写给的是新绑定。
                state.shadowed = savedShadowed;
                state.killed = savedKilled;
            }
            return unsafe;
        }
        if (isLabeledStatement(stmt)) {
            if (!isBlockStatement(stmt.body)) return this.statementFlowUnsafe(stmt.body, name, state);
            const savedKilled = state.killed;
            const savedShadowed = state.shadowed;
            const unsafe = this.sequenceFlowUnsafe(stmt.body.body, 0, name, state);
            if (state.shadowed !== savedShadowed) {
                state.shadowed = savedShadowed;
                state.killed = savedKilled;
            }
            return unsafe;
        }
        if (isVariableDeclaration(stmt)) {
            for (const d of stmt.declarations) {
                if (isIdentifier(d.id) && d.id.name === name) {
                    if (stmt.kind === "let" || stmt.kind === "const") {
                        // 块级重新声明:静态作用域,声明处之后旧绑定不可见
                        // (同块内更早的读取会踩 TDZ,合法输出里不存在)
                        state.shadowed = true;
                        return false;
                    }
                    // var 是同一函数作用域绑定,条件执行的重新初始化不可靠,保守放弃
                    return true;
                }
                if (!state.killed && d.init && this.exprReadsUnsafe(d.init, name)) return true;
            }
            return false;
        }
        if (isIfStatement(stmt)) {
            if (!state.killed && this.exprReadsUnsafe(stmt.test, name)) return true;
            return this.branchFlowUnsafe(stmt.consequent, name, state.killed)
                || (!!stmt.alternate && this.branchFlowUnsafe(stmt.alternate, name, state.killed));
        }
        if (isWhileStatement(stmt) || isForStatement(stmt)
            || isForInStatement(stmt) || isForOfStatement(stmt)) {
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
        if (isDoWhileStatement(stmt)) {
            if (this.branchFlowUnsafe(stmt.body, name, state.killed)) return true;
            return !state.killed && this.exprReadsUnsafe(stmt.test, name);
        }
        if (isSwitchStatement(stmt)) {
            if (!state.killed && this.exprReadsUnsafe(stmt.discriminant, name)) return true;
            for (const c of stmt.cases) {
                if (c.test && !state.killed && this.exprReadsUnsafe(c.test, name)) return true;
                if (this.branchFlowUnsafeMultiple(c.consequent, name, state.killed)) return true;
            }
            return false;
        }
        if (isTryStatement(stmt)) {
            // block / finalizer 无条件执行,可以传播 kill;handler 条件执行。
            // 异常可能中断 block 提前进入 handler:handler/finalizer 检查时用进入前的 kill 状态。
            const saved = state.killed;
            const savedShadowed = state.shadowed;
            if (this.sequenceFlowUnsafe(stmt.block.body, 0, name, state)) return true;
            state.killed = saved;
            // block 内的 let/const 遮蔽只在 block 内生效
            state.shadowed = savedShadowed;
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
            if (isIdentifier(node) && node.name === name
                && parent && isReferenced(node, parent)) {
                read = true;
            }
            if (isVariableDeclaration(node)) {
                for (const d of node.declarations) {
                    if (isIdentifier(d.id) && d.id.name === name) redeclared = true;
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
        if (isIdentifier(expr) && expr.name === name) return true;
        let read = false;
        walkStatementSkipFunctions(expr, (node, parent) => {
            if (isIdentifier(node) && node.name === name
                && parent && isReferenced(node, parent)) {
                read = true;
            }
        });
        return read;
    }

    // ---------------------------------------------------------------- 工具

    /** 可能执行任意代码的表达式(调用/构造/await/yield/标签模板) */
    private isInvocation(node: TYPE.Node): boolean {
        return isCallExpression(node) || isNewExpression(node)
            || isAwaitExpression(node) || isYieldExpression(node)
            || isTaggedTemplateExpression(node);
    }

    /**
     * node 是否是对 name 的不安全写操作。
     * allowUndefinedRhs 为 true 时,`name = undefined/null/hole` 不算不安全;
     * 成员写(E.x = ... / E[x] = ... / E.x++ / delete E.x)和复合赋值(E += ...)一律不安全。
     */
    private isUnsafeWriteTo(node: TYPE.Node, name: string, allowUndefinedRhs: boolean): boolean {
        if (isAssignmentExpression(node)) {
            if (isIdentifier(node.left)) {
                if (node.left.name !== name) return false;
                if (node.operator !== "=") return true; // 复合赋值会读旧值
                return allowUndefinedRhs ? !isFalsyInitValue(node.right) : true;
            }
            return this.isMemberOf(node.left, name);
        }
        if (isUpdateExpression(node)) {
            return (isIdentifier(node.argument) && node.argument.name === name)
                || this.isMemberOf(node.argument, name);
        }
        if (isUnaryExpression(node) && node.operator === "delete") {
            return this.isMemberOf(node.argument, name);
        }
        return false;
    }

    private isMemberOf(node: TYPE.Node | null | undefined, name: string): boolean {
        return !!node && isMemberExpression(node) && !node.optional
            && isIdentifier(node.object) && node.object.name === name;
    }

    private hasNestedEnumWrite(scope: TYPE.Program | TYPE.BlockStatement, enumName: string): boolean {
        let found = false;
        walkNode(scope, (node) => {
            if (found) return false;
            if (isFunctionLike(node)) {
                const body = (node as TYPE.Function).body;
                if (isBlockStatement(body)) {
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
