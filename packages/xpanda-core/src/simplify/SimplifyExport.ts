import * as TYPE from "@babel/types";
import { ISimplify } from "./ISimplify";
import { ReservedIdentifierSimplifier } from "./ReservedIdentifierSimplifier";
import { EnumSimplify } from "./EnumSimplify";
import { TempVariableSimplify } from "./TempVariableSimplify";
import { ConditionSimplify } from "./ConditionSimplify";
import { SyntaxRewriteSimplify } from "./SyntaxRewriteSimplify";
import { HighLevelGrammarSimplify } from "./HighLevelGrammarSimplify";
import { ClassSyntaxSimplify } from "./ClassSyntaxSimplify";
import { ObjectLiteralSimplify } from "./ObjectLiteralSimplify";
import { NullishCoalescingSimplify } from "./NullishCoalescingSimplify";
import { CallResultSimplify } from "./CallResultSimplify";
import { AccCallSimplify } from "./AccCallSimplify";
import { TailMergeSimplify } from "./TailMergeSimplify";
import { normalizeDeclarations } from "./NormalizeDeclarations";

export class SimplifyExport {
    private static simplifyALL(node: TYPE.Program): boolean {
        const simplifyArr: Array<ISimplify> = [
            new ReservedIdentifierSimplifier(),
            new TempVariableSimplify(),
            new AccCallSimplify(),
            // 依赖 TempVariableSimplify/AccCallSimplify 先把累加器形态归一化:
            //   acc = "A"; v0 = acc; acc = "a"; p0[v0] = acc; ... acc = acc(v1);
            new EnumSimplify(),
            new ConditionSimplify(),
            new SyntaxRewriteSimplify(),
            new ClassSyntaxSimplify(),
            // 依赖 TempVariableSimplify 先把模板对象的别名/赋值归一化:
            //   acc = {k: null}; acc.k = E; return acc;
            new ObjectLiteralSimplify(),
        ];
        let changed = false;
        for (const simplify of simplifyArr) {
            if (simplify.simplify(node)) changed = true;
        }
        return changed;
    }

