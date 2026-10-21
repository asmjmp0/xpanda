import * as TYPE from "@babel/types";
import { ISimplify } from "./ISimplify";
import { ReservedIdentifierSimplifier } from "./ReservedIdentifierSimplifier";
import { TempVariableSimplify } from "./TempVariableSimplify";
import { SyntaxRewriteSimplify } from "./SyntaxRewriteSimplify";
import { HighLevelGrammarSimplify } from "./HighLevelGrammarSimplify";
import { ClassSyntaxSimplify } from "./ClassSyntaxSimplify";
import { CallResultSimplify } from "./CallResultSimplify";
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
    }
}
