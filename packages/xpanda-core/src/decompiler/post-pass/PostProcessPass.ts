import * as TYPE from "@babel/types";
import { flattenRethrowTryChains } from "./RethrowTryFlatten";
import { resolveReservedParams } from "./ReservedParamResolver";
import { normalizeLexicalSlotScopes } from "./NormalizeLexicalSlotScopes";

/**
 * 结构化分析之后、simplify 之前运行的后处理 pass。
 *
 * 这些 pass 只依赖成型的 AST(区域归约已经完成),不参与 simplify 的定点迭代:
 * 它们的输入形态/语义顺序一旦确定就不应被 simplify 重新打散。
 *
 * @Author: jmp0
 */
export interface IPostProcessPass {
    readonly name: string;
    /** @returns 是否修改了 AST */
    process(program: TYPE.Program): boolean;
}

const flattenRethrowTryChainsPass: IPostProcessPass = {
    name: "flatten-rethrow-try-chains",
    process: flattenRethrowTryChains,
};

const resolveReservedParamsPass: IPostProcessPass = {
    name: "resolve-reserved-params",
    process: resolveReservedParams,
};

const normalizeLexicalSlotScopesPass: IPostProcessPass = {
    name: "normalize-lexical-slot-scopes",
    process: normalizeLexicalSlotScopes,
};

/**
 * 顺序固定:
 *   1. class 定义的 rethrow try 壳先摊平,后续 pass 看到的是真实嵌套深度;
 *   2. 入口参数(p0/p1/p2 等)在 raw 输出阶段就还原,simplify 不再需要特判;
 *   3. newLexEnv 槽声明最后提升,此时所有语句位置/块结构都已稳定。
 */
export const POST_PROCESS_PASSES: readonly IPostProcessPass[] = [
    flattenRethrowTryChainsPass,
    resolveReservedParamsPass,
    normalizeLexicalSlotScopesPass,
];

export function runPostProcessPasses(program: TYPE.Program): void {
    for (const pass of POST_PROCESS_PASSES) {
        pass.process(program);
    }
}
