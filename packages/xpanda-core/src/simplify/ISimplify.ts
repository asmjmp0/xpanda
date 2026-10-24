import * as TYPE from '@babel/types';

/**
 * @Author: jmp0
 * @Email: jmp0@qq.com
 */
export interface ISimplify {
    /**
     * @returns 是否修改了 AST。SimplifyExport 用它做定点迭代,避免固定跑 5 轮。
     */
    simplify(node: TYPE.Program): boolean;
}
