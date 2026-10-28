import * as TYPE from "@babel/types";
import {
    functionDeclaration,
    isAssignmentExpression,
    isBinaryExpression,
    isBlockStatement,
    isCallExpression,
    isExpressionStatement,
    isForInStatement,
    isForOfStatement,
    isFunctionExpression,
    isIdentifier,
    isMemberExpression,
    isOptionalCallExpression,
    isOptionalMemberExpression,
    isReferenced,
    isReturnStatement,
    isStringLiteral,
    isTryStatement,
    isUnaryExpression,
    isUpdateExpression,
    isVariableDeclaration,
    isVariableDeclarator,
    stringLiteral,
} from "@babel/types";
import {
    collectAssignedNames,
    collectIdentifierNames,
    collectReadNames,
    isClassLike,
    isDeclarationValue,
    isFunctionLike,
    isPureExpression,
    isTempName,
    replaceNodeInTree,
    walkNode,
} from "../AstUtils";
import { TempVariablePass } from "./base";
import { FunctionContext } from "./types";
import {
    canDeferTestValue,
    containsNode,
    countIdentifiers,
    countReadsInNode,
    hasDeferredSelfReference,
    hasHoistCandidate,
    isFirstEvaluatedOccurrence,
} from "./queries";
import { refreshBindingInfos } from "./context";

/**
 * 尾部/语句级赋值折叠:
 *   - `X = E; return X` -> `return E`
 *   - 累加器链 `X = E; X = F(X)` -> `X = F(E)`
 *   - 自更新 + 单次读取 `X = F(X); Y = <读 X 一次>` -> `Y = <F 代进读取位置>`
 *   - hub 别名 `X = E; Y = X` -> `Y = E`
 *   - 调用参数末次读取 `X = E; f(X)` -> `f(E)`
 *   - 命名函数表达式提升、字符串 split 数组还原
 *
 * 这些折叠主要服务于 HighLevelGrammarSimplify 在定点迭代之后才生成的三目/别名形态。
 *
 * @Author: jmp0
 */
export class AssignmentFolds extends TempVariablePass {

