import { NodePath } from "@babel/traverse";
import * as TYPE from "@babel/types";
import {
    isCatchClause,
    isIdentifier,
    isReferenced,
    isProgram as isProgramNode,
} from "@babel/types";
import {
    collectAssignedNames,
    collectReadNames,
    collectReadWriteNames,
    collectReadsBeforeDefiniteWrite,
    isClassLike,
    isFunctionLike,
    isTempName,
    walkNode,
} from "../AstUtils";
import { FunctionContext } from "./types";
import { isCapturedBinding } from "./queries";

/**
 * 依赖 FunctionContext 的小工具:引用集合维护、临时变量读写集合、循环活跃上下文。
 * 这些函数只改传入的 ctx,不持有 pass 状态。
 *
 * @Author: jmp0
 */



export function removeRefs(node: TYPE.Node, ctx: FunctionContext): void {
    walkNode(node, (n) => {
        if (isIdentifier(n)) ctx.infos.get(n.name)?.refs.delete(n);
    });
}

export function registerCloneRefs(node: TYPE.Node, ctx: FunctionContext): void {
    walkNode(node, (n, parent) => {
        if (isIdentifier(n) && parent && isReferenced(n, parent)) {
            const info = ctx.infos.get(n.name);
            if (info) info.refs.add(n);
        }
    });
}

export function tempReads(node: TYPE.Node | null | undefined, ctx: FunctionContext): Set<string> {
    const result = new Set<string>();
    for (const name of collectReadNames(node)) {
        if (ctx.infos.has(name)) result.add(name);
    }
    return result;
}

export function tempWrites(node: TYPE.Node | null | undefined, ctx: FunctionContext): Set<string> {
    const result = new Set<string>();
    for (const name of collectAssignedNames(node)) {
        if (ctx.infos.has(name)) result.add(name);
    }
    return result;
}

/** 同时收集读取/写入;只保留当前函数里登记的临时变量名。 */
export function tempReadWrites(node: TYPE.Node | null | undefined, ctx: FunctionContext): { reads: Set<string>; writes: Set<string> } {
    const { reads, writes } = collectReadWriteNames(node);
    const tempReads = new Set<string>();
    const tempWrites = new Set<string>();
    for (const name of reads) if (ctx.infos.has(name)) tempReads.add(name);
    for (const name of writes) if (ctx.infos.has(name)) tempWrites.add(name);
    return { reads: tempReads, writes: tempWrites };
}

/**
 * 按求值顺序收集“在确定写入之前”被读取的临时变量名(见 AstUtils 同名工具)。
 *
 * 活跃性分析是按语句粒度做的:一条语句里既写又读同一个临时变量时
 *
 *   return v5 && (v7 = this.asRecord(...)) && v7.avatar ? ... : "";
 *
 * 按整条语句收集读取,会把“写入之后才发生的读取”也算成对旧值的依赖,前面
 * `v7 = this.asRecord` 这类为调用序列预装载寄存器的赋值就永远删不掉。
 */
export function tempReadsBeforeWrite(node: TYPE.Node | null | undefined, ctx: FunctionContext): Set<string> {
    return tempReadWritesBeforeStore(node, ctx).reads;
}

/** tempReadsBeforeWrite + 整条语句的全部写入(跳过嵌套函数/类)。 */
export function tempReadWritesBeforeStore(
    node: TYPE.Node | null | undefined,
    ctx: FunctionContext,
): { reads: Set<string>; writes: Set<string> } {
    const { reads, allWrites } = collectReadsBeforeDefiniteWrite(node);
    const filteredReads = new Set<string>();
    const filteredWrites = new Set<string>();
    for (const name of reads) if (ctx.infos.has(name)) filteredReads.add(name);
    for (const name of allWrites) if (ctx.infos.has(name)) filteredWrites.add(name);
    return { reads: filteredReads, writes: filteredWrites };
}

/** 复制传播后按当前 AST 重建临时变量的引用集合,修正被克隆/移动/删除的节点。 */
export function refreshBindingInfos(scope: any, ctx: FunctionContext): void {
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
        let captured = isCapturedBinding(binding, currentFunction);
        ctx.infos.set(name, { name, refs, captured });
    }
}

/**
 * 兼容路径:`catch (acc)` 的 acc 会遮蔽函数级 acc。
 *
 * 反编译器现在直接生成 `catch (catchAcc)` + handler 开头的 `acc = catchAcc`
 * (见 NodeFactory.tryStatementNode),正常不会再出现 `catch (acc)`;这里保留
 * 重命名是为了处理外部传入的 AST,避免优化器把 catch 参数和函数累加器混为一谈。
 */
export function renameCatchParameters(path: NodePath<TYPE.Program> | NodePath<TYPE.Function>, ctx: FunctionContext): boolean {
    let changed = false;
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
    if (!hasCatch) return false;

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
            changed = true;
        },
    });
    return changed;
}
