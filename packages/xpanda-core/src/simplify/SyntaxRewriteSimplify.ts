import { Program } from "@babel/types";
import { ISimplify } from "./ISimplify";
import traverse, { NodePath } from "@babel/traverse";
import * as TYPE from "@babel/types";
import { collectIdentifierNames, isDeclarationValue, isNodeEqual, isPureExpression, isTempName, walkNode } from "./AstUtils";


const {
    VISITOR_KEYS,
    binaryExpression,
    booleanLiteral,
    emptyStatement,
    expressionStatement,
    file,
    functionDeclaration,
    identifier,
    isArrayExpression,
    isAssignmentExpression,
    isAwaitExpression,
    isBinaryExpression,
    isBlockStatement,
    isBooleanLiteral,
    isBreakStatement,
    isCallExpression,
    isClassDeclaration,
    isContinueStatement,
    isFunctionDeclaration,
    isIdentifier,
    isIfStatement,
    isLogicalExpression,
    isMemberExpression,
    isNewExpression,
    isNullLiteral,
    isNumericLiteral,
    isOptionalMemberExpression,
    isParenthesizedExpression,
    isProgram,
    isReturnStatement,
    isSequenceExpression,
    isSpreadElement,
    isStringLiteral,
    isSuper,
    isTaggedTemplateExpression,
    isThisExpression,
    isThrowStatement,
    isUnaryExpression,
    isUpdateExpression,
    isVariableDeclaration,
    isYieldExpression,
    logicalExpression,
    nullLiteral,
    unaryExpression,
    isExpressionStatement: isExpressionStatementNode,
} = TYPE;

/**
 * 通用语法重写:
 *   - 化简 if 条件里的 !/逻辑运算
 *   - if/else 结构归一化
 *   - 调用形式 a.call(b, ...) -> a(...)
 *   - 函数表达式 -> 函数声明
 *   - 删除重复 acc = undefined / 尾部 return undefined
 *
 * 所有变换都在节点上原地完成,不再在每个 visitor 里 scope.crawl()。
 *
 * @Author: jmp0
 * @Email: jmp0@qq.com
 */
export class SyntaxRewriteSimplify implements ISimplify {
    /**
     * 折叠静态可判定的 if 条件。
     * 典型来源:ArkTS 13 的 try/finally 收尾 `if (resumeValue == undefined)` 在
     * resumeValue 被常量传播成 undefined 后留下 `if (undefined == undefined)`。
     * 只处理字面量/undefined/null 之间的比较,避免误改普通变量条件。
     */
    public static foldConstantConditions(node: Program): boolean {
        let changed = false;
        traverse(file(node), {
            IfStatement(path) {
                // undefined 被局部变量遮蔽时不折叠
                if (path.scope.getBinding("undefined")) return;
                path.node.test = SyntaxRewriteSimplify.foldBooleanExpression(path.node.test);
                const value = SyntaxRewriteSimplify.constantTruthiness(path.node.test);
                if (value === null) return;
                const branch = value ? path.node.consequent : path.node.alternate;
                changed = true;
                if (!branch) {
                    // 循环体/if 分支等必须保留一条语句的位置
                    if (path.parentPath && (isBlockStatement(path.parentPath.node) || isProgram(path.parentPath.node))) {
                        path.remove();
                    } else {
                        path.replaceWith(emptyStatement());
                    }
                    return;
                }
                // 保留原分支的块作用域(let/const 声明)
                if (isBlockStatement(branch)) {
                    const hasBlockScoped = branch.body.some((statement) =>
                        (isVariableDeclaration(statement) && statement.kind !== "var")
                        || isClassDeclaration(statement)
                        || isFunctionDeclaration(statement));
                    if (!hasBlockScoped && branch.body.length === 1) {
                        path.replaceWith(branch.body[0]);
                        return;
                    }
                }
                path.replaceWith(branch);
            },
        });
        return changed;
    }

    /**
     * 去掉 ArkTS 13 的 `hole` 哨兵守卫。
     *
     * 编译器的 try/finally 收尾会写成
     *   X = hole;                     // 没有未决异常
     *   if (X != pending) throw pending;
     * `pending` 只在（未被结构化进区域图的）catch handler 里被赋值,反编译结果里
     * 没有 try/catch,哨兵槽不可能变成异常值,于是收尾退化成
     *   if (hole == vN) { <正常路径> } else { throw vN; }
     * 或 `if (hole != vN) throw vN;`。这些分支里的 `hole` 是未定义的标识符,
     * 原样输出连执行都不行。这里按“没有未决异常”取正常路径,并删掉 throw 分支。
     *
     * 只处理异常分支确实以 throw 结束的守卫,避免误改普通条件。
     */
    public static foldSentinelGuards(node: Program): boolean {
        let changed = false;
        traverse(file(node), {
            noScope: true,
            IfStatement(path) {
                const test = path.node.test;
                if (!isBinaryExpression(test) || !["==", "===", "!=", "!=="].includes(test.operator)) return;
                const holeLeft = isIdentifier(test.left, { name: "hole" });
                const holeRight = isIdentifier(test.right, { name: "hole" });
                if (!holeLeft && !holeRight) return;
                // 排除 `hole == hole`:交给 foldConstantConditions 折叠成常量
                if (holeLeft && holeRight) return;
                const isEqual = test.operator === "==" || test.operator === "===";
                const normalBranch = isEqual ? path.node.consequent : path.node.alternate;
                const exceptionBranch = isEqual ? path.node.alternate : path.node.consequent;
                // 24.0.0.0 的 eager catch:
                //   catch (e) { <cleanup>; if (hole == e) { return; } throw e; }
                // e 是 catch 参数(真正的异常),不可能等于内部哨兵 hole,这个 if 是
                // 死代码,删掉后就是 `<cleanup>; throw e;`(finally 的异常路径)。
                // 必须确认 e 就是外层 catch 的参数:经典 finally 收尾里的哨兵守卫
                // (`if (hole == pending) { <正常路径> } throw pending`) 是正常分支,
                // 不能删。
                const catchClause = path.parentPath?.parentPath?.node;
                if (isEqual && !path.node.alternate
                    && catchClause && TYPE.isCatchClause(catchClause) && isIdentifier(catchClause.param)) {
                    const exceptionName = holeLeft
                        ? (isIdentifier(test.right) ? test.right.name : null)
                        : holeRight ? (isIdentifier(test.left) ? test.left.name : null) : null;
                    if (exceptionName && exceptionName === catchClause.param.name
                        && SyntaxRewriteSimplify.terminates(path.node.consequent)) {
                        const next = path.getNextSibling();
                        if (next.isThrowStatement() && isIdentifier((next.node as TYPE.ThrowStatement).argument, { name: exceptionName })) {
                            changed = true;
                            path.remove();
                            return;
                        }
                    }
                }
                if (!exceptionBranch || !SyntaxRewriteSimplify.isThrowOnly(exceptionBranch)) return;
                changed = true;
                if (normalBranch) {
                    // 保留原分支的块作用域(let/const 声明);只有单语句且无块级声明时才展平,
                    // 避免 `if (...) { } else { }` 直接变成一个多余的 `{ return ... }`。
                    if (isBlockStatement(normalBranch) && normalBranch.body.length === 1) {
                        const only = normalBranch.body[0];
                        const hasBlockScoped = isVariableDeclaration(only) && only.kind !== "var"
                            || isClassDeclaration(only) || isFunctionDeclaration(only);
                        if (!hasBlockScoped) {
                            path.replaceWith(only);
                            return;
                        }
                    }
                    path.replaceWith(normalBranch);
                } else if (path.parentPath && (isBlockStatement(path.parentPath.node) || isProgram(path.parentPath.node))) {
                    path.remove();
                } else {
                    path.replaceWith(emptyStatement());
                }
            },
        });
        return changed;
    }

