import * as TYPE from "@babel/types";

/**
 * 临时变量优化 pass 的共享状态。
 *
 * TempVariableSimplify 原本是一个 4000+ 行的类,拆成多个模块后由这里统一持有
 * 可变状态;各模块通过基类 TempVariablePass 的访问器读写,避免把 `this.changed`
 * 改成逐处 `state.changed` 造成的无谓 diff。
 *
 * @Author: jmp0
 */
export interface PassState {
    /** 本轮是否修改过 AST */
    changed: boolean;
    /** 死存储清理的版本号,用于级联清理的轮数控制 */
    cleanupVersion: number;
    /** true:只做条件赋值折叠,不做复制传播等其他改写 */
    conditionsOnly: boolean;
    /** true:只折叠 `X = E; return X` 并清理失去引用的声明 */
    returnsOnly: boolean;
    /** true:只折叠累加器链(`X = E; X = F(X)`) */
    accumulatorOnly: boolean;
    /** true:只折叠 `X = E; if (X/!X/E/!E) { X = B }` 短路链 */
    shortCircuitOnly: boolean;
}

/** 单个函数内登记过的临时变量及其尚未被替换的引用。 */
export interface BindingInfo {
    name: string;
    /** 尚未被替换掉的引用节点 */
    refs: Set<TYPE.Node>;
    /** 是否被嵌套函数捕获(捕获的变量不做传播,避免闭包修改) */
    captured: boolean;
}

/** 复制传播环境中一条 temp -> 表达式的映射。 */
export interface EnvEntry {
    expr: TYPE.Expression;
    /** 定义所在的语句列表与下标(用于判断“紧邻下一条语句”的副作用搬移) */
    list: TYPE.Statement[];
    index: number;
    /** expr 中引用到的变量名,用于写入时级联失效 */
    deps: string[];
    /** 在当前定义有效期内,有多少次读取因为不安全而没有被替换 */
    unsubstitutedReads: number;
}

/** 一个函数(或 Program)在一次优化中共享的上下文。 */
export interface FunctionContext {
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
export interface LoopLive {
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

/** 超过该大小的右值不进入复制传播环境,避免表达式指数膨胀。 */
export const MAX_PROPAGATED_SIZE = 24;

/** 每个函数允许克隆的节点总数预算。 */
export const CLONE_BUDGET = 120000;

/** 创建一个新的 pass 状态(所有开关默认关闭)。 */
export function createPassState(): PassState {
    return {
        changed: false,
        cleanupVersion: 0,
        conditionsOnly: false,
        returnsOnly: false,
        accumulatorOnly: false,
        shortCircuitOnly: false,
    };
}