    public static simplify(node: TYPE.Program): void {
        normalizeDeclarations(node);
        new CallResultSimplify().simplify(node);
        // 定点迭代:大多数类 1~2 轮就稳定;上限 5 轮防止个别 pass 反复改写不收敛
        for (let round = 0; round < 5; round++) {
            if (!SimplifyExport.simplifyALL(node)) break;
        }
        // 超过 MAX_PROPAGATED_SIZE 的长右值进不了复制传播环境,嵌套累加链
        // (`acc = S; acc = acc + E + F > 0`)会原样留到迭代结束,导致
        // HighLevelGrammarSimplify 的三目合成对多语句分支匹配失败。先补折一次。
        TempVariableSimplify.foldAccumulatorAssignments(node);
        new HighLevelGrammarSimplify().simplify(node);
        // HighLevelGrammarSimplify 会把 `if (!T) { X = true } else { X = false }`
        // 合成 `X = !T`,这时才出现 `X = E; if (E) { X = !T }`;
        // 轮内的 foldShortCircuitChains 已经跑完,需要补折一次短路链。
        TempVariableSimplify.foldShortCircuitAssignments(node);
        // HighLevelGrammarSimplify 会把 nullish 检查合成 switch;这里还原成 ??
        new NullishCoalescingSimplify().simplify(node);
        // 只在条件表达式序列里出现的方法装载链(`acc = acc.method; acc = acc.call(recv, ...)`)
        // 不在语句列表里,常规 AccCallSimplify 扫不到。等到定点迭代/复制传播结束后再还原,
        // 避免中间形态在后续轮次被别名传播误解;随后由 foldMaterializedTestArtifacts 清理 acc 残留。
        AccCallSimplify.simplifySequences(node);
        // 条件物化残留要在所有“消费它”的 pass(nullish 合成、短路折叠等)跑完后再清:
        //   acc = !(v3 !== undefined); if (v3 !== undefined && (acc = call(), v3 = acc, acc === v2))
        // → if (v3 !== undefined && call() === v2);以及 `A || !(acc = X !== Y, X !== Y)` 的死保存元素
        ConditionSimplify.foldMaterializedTestArtifacts(node);
        // `if (C) { return/throw/break/continue ... } else { BODY }` 展开成守卫子句。
        // 放在三目合成之后(两分支都是单条 return 的 if/else 已合成为三目),
        // 同时让紧随其后的尾部折叠看到连续语句列表(累加器旧值的读取可能跨越 else)。
        SyntaxRewriteSimplify.flattenElseAfterExit(node);
        // HighLevelGrammarSimplify 的三目合成(`if (C) { X = A } else { X = B }` →
        // `X = C ? A : B`)发生在定点迭代之后,轮内的返回值折叠已经错过;
        // 这里补一轮 `X = E; return X` 折叠,并清理随之失去引用的声明。
        TempVariableSimplify.foldReturnAssignments(node);
        // HighLevelGrammarSimplify 会把 `if (!X) { X = true } else { X = false }`
        // 合成为 `X = !X`;这一步会和已有的 `X = !X`(callruntime.isfalse)形成新的
        // 连续自取反链,因此在末尾只针对条件赋值再做一轮折叠(不做复制传播,
        // 避免影响已稳定的输出)。
        TempVariableSimplify.foldConditionAssignments(node);
        // 条件里的赋值序列(`A && B && (obj.x = 1, C)`)还原成嵌套 if,
        // 让赋值落到分支体里,避免输出成逗号表达式。
        SyntaxRewriteSimplify.foldSequencedTestPrefixes(node);
        // HighLevelGrammarSimplify 可能新生成 if/三元,再归一化一次 test,
        // 并把 `!T ? A : B` / `T ? false : B` 这类布尔三元折成逻辑运算
        SyntaxRewriteSimplify.normalizeConditionTests(node);
        // normalizeConditionTests 会把布尔三目折成 `X = Y && Z`,暴露出新的临时别名链。
        // 再跑一次条件折叠(只做条件赋值/别名,不做整轮复制传播)并归一化 test。
        TempVariableSimplify.foldConditionAssignments(node);
        SyntaxRewriteSimplify.normalizeConditionTests(node);
        // normalizeConditionTests 可能把 `acc = 比较表达式; if (acc ...)` 重新物化进 test,
        // 再把测试序列里的取反链/死保存清一遍(与定点迭代前的同名步骤对应)。
        ConditionSimplify.foldMaterializedTestArtifacts(node);
        // if (A || (v1 = 0, v2 = 2, B)) 里的纯常量前缀提到 if 前,
        // 避免条件里出现一串只给累加器/临时变量赋常量的 sequence
        SyntaxRewriteSimplify.hoistTestPrefixes(node);
        // 复合赋值放到最后一轮之后,避免提前改写成 += 后影响活跃性/复制传播
        SyntaxRewriteSimplify.foldCompoundAssignments(node);
        // 守卫三目(`v14 ? v14.tabs : undefined` → `v14?.tabs`)、累加器死枢纽拷贝
        // (`acc = E; v14 = acc`)与 while(true)+break 形态的 for-of(含 `it.next`
        // 提升为临时方法量的 lowering)都在条件折叠之后才物化,这里统一还原。
        new HighLevelGrammarSimplify().simplifyTail(node);
        // 区域归约把共享尾块复制到每条路径:到这里各路径的语句形状已经归一化
        // (else 已展开、守卫链已合成 switch、可选链/for-of 已还原),再做重复
        // 尾块消除。必须放在 simplifyTail 之后:守卫链→switch 需要分支体保留
        // 末尾的 return,提前删掉会让 switch 合成失去形态。
        new TailMergeSimplify().simplify(node);
        // 静态可判定的 if 条件(如 finally 收尾被常量传播后的 `undefined == undefined`)
        SyntaxRewriteSimplify.foldConstantConditions(node);
        // ArkTS 13 try/finally / for...of 收尾残留的 `hole` 哨兵守卫
        SyntaxRewriteSimplify.foldSentinelGuards(node);
        // 上面两步可能留下不可达语句(如 `continue; throw hole;`)
        SyntaxRewriteSimplify.removeUnreachableStatements(node);
        // 循环归约残留的、落在循环外的 continue/break
        SyntaxRewriteSimplify.removeOrphanJumps(node);
        // newLexEnv 预留但从未读写的块级槽,以及随之变空的块
        TempVariableSimplify.removeUnusedLexicalDeclarations(node);
        // 所有结构改写(尾块合并/守卫三目/常量折叠)结束后,测试序列里的取反物化
        // 残渣可能才最终成形,最后清一遍。
        ConditionSimplify.foldMaterializedTestArtifacts(node);
        // 尾块消除/结构展开后,前面已经稳定的死存储可能重新变成死代码,补一轮清理。
        TempVariableSimplify.cleanupDeadStores(node);
    }
}