    /** 语句(或块)的所有路径都以 throw 结束时返回 true */
    private static isThrowOnly(statement: TYPE.Statement): boolean {
        if (isBlockStatement(statement)) {
            const last = statement.body[statement.body.length - 1];
            return !!last && SyntaxRewriteSimplify.isThrowOnly(last);
        }
        return isThrowStatement(statement);
    }

    /**
     * 24.0.0.0 的 try/finally lowering:eager catch 形式
     *   try { <body>; <cleanup>; <exit> } catch (e) { <cleanup>; throw e }
     * 与 `try { <body>; <exit> } finally { <cleanup> }` 等价,后者才是源码结构。
     * 只在 cleanup 逐语句结构相同、且不读取 catch 参数 / try 体内声明的变量时改写。
     */
    /**
     * 24+ 把 finally 内联在每个出口前,异常路径只剩 handler 里的
     * `cleanup; if (pending !== hole) throw pending`。结构化阶段把这个 handler 作为
     * Try 区域的 `finallyEpilogue` 输出成 try/catch(AST 上带
     * `extra.xpandaTryKind` 标记),这里再把两份相同的 cleanup 折回 try/finally。
     * 折叠必须留到最后:只有优化器跑完,try 体里内联的 cleanup 与 handler 里的
     * 那份才会在文本上完全一致。标记只是来源确认,不会放宽结构校验。
     */
    public static foldEagerCatchToFinally(node: Program): boolean {
        let changed = false;
        traverse(file(node), {
            noScope: true,
            TryStatement(path) {
                const handler = path.node.handler;
                if (!handler || path.node.finalizer) return;
                const param = handler.param;
                if (!isIdentifier(param)) return;
                const catchBody = handler.body.body;
                if (catchBody.length < 2) return;
                const throwStatement = catchBody[catchBody.length - 1];
                if (!isThrowStatement(throwStatement) || !isIdentifier(throwStatement.argument, { name: param.name })) return;
                const cleanup = catchBody.slice(0, -1);
                if (cleanup.length === 0) return;
                // 清理语句必须都是表达式语句(不改变控制流),否则不能搬进 finally
                if (!cleanup.every((statement) => isExpressionStatementNode(statement))) return;
                const tryBody = path.node.block.body;
                if (tryBody.length <= cleanup.length) return;
                const exit = tryBody[tryBody.length - 1];
                if (!SyntaxRewriteSimplify.terminates(exit)) return;
                const offset = tryBody.length - 1 - cleanup.length;
                for (let i = 0; i < cleanup.length; i++) {
                    if (!isNodeEqual(tryBody[offset + i], cleanup[i])) return;
                }
                const cleanupNames = collectIdentifierNames(TYPE.blockStatement(cleanup));
                if (cleanupNames.has(param.name)) return;
                // 清理语句不能引用 try 体内声明的变量(搬进 finally 后不在作用域)
                const tryLocalNames = new Set<string>();
                for (const statement of tryBody.slice(0, offset)) {
                    walkNode(statement, (inner) => {
                        if (isFunctionDeclaration(inner) || isClassDeclaration(inner)) {
                            tryLocalNames.add((inner as TYPE.FunctionDeclaration | TYPE.ClassDeclaration).id?.name ?? "");
                            return false;
                        }
                        if (isVariableDeclaration(inner)) {
                            for (const declarator of inner.declarations) {
                                if (isIdentifier(declarator.id)) tryLocalNames.add(declarator.id.name);
                            }
                            return true;
                        }
                        return true;
                    });
                }
                for (const name of cleanupNames) {
                    if (tryLocalNames.has(name)) return;
                }
                const newTryBody = [...tryBody.slice(0, offset), exit];
                path.replaceWith(TYPE.tryStatement(
                    TYPE.blockStatement(newTryBody),
                    null,
                    TYPE.blockStatement(cleanup),
                ));
                delete (path.node as any).extra?.xpandaTryKind;
                changed = true;
            },
        });
        return changed;
    }

    /**
     * 拆掉纯 rethrow 的 catch:`try { B } catch (e) { throw e }` 与直接执行 B
     * 完全等价 —— 异常被原样抛出(同一个对象、同一条栈),控制流不变。编译器用它
     * 做 finally 的异常跳板、构造器的 `throw.ifsupernotcorrectcall` 检查、模块
     * 初始化的词法环境清理(poplexenv),反编译出来只是噪音,还会把整段正确代码
     * 缩进一层(模块里的类定义被整个包进 try)。
     *
     * 只在 AST 尾部拆,不在构图时丢 handler:handler 里带 `poplexenv` 时,那层 try
     * 同时也是词法环境的块切分边界,构图时去掉会让 `acc` 的赋值链被块边界隔断,
     * 模块变量赋值退化成 `X = acc`(acc 无人赋值)。拆 try 时保留原有语句顺序:
     * body 顶层没有块级声明就把语句直接接进外层语句表,否则保留 body 的块
     * (let/const/function 的作用域不能变)。
     */
    public static removeRedundantRethrowCatches(node: Program): boolean {
        let changed = false;
        traverse(file(node), {
            noScope: true,
            TryStatement(path) {
                const handler = path.node.handler;
                if (!handler || path.node.finalizer) return;
                const param = handler.param;
                if (!isIdentifier(param)) return;
                const catchBody = handler.body.body;
                if (catchBody.length === 0 || catchBody.length > 2) return;
                const throwStatement = catchBody[catchBody.length - 1];
                if (!isThrowStatement(throwStatement)) return;
                const thrown = throwStatement.argument;
                if (!isIdentifier(thrown)) return;
                // 允许的前缀只有 TryCatchPandaStatement 开头搬运异常的 `acc = catchAcc`
                // (复制传播还没折掉的等价形态)
                const prefix = catchBody.slice(0, -1);
                if (prefix.length === 1) {
                    const prologue = prefix[0];
                    if (!isExpressionStatementNode(prologue)) return;
                    const assignment = prologue.expression;
                    if (!isAssignmentExpression(assignment) || assignment.operator !== "=") return;
                    if (!isIdentifier(assignment.left, { name: "acc" })
                        || !isIdentifier(assignment.right, { name: param.name })) return;
                }
                if (thrown.name !== param.name && !(thrown.name === "acc" && prefix.length === 1)) return;
                const statements = path.node.block.body;
                if (statements.length === 0) {
                    path.remove();
                } else if (statements.some((statement) => SyntaxRewriteSimplify.isBlockScopedDeclaration(statement))) {
                    path.replaceWith(path.node.block);
                } else {
                    path.replaceWithMultiple(statements);
                }
                changed = true;
            },
        });
        return changed;
    }