    /**
     * local_0_x = function add32(...) {...}; -> function add32(...) {...};
     * 同时把所有对 local_0_x 的引用改名,并删除对应声明。
     * 只处理函数体/Program 顶层的赋值,避免影响块级作用域语义。
     */
    /** X = E; return X; -> return E; */
    foldReturnAssignments(stmts: TYPE.Statement[], ctx: FunctionContext, loopHeadWrites?: Set<string>): void {
        // 先折累加器链:X = E; X = X + F -> X = E + F。
        // HighLevelGrammarSimplify 在定点迭代之后才把条件物化合成三元赋值,
        // 轮内已经跑过的复制传播来不及处理 acc = C ? A : B; acc = v0 + acc。
        if (this.returnsOnly) {
            // 累加器链必须先于别名折叠:X 的旧值可能先经过一次自读取
            // (`acc = C ? A : B; acc = acc.trim(); Y = acc`),先折链得到
            // `acc = (C ? A : B).trim()`,别名折叠才能整块搬进 Y;
            // 反过来会留下无人的 `acc = C ? A : B` 死存储。
            this.foldAccumulatorChains(stmts, ctx);
            // `X = E; Y = X`(X 之后已死)-> `Y = E`,同样针对尾部才生成的三元赋值。
            this.foldTempAliasAssignments(stmts, ctx, loopHeadWrites);
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
        for (const stmt of stmts) this.foldReturnAssignmentsInChildren(stmt, ctx, loopHeadWrites);
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
        if (hasDeferredSelfReference(assign.right, name)) return false;
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
        if (hasDeferredSelfReference(returnStmt.argument, name)) return false;
        if (countReadsInNode(returnStmt.argument, name) !== 1) return false;
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
            if (!isFirstEvaluatedOccurrence(returnStmt.argument, id)) return false;
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
     * 累加器链:`X = E; X = <只读取一次 X 的表达式>` -> `X = ...E...`。
     *
     * 编译器为字符串拼接生成 `v0 = v0 + "..."; acc = v0 + acc; return acc + "}"`,
     * 这些语句各自只消费旧值一次,可以整体合并成一个表达式。E 含有调用(如
     * `p0.map(...).join(...)`)时复制传播不允许克隆,只能靠本方法整块搬移。
     *
     * 不只限二元运算:成员调用链(`X = E; X = X.trim()`)和成员装载链
     * (`X = E; X = X.length`)同样只读取旧值一次,由下面的求值位置/纯度检查
     * 兜底(读取位置不是最先求值时才要求 E 纯)。
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
        if (countReadsInNode(b.right, name) !== 1) return false;
        if (collectAssignedNames(b.right).has(name)) return false;
        // 闭包里对 X 的延迟读取在两种写法里看到的都是最终值,但立即执行的闭包
        // (IIFE)会读到不同的旧值,保守跳过。
        if (hasDeferredSelfReference(a.right, name) || hasDeferredSelfReference(b.right, name)) return false;

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
        if (!isFirstEvaluatedOccurrence(b.right, id)) {
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
    private foldTempAliasAssignments(stmts: TYPE.Statement[], ctx: FunctionContext, loopHeadWrites?: Set<string>): void {
        for (let i = 0; i + 1 < stmts.length; i++) {
            // 合并后的 Y = E 仍可能继续作为下一条 `Z = Y` 的来源
            while (i + 1 < stmts.length && this.tryFoldTempAlias(stmts, i, ctx, loopHeadWrites)) {
                // retry same index
            }
        }
    }
    private tryFoldTempAlias(
        stmts: TYPE.Statement[], i: number, ctx: FunctionContext, loopHeadWrites?: Set<string>,
    ): boolean {
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
        // 成员目标不做读取重定向(搬移后目标不是一个变量,无法用它替换读取)。
        let targetName: string | null = null;
        if (isIdentifier(b.left)) {
            if (!isTempName(b.left.name) || b.left.name === source) return false;
            targetName = b.left.name;
        } else if (isMemberExpression(b.left)) {
            const member = b.left;
            if (!isPureExpression(member.object as TYPE.Expression)) return false;
            if (member.computed && !isPureExpression(member.property as TYPE.Expression)) return false;
        } else {
            return false;
        }
        const info = ctx.infos.get(source);
        if (!info || info.captured) return false;
        // X 的旧值在第二条语句之后必须已死;闭包里的读取由 captured 兜底。
        // 如果 X 之后仍被读取,先把这些读取(下一次写入 X 之前)改看 Y,
        // 旧值随之死掉——典型:
        //   acc = E; v5 = acc; if (acc.length === 0) {...} f(acc); acc = G; ...
        // 这里 acc 的前两个读取都属于 hub 时的值,不能因为后面还有第二次写入就放弃。
        const liveAfter = ctx.liveAfter.get(second);
        if (!liveAfter || liveAfter.has(source)) {
            if (!targetName) return false;
            if (!this.redirectReadsUntilWrite(stmts, i + 2, source, targetName, ctx, loopHeadWrites)) return false;
        }
        info.refs.delete(b.right);
        b.right = a.right;
        stmts.splice(i, 1);
        this.changed = true;
        return true;
    }
    /**
     * 从 list[start] 起按源码顺序把对 source 的读取改成 target,直到遇到对 source
     * 的无条件写入。`X = E; Y = X; ...` 把 X 的旧值整体搬进 Y 后,这些读取都要看 Y。
     *
     * 扫描停止/放弃规则(保证每次被改写的读取都仍读 Hub 时的值):
     *   - 语句本身是 `X = <expr>`(含复合赋值/自增):条件必然成立,之后的读取都看
     *     新值,停止;右值里的自读取发生在写入之前,先改写再停止。
     *   - 其它语句里出现对 X 或 target 的写入(分支/循环/异常路径):无法确定
     *     读取与写入的先后,放弃本次折叠。
     *   - 没有写入的语句:改写其中全部读取(嵌套函数/类跳过,由 captured 兜底)。
     */
    private redirectReadsUntilWrite(
        list: TYPE.Statement[], start: number, source: string, targetName: string,
        ctx: FunctionContext, loopHeadWrites?: Set<string>,
    ): boolean {
        // 先只做检查、收集需要改写的节点:中途放弃时不能留下改了一半的 AST
        // (否则读取被改成 target、写入却被保留,两边的值都对不上)。
        const pending: TYPE.Node[] = [];
        let stopped = false;
        for (let k = start; k < list.length; k++) {
            const statement = list[k];
            const unconditional = isExpressionStatement(statement) && (
                (isAssignmentExpression(statement.expression) && isIdentifier(statement.expression.left)
                    && statement.expression.left.name === source)
                || (isUpdateExpression(statement.expression) && isIdentifier(statement.expression.argument)
                    && statement.expression.argument.name === source));
            if (unconditional) {
                const expression = (statement as TYPE.ExpressionStatement).expression;
                if (isAssignmentExpression(expression)) {
                    const rhs = expression.right;
                    if (collectAssignedNames(rhs).has(source) || collectAssignedNames(rhs).has(targetName)) return false;
                    pending.push(rhs);
                }
                stopped = true;
                break;
            }
            const assigned = collectAssignedNames(statement);
            if (assigned.has(source) || assigned.has(targetName)) return false;
            pending.push(statement);
        }
        if (!stopped) {
            // 本列表内始终没有对 source 的写入:source 的旧值可能在本列表之外仍被读取,
            // 那些读取不在当前列表里,改不到 target。此时搬移会让 source 丢掉唯一的赋值
            // (`{ acc = class ...; local = acc; } X = acc;` 是旧版字节码定义类的常见形态),
            // 输出里 `X = acc` 就只剩一个从未赋值过的 acc,所以放弃本次折叠。
            // 例外:列表是循环体时,循环头在下一轮进入 body 前必定重写循环变量
            // (`for (v13 of xs) { v13 = f(v13); acc = v13 }`),这类活跃性来自回边,
            // 不算“列表之外的读取”。
            const last = list[list.length - 1];
            const liveOut = last ? ctx.liveAfter.get(last) : undefined;
            if (!liveOut) return false;
            if (liveOut.has(source) && !loopHeadWrites?.has(source)) return false;
        }
        for (const node of pending) this.rewriteReadsInNode(node, source, targetName);
        return true;
    }
    /** 把 node 子树上对 source 的读取(标识符引用)改名为 target;跳过嵌套函数/类 */
    private rewriteReadsInNode(node: TYPE.Node, source: string, target: string): void {
        walkNode(node, (current, parent) => {
            if (isFunctionLike(current) || isClassLike(current)) return false;
            if (isIdentifier(current) && current.name === source && parent && isReferenced(current, parent)) {
                current.name = target;
            }
            return true;
        });
    }
    /**
     * `X = F(X); Y = <只读一次 X 的表达式>` -> `Y = <F 代进读取位置>`。
     *
     * 条件三目 lowering 常在分支里留下“先把索引/计数更新一步,再用新值取一次”的
     * 形态:
     *   if (nl >= 0) { nl = nl + 1; acc = pending.substring(nl); } else { acc = "" }
     * 更新值只被下一条语句读取一次且之后 X 已死,把 `nl + 1` 直接代进读取位置,
     * 分支就只剩一条赋值,后续三目合成才能还原 `pending.substring(nl + 1)`。
     * 只处理纯右值;F 的其它依赖不能在消费语句里被改写。
     */
    foldSelfUpdateIntoNextRead(stmts: TYPE.Statement[], ctx: FunctionContext): void {
        for (let i = 0; i + 1 < stmts.length; i++) {
            if (this.tryFoldSelfUpdateIntoNextRead(stmts, i, ctx)) i--;
        }
        for (const stmt of stmts) this.foldSelfUpdateIntoNextReadChildren(stmt, ctx);
    }
    private tryFoldSelfUpdateIntoNextRead(stmts: TYPE.Statement[], i: number, ctx: FunctionContext): boolean {
        const first = stmts[i];
        const second = stmts[i + 1];
        if (!isExpressionStatement(first) || !isAssignmentExpression(first.expression)) return false;
        if (!isExpressionStatement(second)) return false;
        const a = first.expression;
        if (a.operator !== "=" || !isIdentifier(a.left)) return false;
        const name = a.left.name;
        if (!isTempName(name) || isDeclarationValue(a.right)) return false;
        // 累加器有专门的条件物化/方法装载折叠,这里不要抢先改写它的形态
        if (name === "acc") return false;
        // 前一条语句还在写同一个变量时属于累加链(X = E; X = X + F),留给累加链折叠。
        // hubOnly(流水线最后一步)只处理紧跟 try 之后的字符串拼接链:前面每一步折叠后,
        // 下一条语句的前驱仍然是同一个 TryStatement。
        if (this.hubOnly) {
            if (i === 0 || !isTryStatement(stmts[i - 1]) || !containsStringLiteral(a.right)) return false;
        } else if (i > 0 && collectAssignedNames(stmts[i - 1]).has(name)) {
            return false;
        }
        const info = ctx.infos.get(name);
        if (!info || info.captured) return false;
        // 右值必须只读一次旧值,否则搬进消费位置后旧值会被读到多次
        if (countReadsInNode(a.right, name) !== 1) return false;
        if (collectAssignedNames(a.right).has(name)) return false;
        // 算术/位运算/一元取反这类自更新,以及成员装载 `X = X.prop`
        // (`v0 = v0.text; acc = v0.substring(...)`)都能整体代进下一条语句。
        // 同名目标的 `X = X.prop; X = f(X)` 已由 foldSelfReadChains 先折叠。
        const selfLoad = isMemberExpression(a.right) || isOptionalMemberExpression(a.right);
        if (!isBinaryExpression(a.right) && !isUnaryExpression(a.right) && !selfLoad) return false;
        if (!isPureExpression(a.right)) return false;
        const consumer = second.expression;
        if (collectAssignedNames(consumer).has(name)) return false;
        if (countReadsInNode(consumer, name) !== 1) return false;
        const liveAfter = ctx.liveAfter.get(second);
        if (!liveAfter || liveAfter.has(name)) return false;
        // 右值依赖的其它名字不能在消费语句里被改写
        const assigned = collectAssignedNames(consumer);
        for (const dep of collectIdentifierNames(a.right)) {
            if (dep !== name && assigned.has(dep)) return false;
        }
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
        // 非成员装载的右值若被消费成方法装载(`X = F(X); Y = X.call(...)`),
        // 交给 AccCallSimplify;成员装载的读取本身就是接收者/参数,搬移安全。
        if (!selfLoad && (isCallExpression(consumer) || isOptionalCallExpression(consumer))
            && containsNode(consumer.callee, id)) return false;
        if (!canDeferTestValue(a.right, consumer, id)) return false;
        info.refs.delete(id);
        if (!replaceNodeInTree(consumer, id, a.right)) return false;
        stmts.splice(i, 1);
        this.changed = true;
        return true;
    }
    private foldSelfUpdateIntoNextReadChildren(stmt: TYPE.Statement, ctx: FunctionContext): void {
        switch (stmt.type) {
            case "BlockStatement":
                this.foldSelfUpdateIntoNextRead(stmt.body, ctx);
                break;
            case "IfStatement":
                if (isBlockStatement(stmt.consequent)) this.foldSelfUpdateIntoNextRead(stmt.consequent.body, ctx);
                else this.foldSelfUpdateIntoNextReadChildren(stmt.consequent, ctx);
                if (stmt.alternate) {
                    if (isBlockStatement(stmt.alternate)) this.foldSelfUpdateIntoNextRead(stmt.alternate.body, ctx);
                    else this.foldSelfUpdateIntoNextReadChildren(stmt.alternate, ctx);
                }
                break;
            case "WhileStatement":
            case "DoWhileStatement":
            case "ForStatement":
            case "ForInStatement":
            case "ForOfStatement":
            case "LabeledStatement":
                if (isBlockStatement(stmt.body)) this.foldSelfUpdateIntoNextRead(stmt.body.body, ctx);
                else this.foldSelfUpdateIntoNextReadChildren(stmt.body, ctx);
                break;
            case "TryStatement":
                if (isBlockStatement(stmt.block)) this.foldSelfUpdateIntoNextRead(stmt.block.body, ctx);
                if (stmt.handler) this.foldSelfUpdateIntoNextRead(stmt.handler.body.body, ctx);
                if (stmt.finalizer) this.foldSelfUpdateIntoNextRead(stmt.finalizer.body, ctx);
                break;
            case "SwitchStatement":
                for (const c of stmt.cases) this.foldSelfUpdateIntoNextRead(c.consequent, ctx);
                break;
            default:
                break;
        }
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
        if (countReadsInNode(consumer, name) !== 1) return false;
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
        if (containsNode(consumer.callee, id)) return false;
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
     * 尾部补齐:`X = E; Y = <只读取一次 X 的表达式>` -> `Y = <E 代进去>`。
     *
     * 可选链(`tryRestoreOptionalChain`)和 `??` 还原发生在流水线尾部/三目合成
     * 之后,轮内的复制传播/别名折叠看不到这些中间形态,典型残留:
     *   acc = v20?.client; v6 = asRecord(acc);
     *   acc = local_0_5(x) ?? ""; v14 = parseFlags(acc);
     *   acc = !v17; v4 = acc ? "content" : "none";
     * 要求 X 未被捕获、消费语句里只读一次且不写 X、语句之后 X 已死,E 的
     * 搬移不改变求值顺序(见 canDeferTestValue)。只处理右值位置。
     */
    foldTempLastUseIntoNextRead(stmts: TYPE.Statement[], ctx: FunctionContext): void {
        for (let i = 0; i + 1 < stmts.length; i++) {
            if (!this.tryFoldTempIntoNextRead(stmts, i, ctx)) continue;
            i--;
        }
        for (const stmt of stmts) this.foldTempLastUseIntoNextReadInChildren(stmt, ctx);
    }

    private tryFoldTempIntoNextRead(stmts: TYPE.Statement[], i: number, ctx: FunctionContext): boolean {
        const first = stmts[i];
        const second = stmts[i + 1];
        if (!isExpressionStatement(first) || !isAssignmentExpression(first.expression)) return false;
        if (!isExpressionStatement(second) || !isAssignmentExpression(second.expression)) return false;
        const a = first.expression;
        const b = second.expression;
        if (a.operator !== "=" || !isIdentifier(a.left)) return false;
        if (b.operator !== "=") return false;
        const name = a.left.name;
        if (!isTempName(name) || isDeclarationValue(a.right)) return false;
        // 右值自引用(`X = F(X)`)属于累加器链,交给 foldAccumulatorChains。
        if (collectReadNames(a.right).has(name)) return false;
        const info = ctx.infos.get(name);
        if (!info || info.captured) return false;
        // 消费语句里不得写入 X(如 `f((X = 1))`),否则删掉赋值会改变写入次数。
        if (collectAssignedNames(second).has(name)) return false;
        const target = b.right as TYPE.Expression;
        // 左值在右值之前求值:成员左值必须无副作用(否则 E 被推后求值会改变
        // 与左值副作用之间的顺序),且 E 不能写左值读取的名字。
        if (!isIdentifier(b.left)) {
            if (!isMemberExpression(b.left) && !isOptionalMemberExpression(b.left)) return false;
            const member = b.left as TYPE.MemberExpression;
            if (!isPureExpression(member.object)) return false;
            if (member.computed && !isPureExpression(member.property as TYPE.Expression)) return false;
            const leftReads = collectIdentifierNames(member);
            for (const written of collectAssignedNames(a.right)) {
                if (leftReads.has(written)) return false;
            }
        }
        if (countReadsInNode(target, name) !== 1) return false;
        const liveAfter = ctx.liveAfter.get(second);
        if (!liveAfter || liveAfter.has(name)) return false;
        // 消费位置就是 X 本身(`Y = X`):根节点没有 parent,walkNode 里按
        // `parent && isReferenced` 找不到它;这里直接改写右值。
        if (isIdentifier(target) && target.name === name) {
            info.refs.delete(target);
            b.right = a.right;
            stmts.splice(i, 1);
            this.changed = true;
            return true;
        }

        let id: TYPE.Identifier | null = null;
        walkNode(target, (node, parent) => {
            if (isFunctionLike(node) || isClassLike(node)) return false;
            if (isIdentifier(node) && node.name === name && parent && isReferenced(node, parent)) {
                id = node;
                return false;
            }
            return true;
        });
        if (!id) return false;
        // callee 位置的读取是方法装载形态,交给 AccCallSimplify。
        if ((isCallExpression(target) || isOptionalCallExpression(target)) && containsNode(target.callee, id)) {
            return false;
        }
        if (!canDeferTestValue(a.right, target, id)) return false;

        info.refs.delete(id);
        if (!replaceNodeInTree(target, id, a.right)) return false;
        stmts.splice(i, 1);
        this.changed = true;
        return true;
    }

    private foldTempLastUseIntoNextReadInChildren(stmt: TYPE.Statement, ctx: FunctionContext): void {
        switch (stmt.type) {
            case "BlockStatement":
                this.foldTempLastUseIntoNextRead(stmt.body, ctx);
                break;
            case "IfStatement":
                if (isBlockStatement(stmt.consequent)) this.foldTempLastUseIntoNextRead(stmt.consequent.body, ctx);
                else this.foldTempLastUseIntoNextReadInChildren(stmt.consequent, ctx);
                if (stmt.alternate) {
                    if (isBlockStatement(stmt.alternate)) this.foldTempLastUseIntoNextRead(stmt.alternate.body, ctx);
                    else this.foldTempLastUseIntoNextReadInChildren(stmt.alternate, ctx);
                }
                break;
            case "WhileStatement":
            case "DoWhileStatement":
            case "ForStatement":
            case "ForInStatement":
            case "ForOfStatement":
            case "LabeledStatement":
                if (isBlockStatement(stmt.body)) this.foldTempLastUseIntoNextRead(stmt.body.body, ctx);
                else this.foldTempLastUseIntoNextReadInChildren(stmt.body, ctx);
                break;
            case "TryStatement":
                if (isBlockStatement(stmt.block)) this.foldTempLastUseIntoNextRead(stmt.block.body, ctx);
                if (stmt.handler) this.foldTempLastUseIntoNextRead(stmt.handler.body.body, ctx);
                if (stmt.finalizer) this.foldTempLastUseIntoNextRead(stmt.finalizer.body, ctx);
                break;
            case "SwitchStatement":
                for (const c of stmt.cases) this.foldTempLastUseIntoNextRead(c.consequent, ctx);
                break;
            default:
                break;
        }
    }

    private foldReturnAssignmentsInChildren(stmt: TYPE.Statement, ctx: FunctionContext, loopHeadWrites?: Set<string>): void {
        switch (stmt.type) {
            case "BlockStatement":
                this.foldReturnAssignments(stmt.body, ctx, loopHeadWrites);
                break;
            case "IfStatement":
                if (isBlockStatement(stmt.consequent)) this.foldReturnAssignments(stmt.consequent.body, ctx, loopHeadWrites);
                else this.foldReturnAssignmentsInChildren(stmt.consequent, ctx, loopHeadWrites);
                if (stmt.alternate) {
                    if (isBlockStatement(stmt.alternate)) this.foldReturnAssignments(stmt.alternate.body, ctx, loopHeadWrites);
                    else this.foldReturnAssignmentsInChildren(stmt.alternate, ctx, loopHeadWrites);
                }
                break;
            case "WhileStatement":
            case "DoWhileStatement":
            case "ForStatement":
            case "ForInStatement":
            case "ForOfStatement":
                if (isBlockStatement(stmt.body)) this.foldReturnAssignments(stmt.body.body, ctx, loopHeadWritesOf(stmt));
                else this.foldReturnAssignmentsInChildren(stmt.body, ctx, loopHeadWritesOf(stmt));
                break;
            case "LabeledStatement":
                if (isBlockStatement(stmt.body)) this.foldReturnAssignments(stmt.body.body, ctx, loopHeadWrites);
                else this.foldReturnAssignmentsInChildren(stmt.body, ctx, loopHeadWrites);
                break;
            case "TryStatement":
                if (isBlockStatement(stmt.block)) this.foldReturnAssignments(stmt.block.body, ctx, loopHeadWrites);
                if (stmt.handler) this.foldReturnAssignments(stmt.handler.body.body, ctx, loopHeadWrites);
                if (stmt.finalizer) this.foldReturnAssignments(stmt.finalizer.body, ctx, loopHeadWrites);
                break;
            case "SwitchStatement":
                for (const c of stmt.cases) this.foldReturnAssignments(c.consequent, ctx, loopHeadWrites);
                break;
            default:
                break;
        }
    }
    /**
     * foldAccumulatorChains 的递归版:累加链大多位于 if 分支/循环体等嵌套块里。
     * 先折当前列表,再逐条语句下钻,保证任意深度的嵌套块都被处理。
     */
    foldAccumulatorChainsDeep(stmts: TYPE.Statement[], ctx: FunctionContext): void {
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
    hoistNamedFunctionExpressions(stmts: TYPE.Statement[], ctx: FunctionContext, scope: any): void {
        // 没有候选时直接返回,避免每轮都遍历整棵子树(含嵌套函数)
        if (!hasHoistCandidate(stmts)) return;
        // 复制传播/死存储清理会克隆或移动节点,processScope 开始时建立的
        // binding.referencePaths 已经过期(克隆出来的引用不在 refs 里)。
        // 若直接按旧 refs 改名并删除声明,会留下未声明的 local_* 引用。
        refreshBindingInfos(scope, ctx);

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
            if ((nameCounts.get(functionName) || 0) !== countIdentifiers(stmt, functionName)) continue;

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
    /** X = "abcdef".split(""); ... X[i] ... -> 直接使用 "abcdef"[i],删除 X。 */
    foldSplitStringArrays(stmts: TYPE.Statement[], ctx: FunctionContext): void {
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
}

/**
 * 循环头在“下一轮进入 body 之前”必定写入的名字。
 *
 * 列表走到底仍没有对 X 的写入时,`redirectReadsUntilWrite` 会把列表末尾的活跃集当作
 * “列表之外仍会读取 X”的证据而放弃折叠;但循环体末尾的活跃集含回边上的读取
 * (`for (v13 of xs) { v13 = f(v13); acc = v13 }` 里 v13 在 body 开头被读),
 * 循环头其实会在下一轮重写这些名字,删掉 body 里的写入依然安全。
 */
function loopHeadWritesOf(stmt: TYPE.Statement): Set<string> {
    const writes = new Set<string>();
    const addPattern = (node: TYPE.Node | null | undefined): void => {
        if (!node) return;
        switch (node.type) {
            case "Identifier":
                writes.add(node.name);
                break;
            case "ObjectPattern":
                for (const property of node.properties) {
                    addPattern(property.type === "RestElement" ? property.argument : property.value);
                }
                break;
            case "ArrayPattern":
                for (const element of node.elements) addPattern(element);
                break;
            case "AssignmentPattern":
                addPattern(node.left);
                break;
            case "RestElement":
                addPattern(node.argument);
                break;
            default:
                break;
        }
    };
    switch (stmt.type) {
        case "ForOfStatement":
        case "ForInStatement": {
            const left = (stmt as TYPE.ForOfStatement).left;
            if (left.type === "VariableDeclaration") {
                for (const declarator of left.declarations) addPattern(declarator.id);
            } else {
                addPattern(left);
            }
            break;
        }
        case "ForStatement": {
            const update = (stmt as TYPE.ForStatement).update;
            if (update) for (const name of collectAssignedNames(update)) writes.add(name);
            break;
        }
        case "WhileStatement":
            for (const name of collectAssignedNames((stmt as TYPE.WhileStatement).test)) writes.add(name);
            break;
        case "DoWhileStatement":
            for (const name of collectAssignedNames((stmt as TYPE.DoWhileStatement).test)) writes.add(name);
            break;
        default:
            break;
    }
    return writes;
}


/** 表达式里是否出现字符串字面量(只用于 hubOnly 的字符串拼接链)。 */
function containsStringLiteral(node: TYPE.Node | null | undefined): boolean {
    let found = false;
    walkNode(node, (n) => {
        if (isStringLiteral(n)) { found = true; return false; }
        if (isFunctionLike(n) || isClassLike(n)) return false;
        return true;
    });
    return found;
}
