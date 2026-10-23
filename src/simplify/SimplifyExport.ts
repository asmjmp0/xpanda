import * as TYPE from "@babel/types";
import { ISimplify } from "./ISimplify";
import { ReservedIdentifierSimplifier } from "./ReservedIdentifierSimplifier";
import { EnumSimplify } from "./EnumSimplify";
import { TempVariableSimplify } from "./TempVariableSimplify";
import { ConditionSimplify } from "./ConditionSimplify";
import { SyntaxRewriteSimplify } from "./SyntaxRewriteSimplify";
import { HighLevelGrammarSimplify } from "./HighLevelGrammarSimplify";
import { ClassSyntaxSimplify } from "./ClassSyntaxSimplify";
import { CallResultSimplify } from "./CallResultSimplify";
import { AccCallSimplify } from "./AccCallSimplify";
import { normalizeDeclarations } from "./NormalizeDeclarations";

/**
 * @Author: jmp0
 * @Email: jmp0@qq.com
 */
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
        new HighLevelGrammarSimplify().simplify(node);
        // HighLevelGrammarSimplify 会把 `if (!X) { X = true } else { X = false }`
        // 合成为 `X = !X`;这一步会和已有的 `X = !X`(callruntime.isfalse)形成新的
        // 连续自取反链,因此在末尾只针对条件赋值再做一轮折叠(不做复制传播,
        // 避免影响已稳定的输出)。
        TempVariableSimplify.foldConditionAssignments(node);
        // HighLevelGrammarSimplify 可能新生成 if/三元,再归一化一次 test,
        // 并把 `!T ? A : B` / `T ? false : B` 这类布尔三元折成逻辑运算
        SyntaxRewriteSimplify.normalizeConditionTests(node);
        // if (A || (v1 = 0, v2 = 2, B)) 里的纯常量前缀提到 if 前,
        // 避免条件里出现一串只给累加器/临时变量赋常量的 sequence
        SyntaxRewriteSimplify.hoistTestPrefixes(node);
        // 复合赋值放到最后一轮之后,避免提前改写成 += 后影响活跃性/复制传播
        SyntaxRewriteSimplify.foldCompoundAssignments(node);
    }
}