    /**
     * `try {} finally { F }`(try 体为空)与直接执行 `F` 等价:空 try 不会抛异常,
     * finally 仍在同一位置执行一次;`try {} catch (e) { C }` 的处理器则不可达。
     * ArkTS 把 finally 内联在出口前,内层分支被折叠/清理后就会留下这种空壳
     * (amcl1.0.6.abc 的 i8 c763:`try {} finally { await g50.close(v4) }`),
     * 拆掉它才看得出真正的清理语句。
     */
    public static dropEmptyTryBlocks(node: Program): boolean {
        let changed = false;
        traverse(file(node), {
            noScope: true,
            TryStatement(path) {
                if (path.node.block.body.length > 0) return;
                const finalizer = path.node.finalizer;
                changed = true;
                if (!finalizer || finalizer.body.length === 0) {
                    path.remove();
                    return;
                }
                const statements = finalizer.body;
                // finalizer 顶层有块级声明时保留块,避免把它们摊进外层作用域
                if (statements.some((statement) => SyntaxRewriteSimplify.isBlockScopedDeclaration(statement))) {
                    path.replaceWith(finalizer);
                } else {
                    path.replaceWithMultiple(statements);
                }
            },
        });
        return changed;
    }

    /**
     * 只有"双重块"才合并:`{ { … } }` → `{ … }`。
     *
     * 条件是父级也是块语句(或 Program)、且父块的语句表里只有这一个块 ——
     * 此时内层块的作用域范围与外层完全一致,里面的 let/const 提上来也不会和
     * 父块里的其它名字撞车,任何形态都安全。
     *
     * 父块里还有别的语句时一律不动:内层块顶层如果有块级声明,合并会改变它的
     * 作用域(哪怕只是提一层也可能撞名),这类块(通常是 lexenv 块)保持原样。
     *
     * 这层冗余块大多来自我们自己的构造:结构分析给 finally 包出来的
     * `finally { { … } }`、折叠掉的常量 if 留下的块体等。
     */
    public static flattenNestedBlocks(node: Program): boolean {
        let changed = false;
        // 展开会暴露更深的嵌套块,固定跑几轮直到稳定
        for (let round = 0; round < 8; round++) {
            let roundChanged = false;
            traverse(file(node), {
                noScope: true,
                BlockStatement: (path) => {
                    if (!path.inList || !Array.isArray(path.container)) return;
                    const parent = path.parentPath?.node;
                    if (!parent || !(isBlockStatement(parent) || isProgram(parent))) return;
                    const list = path.container as TYPE.Statement[];
                    // 父块里只有这一个块(双重块),作用域范围不变
                    if (list.length !== 1) return;
                    const block = path.node;
                    list.splice(list.indexOf(block), 1, ...block.body);
                    roundChanged = true;
                    changed = true;
                    path.skip();
                },
            });
            if (!roundChanged) break;
        }
        return changed;
    }

    /** try body 顶层的块级声明:直接摊进外层语句表会改变它们的作用域 */
    private static isBlockScopedDeclaration(statement: TYPE.Statement): boolean {
        if (isFunctionDeclaration(statement) || isClassDeclaration(statement)) return true;
        return isVariableDeclaration(statement) && statement.kind !== "var";
    }

    /**
     * 删除终止语句(return/throw/break/continue)之后永远执行不到的兄弟语句。
     * ArkTS 13 的哨兵守卫 `if (hole == X) { continue; } throw X;` 在
     * `hole == hole` 被常量折叠后会留下 `continue; throw hole;`,
     * `hole` 是未定义标识符,不删掉输出就不是合法可执行代码。
     * 只删除不含声明(let/const/function/class)的尾随语句,保证块级提升语义不变。
     */
    public static removeUnreachableStatements(node: Program): boolean {
        let changed = false;
        const prune = (body: TYPE.Statement[]): boolean => {
            for (let i = 0; i < body.length - 1; i++) {
                if (!SyntaxRewriteSimplify.terminates(body[i])) continue;
                const tail = body.slice(i + 1);
                if (tail.some((statement) => isVariableDeclaration(statement)
                    || isFunctionDeclaration(statement)
                    || isClassDeclaration(statement))) return false;
                body.splice(i + 1);
                return true;
            }
            return false;
        };
        traverse(file(node), {
            noScope: true,
            BlockStatement: (path) => {
                if (prune(path.node.body)) changed = true;
            },
            // switch 的 case 体不是 BlockStatement:restoreGotoLoops 把 goto 换成 continue 后,
            // 守卫链合成 switch 时留下的 `break;` 也成了不可达语句
            SwitchCase: (path) => {
                if (prune(path.node.consequent)) changed = true;
            },
        });
        return changed;
    }

    /**
     * 删除不属于任何循环/switch/label 的 continue/break 伪语句。
     * Region 归约会用 continue/break 表示“回到循环头 / 跳出去”;当循环被整体
     * 归约掉后,残留的跳转可能落在循环外(如 `while (true) { ... }` 之后还留一个
     * `continue;`),这样的 AST 无法再被 Babel 解析,也不表达任何语义。
     */
    public static removeOrphanJumps(node: Program): boolean {
        let changed = false;
        traverse(file(node), {
            noScope: true,
            ContinueStatement(path) {
                if (path.findParent((parent) => parent.isLoop())) return;
                SyntaxRewriteSimplify.removeJump(path);
                changed = true;
            },
            BreakStatement(path) {
                if (path.findParent((parent) => parent.isLoop() || parent.isSwitchStatement() || parent.isLabeledStatement())) return;
                SyntaxRewriteSimplify.removeJump(path);
                changed = true;
            },
        });
        return changed;
    }

    private static removeJump(path: NodePath<TYPE.Statement>): void {
        if (path.parentPath && (isBlockStatement(path.parentPath.node) || isProgram(path.parentPath.node))) {
            path.remove();
        } else {
            path.replaceWith(emptyStatement());
        }
    }

