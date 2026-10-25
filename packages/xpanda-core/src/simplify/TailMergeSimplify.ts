import * as TYPE from "@babel/types";
import traverse, { NodePath } from "@babel/traverse";
import { ISimplify } from "./ISimplify";
import {
    isClassLike,
    isFunctionLike,
    isNodeEqual,
    walkNode,
} from "./AstUtils";

const {
    file,
    isBlockStatement,
    isIfStatement,
    isStatement,
} = TYPE;

/**
 * 重复尾块消除。
 *
 * 区域归约没有 goto,共享的返回尾块会被复制进每一条归约路径,典型形态:
 *
 *   if (v10) {
 *     ...
 *     if (v12) {
 *       ...
 *       <尾块>
 *     }
 *     <尾块>            <- 与内层那份逐字相同
 *   }
 *   <尾块>
 *
 * 分支走到末尾本来就会继续执行分支之后的代码:分支尾部的语句如果和"紧接着
 * 会执行到的语句"逐字相同,删掉分支里的副本语义不变(同一批语句仍然只求值
 * 一次,求值顺序也相同)。删掉一层后里层同样的结构会暴露出来,逐层收敛后
 * 共享尾块只剩一份。
 *
 * "紧接着会执行的语句"按执行流计算:同一语句列表里的后续语句;列表结束且
 * 列表属于 if 分支/普通块/标签块时,继续到外层列表里该语句之后的语句。
 * 循环体(落空会回到循环头)、catch/finally、switch case(落空会进下一个
 * case)、函数体处停止。
 *
 * 安全约束:
 *   - 只处理 if/else 块分支;
 *   - 段尾必须以 return/throw/break/continue 结束:只有此时原路径在副本处就离开
 *     当前结构,落到外层那份时不会在同一路径上第二次执行。非终结段(`v3 += 1`
 *     之后紧跟同样的自增)删掉会少执行一次,必须保留;
 *   - 被删除的语句里不能有任何声明:块级声明在两个位置是不同绑定,
 *     var/函数/类声明的提升与初始化时机也会随位置变化;
 *   - 分支自身声明的名字不能被被删除的语句命中(catch 参数、块内 let 等会
 *     让同名标识符在分支里解析成局部绑定,删掉后改用外层绑定);
 *   - 表达式求值次数不变(终结路径上的语句仍只求值一次),因此不要求表达式纯净。
 *
 * @Author: jmp0
 */
export class TailMergeSimplify implements ISimplify {
    /** 逐层收敛的上限,远大于实际嵌套深度 */
    private static readonly MAX_ROUNDS = 16;

    simplify(node: TYPE.Program): boolean {
        let changed = false;
        for (let round = 0; round < TailMergeSimplify.MAX_ROUNDS; round++) {
            let roundChanged = false;
            traverse(file(node), {
                noScope: true,
                BlockStatement: (path) => {
                    if (this.mergeList(path)) roundChanged = true;
                },
                Program: (path) => {
                    if (this.mergeList(path)) roundChanged = true;
                },
            });
            if (!roundChanged) break;
            changed = true;
        }
        return changed;
    }

    /** 处理一个语句列表:每个 if/else 块分支的末尾都可能与后续语句重复。 */
    private mergeList(listPath: NodePath<TYPE.BlockStatement> | NodePath<TYPE.Program>): boolean {
        const body = listPath.node.body;
        let changed = false;
        for (let i = 0; i < body.length; i++) {
            const stmt = body[i];
            if (!isIfStatement(stmt)) continue;
            const continuation = this.continuationAfter(listPath, i);
            if (continuation.length === 0) continue;
            if (this.trimTrailingDuplicate(stmt.consequent, continuation)) changed = true;
            if (stmt.alternate && this.trimTrailingDuplicate(stmt.alternate, continuation)) {
                changed = true;
            }
        }
        return changed;
    }

    /**
     * 语句之后按执行流紧接着会执行的语句(可能跨多个语句列表)。
     * 循环体/catch/finally/switch case/函数体处停止:落空后的走向不是外层后续语句。
     */
    private continuationAfter(listPath: NodePath<any>, index: number): TYPE.Statement[] {
        const out: TYPE.Statement[] = [];
        let current: NodePath<any> = listPath;
        let childIndex = index;
        for (let guard = 0; guard < 64; guard++) {
            const list = current.node.body as Array<TYPE.Statement | TYPE.ModuleDeclaration>;
            for (let i = childIndex + 1; i < list.length; i++) {
                if (isStatement(list[i])) out.push(list[i] as TYPE.Statement);
            }
            const container = current.parentPath;
            if (!container) break;
            if (container.isIfStatement()) {
                // 列表是 if 的 consequent/alternate:越过后继续 if 之后的语句
                const parentList = container.parentPath;
                if (!parentList || !(parentList.isBlockStatement() || parentList.isProgram())) break;
                const siblings: Array<TYPE.Statement | TYPE.ModuleDeclaration> = parentList.node.body as any;
                const idx = siblings.indexOf(container.node as any);
                if (idx < 0) break;
                current = parentList as NodePath<any>;
                childIndex = idx;
                continue;
            }
            if (container.isLabeledStatement()) {
                const parentList = container.parentPath;
                if (!parentList || !(parentList.isBlockStatement() || parentList.isProgram())) break;
                const siblings: Array<TYPE.Statement | TYPE.ModuleDeclaration> = parentList.node.body as any;
                const idx = siblings.indexOf(container.node as any);
                if (idx < 0) break;
                current = parentList as NodePath<any>;
                childIndex = idx;
                continue;
            }
            if (container.isBlockStatement() || container.isProgram()) {
                // 裸块:落空后执行块之后的语句
                const parentList = container.parentPath;
                if (!parentList || !(parentList.isBlockStatement() || parentList.isProgram())) break;
                const siblings: Array<TYPE.Statement | TYPE.ModuleDeclaration> = parentList.node.body as any;
                const idx = siblings.indexOf(container.node as any);
                if (idx < 0) break;
                current = parentList as NodePath<any>;
                childIndex = idx;
                continue;
            }
            // 循环体 / catch / finally / switch case / 函数体:落空后的去向不是外层后续语句
            break;
        }
        return out;
    }