    /**
     * `if (C) { ...终止语句 } else { BODY }` -> `if (C) { ...终止语句 } BODY`。
     *
     * 分支一定不落空(return/throw/break/continue),else 只是 "then 没走" 的补充,
     * 展开成同级语句与源码常见的守卫子句写法一致;更重要的是后续折叠能看到连续的
     * 语句列表(累加器链、临时别名等原先被 else 块切断)。
     *
     * 必须放在 HighLevelGrammarSimplify 的三目合成之后:两个分支都是单条 return
     * 的 if/else 会先被合成 `C ? A : B`(源码里的三目),展开只会把它拆散。
     *
     * 只展开语句列表里的 if(LabeledStatement 直接包住 if 时 break label 依赖
     * else 仍在标签内,不能展开);else 块顶层的块级声明展开到外层会改变作用域,
     * 保守跳过。
     */
    public static flattenElseAfterExit(node: Program): boolean {
        return SyntaxRewriteSimplify.flattenStatementList(node.body);
    }

    /** 对语句数组展开 `then 终止` 的 else;同时递归所有子节点里的语句数组 */
    private static flattenStatementList(list: TYPE.Statement[]): boolean {
        let changed = false;
        for (let i = 0; i < list.length; i++) {
            const statement = list[i];
            if (isIfStatement(statement) && statement.alternate
                && SyntaxRewriteSimplify.terminates(statement.consequent)) {
                const alternate = statement.alternate;
                const blockScoped = isBlockStatement(alternate) && alternate.body.some((inner) =>
                    (isVariableDeclaration(inner) && inner.kind !== "var")
                    || isClassDeclaration(inner)
                    || isFunctionDeclaration(inner));
                if (!blockScoped) {
                    statement.alternate = null;
                    const spliced = isBlockStatement(alternate) ? alternate.body : [alternate];
                    list.splice(i + 1, 0, ...spliced);
                    changed = true;
                }
            }
            // 递归子节点(含刚展开出来的语句)
            if (SyntaxRewriteSimplify.flattenInChildren(list[i])) changed = true;
        }
        return changed;
    }

    /** 递归所有子节点(VISITOR_KEYS),对每个语句数组容器展开 else */
    private static flattenInChildren(node: TYPE.Node): boolean {
        // 数组字面量允许空位(`[1, , 3]`),元素可能是 null
        if (!node || typeof node.type !== "string") return false;
        let changed = false;
        const keys = VISITOR_KEYS[node.type] ?? [];
        for (const key of keys) {
            const child = (node as any)[key];
            if (Array.isArray(child)) {
                if (child.some((element) => element && typeof element.type === "string")) {
                    if (SyntaxRewriteSimplify.flattenStatementList(child)) changed = true;
                }
            } else if (child && typeof child.type === "string") {
                if (SyntaxRewriteSimplify.flattenInChildren(child)) changed = true;
            }
        }
        return changed;
    }

    /** 语句本身一定会终止(不落出当前块) */
    private static terminates(statement: TYPE.Statement): boolean {
        if (isReturnStatement(statement) || isThrowStatement(statement)
            || isBreakStatement(statement) || isContinueStatement(statement)) return true;
        if (isBlockStatement(statement)) {
            const last = statement.body[statement.body.length - 1];
            return !!last && SyntaxRewriteSimplify.terminates(last);
        }
        if (isIfStatement(statement)) {
            return statement.alternate != null
                && SyntaxRewriteSimplify.terminates(statement.consequent)
                && SyntaxRewriteSimplify.terminates(statement.alternate);
        }
        return false;
    }

    /** 在布尔上下文里折叠逻辑表达式;无法判定时原样返回 */
    private static foldBooleanExpression(node: TYPE.Expression): TYPE.Expression {
        if (isLogicalExpression(node)) {
            node.left = SyntaxRewriteSimplify.foldBooleanExpression(node.left);
            const left = SyntaxRewriteSimplify.constantTruthiness(node.left);
            if (node.operator === "&&") {
                if (left === false) return booleanLiteral(false);
                if (left === true) return SyntaxRewriteSimplify.foldBooleanExpression(node.right);
            } else {
                if (left === true) return booleanLiteral(true);
                if (left === false) return SyntaxRewriteSimplify.foldBooleanExpression(node.right);
            }
            return node;
        }
        if (isUnaryExpression(node) && node.operator === "!") {
            node.argument = SyntaxRewriteSimplify.foldBooleanExpression(node.argument as TYPE.Expression);
            const value = SyntaxRewriteSimplify.constantTruthiness(node.argument);
            return value === null ? node : booleanLiteral(!value);
        }
        if (isBinaryExpression(node)) {
            const value = SyntaxRewriteSimplify.constantEquality(node);
            return value === null ? node : booleanLiteral(value);
        }
        return node;
    }

    /** 返回静态真值;无法静态判定时返回 null */
    private static constantTruthiness(node: TYPE.Node | null | undefined): boolean | null {
        if (!node) return null;
        if (isBooleanLiteral(node)) return node.value;
        if (isNullLiteral(node)) return false;
        if (isNumericLiteral(node)) return node.value !== 0;
        if (isStringLiteral(node)) return node.value.length > 0;
        if (isIdentifier(node)) {
            if (node.name === "undefined") return false;
            return null;
        }
        if (isUnaryExpression(node) && node.operator === "!") {
            const inner = SyntaxRewriteSimplify.constantTruthiness(node.argument);
            return inner === null ? null : !inner;
        }
        if (isBinaryExpression(node)) {
            return SyntaxRewriteSimplify.constantEquality(node);
        }
        return null;
    }

    private static isSimpleConstant(node: TYPE.Node | null | undefined): node is TYPE.Expression {
        return !!node && (
            isBooleanLiteral(node)
            || isNullLiteral(node)
            || isNumericLiteral(node)
            || isStringLiteral(node)
            || (isIdentifier(node, { name: "undefined" }))
        );
    }

    private static simpleValue(node: TYPE.Node): string | number | boolean | null | undefined {
        if (isBooleanLiteral(node)) return node.value;
        if (isNullLiteral(node)) return null;
        if (isNumericLiteral(node)) return node.value;
        if (isStringLiteral(node)) return node.value;
        return undefined;
    }

    private static constantEquality(node: TYPE.BinaryExpression): boolean | null {
        const { left, right, operator } = node;
        if (operator !== "==" && operator !== "===" && operator !== "!=" && operator !== "!==") return null;
        // `hole` 是 Panda 的哨兵值(ldhole),同一个哨兵和自身比较恒相等。
        // ArkTS 13 在 for...of 的 iterator.close 收尾、try/finally 收尾里会留下
        // `X = hole; if (X != hole) throw X`,常量传播把 X 换成 hole 后就是
        // `if (hole != hole) throw hole`——恒 false 的守卫,删掉后代码才可执行。
        if (isIdentifier(left) && isIdentifier(right) && left.name === "hole" && right.name === "hole") {
            return operator === "===" || operator === "==";
        }
        if (!SyntaxRewriteSimplify.isSimpleConstant(left) || !SyntaxRewriteSimplify.isSimpleConstant(right)) return null;
        const l = SyntaxRewriteSimplify.simpleValue(left);
        const r = SyntaxRewriteSimplify.simpleValue(right);
        let equal: boolean;
        if (operator === "===" || operator === "!==") {
            equal = l === r;
        } else {
            // 只处理同类型或 null/undefined 之间的宽松比较,避免实现完整的 ToPrimitive
            if (l === null || l === undefined || r === null || r === undefined) {
                equal = (l === null || l === undefined) && (r === null || r === undefined);
            } else if (typeof l === typeof r) {
                equal = l === r;
            } else {
                return null;
            }
        }
        return operator === "!=" || operator === "!==" ? !equal : equal;
    }

    public static binaryInvert(node: TYPE.BinaryExpression): TYPE.BinaryExpression["operator"] | null {
        switch (node.operator) {
            case "!=": return "==";
            case "!==": return "===";
            case "<": return ">=";
            case "<=": return ">";
            case ">": return "<=";
            case "==": return "!=";
            case "===": return "!==";
            case ">=": return "<";
            default: return null;
        }
    }

    private invertOperand(node: TYPE.Expression): TYPE.Expression {
        if (isBinaryExpression(node) || isLogicalExpression(node)) {
            return this.invertExpression(node);
        }
        return unaryExpression("!", node);
    }

    /** 对表达式取反(用于 if 分支交换)。 */
    private invertExpression(node: TYPE.Expression): TYPE.Expression {
        if (isBinaryExpression(node)) {
            const invert = SyntaxRewriteSimplify.binaryInvert(node);
            if (invert == null) return unaryExpression("!", node);
            node.operator = invert;
            return node;
        }
        if (isLogicalExpression(node)) {
            node.left = this.invertOperand(node.left);
            node.right = this.invertOperand(node.right);
            node.operator = node.operator === "||" ? "&&" : "||";
            return node;
        }
        if (isUnaryExpression(node) && node.operator === "!") {
            return node.argument;
        }
        return unaryExpression("!", node);
    }

    /** 化简 if/while 的 test:!!a -> a,!a == b -> a != b,!a && !b -> ... */
    private simplifyTestNode(node: TYPE.Expression): TYPE.Expression {
        node = this.unwrapParens(node);
        // ConditionSimplify 删除序列中间元素后可能留下单元素序列
        while (isSequenceExpression(node) && node.expressions.length === 1) {
            node = this.unwrapParens(node.expressions[0] as TYPE.Expression);
        }
        if (isSequenceExpression(node)) {
            if (node.expressions.length > 0) {
                node.expressions[node.expressions.length - 1] =
                    this.simplifyTestNode(node.expressions[node.expressions.length - 1]);
            }
            return node;
        }
        if (isLogicalExpression(node)) {
            node.left = this.simplifyTestNode(node.left);
            node.right = this.simplifyTestNode(node.right);
            const nullish = this.mergeNullishCheck(node);
            return nullish ?? node;
        }
        if (!isUnaryExpression(node) || node.operator !== "!") return node;
        let arg = this.unwrapParens(node.argument as TYPE.Expression);
        while (isSequenceExpression(arg) && arg.expressions.length === 1) {
            arg = this.unwrapParens(arg.expressions[0] as TYPE.Expression);
        }
        if (arg !== node.argument) node.argument = arg;
        if (isSequenceExpression(arg) && arg.expressions.length > 1) {
            // !(a, b, c) === (a, b, !c):把取反推进最后一个元素,
            // 这样 `!(v = X, acc = !C, !!C)` 能继续化简成 `(v = X, acc = !C, C !== Y)`。
            const expressions = arg.expressions as TYPE.Expression[];
            const last = expressions[expressions.length - 1];
            expressions[expressions.length - 1] = unaryExpression("!", last);
            return this.simplifyTestNode(arg);
        }
        if (isUnaryExpression(arg) && arg.operator === "!") {
            return this.simplifyTestNode(arg.argument);
        }
        if (isBinaryExpression(arg)) {
            const invert = SyntaxRewriteSimplify.binaryInvert(arg);
            if (invert != null) {
                arg.operator = invert;
                return this.simplifyTestNode(arg);
            }
        }
        if (isLogicalExpression(arg)) {
            return this.simplifyTestNode(this.invertExpression(arg));
        }
        if (isBooleanLiteral(arg)) {
            return booleanLiteral(!arg.value);
        }
        return node;
    }

    /**
     * 三元表达式的布尔分支化简(分支是 true/false 时,三元本质上就是逻辑运算):
     *   !T ? A : B    -> T ? B : A   (严格等价)
     *   T ? false : B -> !T && B     (严格等价)
     *   T ? B : false -> T && B
     *   T ? true : B  -> T || B
     *   T ? B : true  -> !T || B
     * 后三条把 T 当布尔值使用,与 HighLevelGrammarSimplify 里
     * `T ? true : false -> T` 的既有约定保持一致。
     *
     * 返回 null 表示没有变化;返回 node 本身表示原地修改(可继续化简);返回其他节点表示需要替换。
     */
    private foldBooleanConditional(node: TYPE.ConditionalExpression): TYPE.Expression | null {
        const test = node.test;
        if (isUnaryExpression(test) && test.operator === "!") {
            node.test = test.argument;
            const consequent = node.consequent;
            node.consequent = node.alternate;
            node.alternate = consequent;
            return node;
        }
        const consequent = node.consequent;
        const alternate = node.alternate;
        const consequentBool = isBooleanLiteral(consequent) ? consequent.value : null;
        const alternateBool = isBooleanLiteral(alternate) ? alternate.value : null;
        if (consequentBool === true && alternateBool === false) return test;
        if (consequentBool === false && alternateBool === true) return this.invertExpression(test);
        if (consequentBool === false) return logicalExpression("&&", this.invertExpression(test), alternate);
        if (alternateBool === false) return logicalExpression("&&", test, consequent);
        if (consequentBool === true) return logicalExpression("||", test, alternate);
        if (alternateBool === true) return logicalExpression("||", this.invertExpression(test), consequent);
        // T ? B : T -> T && B;T ? T : B -> T || B。布尔物化链里的补值写法:
        //   !T ? T : B 先交换成 T ? B : T,再折成 T && B。
        // 两个方向都与三元逐值等价(真值分支返回 B/T,假值分支返回 T/B)。
        if (isNodeEqual(alternate, test)) return logicalExpression("&&", test, consequent);
        if (isNodeEqual(consequent, test)) return logicalExpression("||", test, alternate);
        return null;
    }

    private unwrapParens(node: TYPE.Expression): TYPE.Expression {
        let current = node;
        while (isParenthesizedExpression(current)) current = (current as any).expression;
        return current;
    }

    private isUndefinedNode(node: TYPE.Node): boolean {
        if (isIdentifier(node) && node.name === "undefined") return true;
        return isUnaryExpression(node) && node.operator === "void"
            && isNumericLiteral(node.argument) && node.argument.value === 0;
    }