    /**
     * 删除块分支末尾与 continuation 前缀逐字相同的语句段。
     * 分支的后缀要和续接语句的前缀逐条对齐(不是"分支最后一条对应续接第一条"),
     * 从最长的候选长度往短试,第一个通过安全校验的后缀落地。
     */
    private trimTrailingDuplicate(
        branch: TYPE.Statement,
        continuation: TYPE.Statement[],
    ): boolean {
        if (!isBlockStatement(branch)) return false;
        const list = branch.body;
        const maxK = Math.min(list.length, continuation.length);
        for (let k = maxK; k >= 1; k--) {
            // 先比较对齐后的第一条,不同直接跳过,避免对每对尾部做深层比较
            const first = list[list.length - k];
            const firstOuter = continuation[0];
            if (first.type !== firstOuter.type) continue;
            if (!isNodeEqual(first, firstOuter)) continue;
            let equal = true;
            for (let j = 1; j < k; j++) {
                const inner = list[list.length - k + j];
                const outer = continuation[j];
                if (!isNodeEqual(inner, outer)) {
                    equal = false;
                    break;
                }
            }
            if (!equal) continue;
            const suffix = list.slice(list.length - k);
            if (!this.suffixMergeable(branch, suffix)) continue;
            list.splice(list.length - k, k);
            return true;
        }
        return false;
    }

    /** 被删除的语句段是否可以在两个位置等价执行。 */
    private suffixMergeable(branch: TYPE.Statement, suffix: TYPE.Statement[]): boolean {
        // 0. 段尾必须是控制流终结语句(return/throw/break/continue):
        //    只有此时“删除分支内的副本、落到紧随其后的同名语句”才等价——原路径在
        //    副本处就离开当前结构,外层那份本来就不会再执行。非终结段(如 `v3 += 1`)
        //    删掉后会在同一路径上少执行一次,语义不同。
        const tail = suffix[suffix.length - 1];
        if (!(TYPE.isReturnStatement(tail) || TYPE.isThrowStatement(tail)
            || TYPE.isBreakStatement(tail) || TYPE.isContinueStatement(tail))) {
            return false;
        }
        // 1. 段内不允许任何声明:块级声明在两个位置是不同绑定,
        //    var/函数/类声明的提升与初始化时机也会随位置变化。
        for (const stmt of suffix) {
            if (this.containsDeclaration(stmt)) return false;
        }
        // 2. 分支自己声明的名字不能被段内的标识符命中(catch 参数、块内 let 等
        //    会让标识符在分支里解析成局部绑定,删掉后改用外层绑定)。写入位置也
        //    一并算作依赖,宁可少删。
        const declared = this.collectDeclaredNames(branch);
        if (declared.size === 0) return true;
        let hit = false;
        for (const stmt of suffix) {
            walkNode(stmt, (n) => {
                if (hit) return false;
                if (isFunctionLike(n) || isClassLike(n)) return false;
                if (TYPE.isIdentifier(n) && declared.has(n.name)) {
                    hit = true;
                    return false;
                }
                return true;
            });
            if (hit) return false;
        }
        return true;
    }

    private containsDeclaration(stmt: TYPE.Statement): boolean {
        let found = false;
        walkNode(stmt, (n) => {
            if (found) return false;
            if (TYPE.isVariableDeclaration(n) || TYPE.isFunctionDeclaration(n)
                || TYPE.isClassDeclaration(n)) {
                found = true;
                return false;
            }
            return true;
        });
        return found;
    }

    /** 收集分支内声明的名字(变量、函数、类、catch 参数、循环左值)。 */
    private collectDeclaredNames(branch: TYPE.Statement): Set<string> {
        const names = new Set<string>();
        walkNode(branch, (n) => {
            if (TYPE.isVariableDeclarator(n)) {
                this.addPatternNames(n.id, names);
            } else if ((TYPE.isFunctionDeclaration(n) || TYPE.isClassDeclaration(n)) && n.id) {
                names.add(n.id.name);
            } else if (TYPE.isCatchClause(n) && n.param) {
                this.addPatternNames(n.param, names);
            } else if (TYPE.isForInStatement(n) || TYPE.isForOfStatement(n)) {
                this.addPatternNames(n.left, names);
            }
            return true;
        });
        return names;
    }

    private addPatternNames(node: TYPE.Node | null | undefined, out: Set<string>): void {
        if (!node) return;
        if (TYPE.isIdentifier(node)) {
            out.add(node.name);
        } else if (TYPE.isRestElement(node)) {
            this.addPatternNames(node.argument, out);
        } else if (TYPE.isAssignmentPattern(node)) {
            this.addPatternNames(node.left, out);
        } else if (TYPE.isArrayPattern(node)) {
            for (const e of node.elements) this.addPatternNames(e, out);
        } else if (TYPE.isObjectPattern(node)) {
            for (const prop of node.properties) {
                if (TYPE.isRestElement(prop)) this.addPatternNames(prop.argument, out);
                else if (TYPE.isObjectProperty(prop)) this.addPatternNames(prop.value, out);
            }
        }
    }
}