    /** 返回 `x === null` / `x !== undefined` 这类比较里的 x;不是该形式则返回 null。 */
    private nullishCheckTarget(node: TYPE.Expression, operator: "===" | "!==", kind: "null" | "undefined"): TYPE.Identifier | null {
        node = this.unwrapParens(node);
        if (!isBinaryExpression(node) || node.operator !== operator) return null;
        if (!isIdentifier(node.left)) return null;
        const right = this.unwrapParens(node.right as TYPE.Expression);
        const matched = kind === "null" ? isNullLiteral(right) : this.isUndefinedNode(right);
        return matched ? node.left : null;
    }

    /** x === null || x === undefined -> x == null;x !== null && x !== undefined -> x != null */
    private mergeNullishCheck(node: TYPE.LogicalExpression): TYPE.BinaryExpression | null {
        const isOr = node.operator === "||";
        const isAnd = node.operator === "&&";
        if (!isOr && !isAnd) return null;
        const operator = isOr ? "===" : "!==";
        const left = this.unwrapParens(node.left as TYPE.Expression);
        const right = this.unwrapParens(node.right as TYPE.Expression);
        const leftNull = this.nullishCheckTarget(left, operator, "null");
        const leftUndefined = this.nullishCheckTarget(left, operator, "undefined");
        const rightNull = this.nullishCheckTarget(right, operator, "null");
        const rightUndefined = this.nullishCheckTarget(right, operator, "undefined");
        const target = leftNull && rightUndefined && leftNull.name === rightUndefined.name
            ? leftNull
            : leftUndefined && rightNull && leftUndefined.name === rightNull.name
                ? leftUndefined
                : null;
        if (!target) return null;
        return binaryExpression(isOr ? "==" : "!=", target, nullLiteral());
    }

    /**
     * if 条件尾部的表达式序列物化前缀还原成嵌套 if:
     *
     *   if (A && B && (this.videoW = W, this.videoH = H, this.sized = true, sec !== -1)) {
     *     clearInterval(...);
     *   }
     * →
     *   if (A && B) {
     *     this.videoW = W;
     *     this.videoH = H;
     *     this.sized = true;
     *     if (sec !== -1) {
     *       clearInterval(...);
     *     }
     *   }
     *
     * 序列只在 && 左侧全部为真时求值,搬进嵌套 if 的分支体后求值条件相同。
     * 只处理 && 链最右端的序列(且 if 没有 else):`||` 的短路语义不同;
     * 有 else 时外层条件为假也必须执行 else,不能只挂到内层 if 上。
     */
    public static foldSequencedTestPrefixes(node: Program): boolean {
        let changed = false;
        traverse(file(node), {
            noScope: true,
            IfStatement: (path) => {
                // 有 else 时外层条件为假也要走 else,不能只把 else 挂到内层 if 上。
                if (path.node.alternate != null) return;
                const test = path.node.test;
                if (!isLogicalExpression(test) || test.operator !== "&&") return;
                const operands: TYPE.Expression[] = [];
                let right = test as TYPE.Expression;
                while (isLogicalExpression(right) && right.operator === "&&") {
                    operands.push(right.left as TYPE.Expression);
                    right = right.right as TYPE.Expression;
                }
                while (isParenthesizedExpression(right)) right = right.expression;
                // 单条前缀赋值(如 `if (X && (X = f(), X.length > 0))`)是既有输出里
                // 紧凑且可读的形态;只有多条赋值堆在 test 里才值得拆成嵌套 if。
                if (!isSequenceExpression(right) || right.expressions.length < 3) return;

                const last = right.expressions[right.expressions.length - 1] as TYPE.Expression;
                let outer = operands[0];
                for (let i = 1; i < operands.length; i++) {
                    outer = logicalExpression("&&", outer, operands[i]);
                }
                const inner = TYPE.ifStatement(last, path.node.consequent, null);
                const body: TYPE.Statement[] = right.expressions.slice(0, -1).map((expr) =>
                    expressionStatement(expr as TYPE.Expression));
                body.push(inner);
                path.node.test = outer;
                path.node.consequent = TYPE.blockStatement(body);
                changed = true;
            },
        });
        return changed;
    }

    /**
     * 流水线末尾只归一化三元 test:结构改写完成后,三目 test 里可能残留
     * `!!!x` 这类重复取反。这里只做表达式级归一化,不调用 `transformIfOnce`
     * (那会重新调整 if 的分支结构)。
     */
    public static foldConditionalTestNegations(node: Program): void {
        const pass = new SyntaxRewriteSimplify();
        traverse(file(node), {
            noScope: true,
            ConditionalExpression: (path) => {
                const test = pass.simplifyTestNode(path.node.test);
                if (test !== path.node.test) path.node.test = test;
            },
        });
    }

    /** 供流水线末尾调用:HighLevelGrammarSimplify 可能新生成 if/三元,需要再归一化一次 test。 */
    public static normalizeConditionTests(node: Program): void {
        const pass = new SyntaxRewriteSimplify();
        traverse(file(node), {
            noScope: true,
            IfStatement: (path) => {
                for (let i = 0; i < 4; i++) {
                    path.node.test = pass.simplifyTestNode(path.node.test);
                    if (!pass.transformIfOnce(path)) break;
                }
            },
            WhileStatement: (path) => {
                path.node.test = pass.simplifyTestNode(path.node.test);
            },
            DoWhileStatement: (path) => {
                path.node.test = pass.simplifyTestNode(path.node.test);
            },
            ConditionalExpression: (path) => {
                let test = pass.simplifyTestNode(path.node.test);
                if (test !== path.node.test) path.node.test = test;
                for (let i = 0; i < 4; i++) {
                    const folded = pass.foldBooleanConditional(path.node);
                    if (!folded) break;
                    if (folded === path.node) continue;
                    path.replaceWith(folded);
                    break;
                }
            },
        });
    }

    /**
     * 把 `if (A || (v1 = 0, v2 = 2, B)) return;` 里只给临时变量赋常量字面量的
     * 前缀语句提到 if 前面:
     *   v1 = 0;
     *   v2 = 2;
     *   if (A || B) return;
     * 只有短路分支直接 return/throw、且不读取这些临时变量时才安全
     * (短路时原本不会执行前缀,提到前面后会在 A 为真时也执行;
     * 分支直接退出且不读取,就不会观察到这个差异)。
     */
    public static hoistTestPrefixes(node: Program): void {
        const isHoistableValue = (expr: TYPE.Node | null | undefined): boolean => {
            if (!expr) return false;
            if (isNumericLiteral(expr) || isStringLiteral(expr)
                || isBooleanLiteral(expr) || isNullLiteral(expr)) return true;
            if (isIdentifier(expr) && expr.name === "undefined") return true;
            if (isUnaryExpression(expr)) {
                if (expr.operator === "void") return isNumericLiteral(expr.argument);
                return (expr.operator === "-" || expr.operator === "+") && isNumericLiteral(expr.argument);
            }
            return false;
        };
        const alwaysExits = (stmt: TYPE.Statement | null | undefined): boolean => {
            if (!stmt) return false;
            if (isReturnStatement(stmt) || isThrowStatement(stmt)) return true;
            if (isBlockStatement(stmt)) return stmt.body.some(alwaysExits);
            if (isIfStatement(stmt)) {
                return stmt.alternate != null && alwaysExits(stmt.consequent) && alwaysExits(stmt.alternate);
            }
            return false;
        };
        traverse(file(node), {
            noScope: true,
            IfStatement: (path) => {
                const test = path.node.test;
                if (!isLogicalExpression(test) || test.operator !== "||") return;
                const right = test.right;
                if (!isSequenceExpression(right) || right.expressions.length < 2) return;
                const prefix: TYPE.ExpressionStatement[] = [];
                const names = new Set<string>();
                for (let i = 0; i < right.expressions.length - 1; i++) {
                    const expr = right.expressions[i];
                    if (!isAssignmentExpression(expr) || expr.operator !== "=") return;
                    if (!isIdentifier(expr.left) || !isTempName(expr.left.name)) return;
                    if (!isHoistableValue(expr.right)) return;
                    names.add(expr.left.name);
                    prefix.push(expressionStatement(expr));
                }
                if (prefix.length === 0) return;
                // A 侧不能读写这些临时变量(提到前面会改变 A 看到的值)
                for (const name of names) {
                    if (collectIdentifierNames(test.left).has(name)) return;
                }
                // 短路分支必须直接退出,且不读取这些临时变量
                const consequent = path.node.consequent;
                if (!alwaysExits(consequent)) return;
                for (const name of names) {
                    if (collectIdentifierNames(consequent).has(name)) return;
                }
                // finally 能观察到提前赋值后的值
                if (path.findParent((p) => p.isTryStatement() && p.node.finalizer != null)) return;
                path.insertBefore(prefix);
                test.right = right.expressions[right.expressions.length - 1] as TYPE.Expression;
            },
        });
    }

    private checkIsAccUndefined(stmt: TYPE.Statement): boolean {
        return isExpressionStatementNode(stmt)
            && isAssignmentExpression(stmt.expression)
            && isIdentifier(stmt.expression.left) && stmt.expression.left.name === "acc"
            && isIdentifier(stmt.expression.right) && stmt.expression.right.name === "undefined";
    }

    private removeFunctionReturnUndefined(body: TYPE.BlockStatement): boolean {
        const statements = body.body;
        if (statements.length < 2) return false;
        const last = statements[statements.length - 1];
        const last2 = statements[statements.length - 2];
        if (this.checkIsAccUndefined(last2)
            && isReturnStatement(last) && last.argument == null) {
            statements.pop();
            statements.pop();
            return true;
        }
        return false;
    }

    private duplicateAccUndefined(block: TYPE.BlockStatement): boolean {
        let changed = false;
        for (let i = block.body.length - 1; i > 0; i--) {
            if (this.checkIsAccUndefined(block.body[i]) && this.checkIsAccUndefined(block.body[i - 1])) {
                block.body.splice(i, 1);
                changed = true;
            }
        }
        return changed;
    }

    private changeCallExpression(node: TYPE.CallExpression): boolean {
        const callee = node.callee;
        if (!isMemberExpression(callee) || callee.computed) return false;
        if (!isIdentifier(callee.property) || callee.property.name !== "call") return false;
        if (node.arguments.length === 0) return false;

        const fn = callee.object;
        const receiver = node.arguments[0];
        // 只有 receiver 明确是 null/undefined,或 fn 就是 receiver.method 时,
        // fn.call(receiver, ...) 才能安全地写成 fn(...)
        const receiverIsNullish = isNullLiteral(receiver)
            || (isIdentifier(receiver) && receiver.name === "undefined")
            || (isUnaryExpression(receiver) && receiver.operator === "void");
        const receiverMatchesObject = isMemberExpression(fn)
            && (isNodeEqual(fn.object as TYPE.Node, receiver as TYPE.Node)
                || (isSuper(fn.object) && isThisExpression(receiver)));
        if (!receiverIsNullish && !receiverMatchesObject) return false;

        let object = fn;
        if (isMemberExpression(object) && object.computed && isStringLiteral(object.property)) {
            object.property = identifier(object.property.value);
            object.computed = false;
        }
        node.callee = object as TYPE.Expression;
        node.arguments.shift();
        return true;
    }

    private isDiscardableExpression(node: TYPE.Expression): boolean {
        if (isDeclarationValue(node)) return false;
        if (isMemberExpression(node) || isOptionalMemberExpression(node)
            || isCallExpression(node) || isNewExpression(node)
            || isAssignmentExpression(node) || isUpdateExpression(node)
            || isAwaitExpression(node) || isYieldExpression(node)
            || isTaggedTemplateExpression(node)) {
            return false;
        }
        return isPureExpression(node);
    }

    /** X = [a]; X[1] = b; X[2] = c; -> X = [a, b, c]; */
    private foldArrayAssignments(stmts: TYPE.Statement[]): boolean {
        let changed = false;
        for (let i = 0; i < stmts.length; i++) {
            const statement = stmts[i];
            if (!isExpressionStatementNode(statement) || !isAssignmentExpression(statement.expression)) continue;
            const init = statement.expression;
            if (init.operator !== "=" || !isIdentifier(init.left) || !isArrayExpression(init.right)) continue;
            const name = init.left.name;
            const array = init.right;
            if (array.elements.some((e) => isSpreadElement(e))) continue;

            let j = i + 1;
            for (; j < stmts.length; j++) {
                const next = stmts[j];
                if (!isExpressionStatementNode(next) || !isAssignmentExpression(next.expression)) break;
                const assign = next.expression;
                if (assign.operator !== "=" || !isMemberExpression(assign.left)) break;
                const member = assign.left;
                if (!member.computed || !isIdentifier(member.object) || member.object.name !== name) break;
                const indexNode = member.property;
                const index = isNumericLiteral(indexNode) ? indexNode.value
                    : (isStringLiteral(indexNode) && /^\d+$/.test(indexNode.value) ? Number(indexNode.value) : NaN);
                if (!Number.isInteger(index) || index < 0 || index !== array.elements.length) break;
                if (collectIdentifierNames(assign.right).has(name)) break;
                array.elements.push(assign.right);
                changed = true;
            }
            if (j > i + 1) {
                stmts.splice(i + 1, j - (i + 1));
                i--;
            }
        }
        return changed;
    }

    private invertTestNode(node: TYPE.Expression): TYPE.Expression {
        if (isUnaryExpression(node) && node.operator === "!") return node.argument;
        if (isBinaryExpression(node)) {
            const op = SyntaxRewriteSimplify.binaryInvert(node);
            if (op == null) return unaryExpression("!", node);
            node.operator = op;
            return node;
        }
        return unaryExpression("!", node);
    }

    /** 只做一次结构变换;返回是否发生变化。 */
    private transformIfOnce(value: NodePath<TYPE.IfStatement>): boolean {
        const node = value.node;
        const consequent = node.consequent;
        const alternate = node.alternate;

        // else { if (...) ... } -> else if (...)
        if (isBlockStatement(alternate) && alternate.body.length === 1
            && isIfStatement(alternate.body[0])) {
            node.alternate = alternate.body[0];
            return true;
        }
        // if (test) { if (test2) ... } else {...}
        if (isBlockStatement(consequent) && consequent.body.length === 1
            && isIfStatement(consequent.body[0]) && alternate != null) {
            node.test = this.invertTestNode(node.test);
            node.consequent = alternate;
            node.alternate = consequent.body[0];
            return true;
        }
        // if (a !== b) A else B -> if (a === b) B else A
        if (isBlockStatement(consequent) && isBlockStatement(alternate)
            && isBinaryExpression(node.test)
            && (node.test.operator === "!==" || node.test.operator === "!=")) {
            node.test.operator = node.test.operator === "!==" ? "===" : "==";
            node.consequent = alternate;
            node.alternate = consequent;
            return true;
        }
        // 空 else
        if (isBlockStatement(alternate) && alternate.body.length === 0) {
            node.alternate = null;
            return true;
        }
        // 空 if 分支
        if (isBlockStatement(consequent) && consequent.body.length === 0
            && isBlockStatement(alternate)) {
            node.test = this.invertExpression(node.test);
            node.consequent = alternate;
            node.alternate = null;
            return true;
        }
        return false;
    }

    /** 定点迭代稳定后执行:x = x op y -> x op= y(避免提前改写干扰复制传播/活跃性) */
    public static foldCompoundAssignments(node: Program): void {
        traverse(file(node), {
            noScope: true,
            AssignmentExpression: (value) => {
                const assign = value.node;
                if (assign.operator !== "=" || !isIdentifier(assign.left)) return;
                const right = assign.right;
                if (!isBinaryExpression(right)) return;
                if (!isIdentifier(right.left) || right.left.name !== assign.left.name) return;
                switch (right.operator) {
                    case "+": case "-": case "*": case "/": case "%":
                    case "<<": case ">>": case ">>>": case "&": case "|": case "^": case "**":
                        break;
                    default:
                        return;
                }
                assign.operator = (right.operator + "=") as TYPE.AssignmentExpression["operator"];
                assign.right = right.right;
            },
        });
    }

    simplify(node: Program): boolean {
        let changed = false;
        traverse(file(node), {
            noScope: true,
            IfStatement: (value) => {
                const simplified = this.simplifyTestNode(value.node.test);
                if (simplified !== value.node.test) {
                    value.node.test = simplified;
                    changed = true;
                }
                for (let i = 0; i < 8; i++) {
                    if (!this.transformIfOnce(value)) break;
                    changed = true;
                }
            },
            ConditionalExpression: (value) => {
                for (let i = 0; i < 4; i++) {
                    const folded = this.foldBooleanConditional(value.node);
                    if (!folded) break;
                    changed = true;
                    if (folded === value.node) continue;
                    value.replaceWith(folded);
                    break;
                }
            },
            UpdateExpression: (value) => {
                const parent = value.getStatementParent();
                if (!parent || !parent.isExpressionStatement()) return;
                const expression = parent.node.expression;
                if (!isAssignmentExpression(expression) || expression.right !== value.node) return;
                const left = expression.left;
                const right = value.node.argument;
                if (isIdentifier(left) && isIdentifier(right) && left.name === right.name) {
                    parent.node.expression = expression.right;
                    changed = true;
                }
            },
            BlockStatement: (value) => {
                if (this.duplicateAccUndefined(value.node)) changed = true;
            },
            Function: (value) => {
                if (!isBlockStatement(value.node.body)) return;
                if (this.removeFunctionReturnUndefined(value.node.body)) {
                    changed = true;
                }
                // 末尾的裸 return; 等价于自然结束
                const body = value.node.body.body;
                const last = body[body.length - 1];
                if (isReturnStatement(last) && last.argument == null) {
                    body.pop();
                    changed = true;
                }
            },
            MemberExpression: (value) => {
                if (value.node.computed && isStringLiteral(value.node.property)) {
                    const name = value.node.property.value;
                    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) {
                        value.node.property = identifier(name);
                        value.node.computed = false;
                        changed = true;
                    }
                }
                if (!isIdentifier(value.node.object) || value.node.object.name !== "arguments") return;
                if (!isNumericLiteral(value.node.property)) return;
                const functionParent = value.getFunctionParent();
                if (!functionParent) return;
                const paramsLength = functionParent.node.params.length;
                const memNum = value.node.property.value;
                if (memNum < paramsLength) {
                    value.replaceWith(identifier("p" + memNum));
                    changed = true;
                }
            },
            CallExpression: (value) => {
                if (this.changeCallExpression(value.node)) changed = true;
            },
            FunctionExpression: (value) => {
                const statement = value.getStatementParent();
                if (!statement || !statement.isExpressionStatement()) return;
                if (statement.node.expression !== value.node) return;
                const fn = value.node;
                // 匿名函数表达式不能转成函数声明(声明必须有名字)
                if (!fn.id) return;
                statement.replaceWith(functionDeclaration(fn.id, fn.params, fn.body, fn.generator, fn.async));
                changed = true;
            },
            UnaryExpression: (value) => {
                if (value.node.operator !== "!") return;
                const arg = value.node.argument;
                if (isNumericLiteral(arg)) {
                    value.replaceWith(booleanLiteral(arg.value === 0));
                    changed = true;
                } else if (isBooleanLiteral(arg)) {
                    value.replaceWith(booleanLiteral(!arg.value));
                    changed = true;
                }
            },
            ExpressionStatement: (value) => {
                // 新版 @babel/types 的声明不再暴露 deprecated 的 directive 字段(运行时仍在),防止误删 "use strict"
                if ((value.node as TYPE.ExpressionStatement & { directive?: string }).directive) return;
                if (this.isDiscardableExpression(value.node.expression)) {
                    value.remove();
                    changed = true;
                }
            },
            SpreadElement: (value) => {
                if (isArrayExpression(value.node.argument) && value.node.argument.elements.length === 1) {
                    value.replaceWith(value.node.argument.elements[0]);
                    changed = true;
                }
            },
        });

        // 第二遍只处理 Program/Block 的语句列表,用纯 AST 遍历代替 Babel traverse:
        // 这一遍不依赖 NodePath/scope,walkNode 的开销明显更低。
        walkNode(node, (n) => {
            if (n.type === "Program" || n.type === "BlockStatement") {
                if (this.foldArrayAssignments(n.body as TYPE.Statement[])) changed = true;
            }
            return true;
        });
        return changed;
    }
}
