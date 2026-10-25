import * as TYPE from "@babel/types";
import { isClassLike, isFunctionLike, walkNode } from "./AstUtils";

const {
    VISITOR_KEYS,
    blockStatement,
    booleanLiteral,
    breakStatement,
    continueStatement,
    isEmptyStatement,
    isCallExpression,
    isExpressionStatement,
    isIdentifier,
    isLabeledStatement,
    whileStatement,
} = TYPE;

const GOTO_CALLEE = "xpanda_goto";

interface LabelSite {
    /** label 所在的语句列表 */
    list: TYPE.Statement[];
    /** label 在该列表中的下标 */
    index: number;
    /** label 名(等于 `xpanda_goto(label_xxx)` 的参数名) */
    label: string;
    /** 所在函数(嵌套函数里的 label 单独算) */
    fn: TYPE.Node;
    /** label 是否位于外层循环/switch 里(循环体内的裸 break/continue 可能属于外层) */
    insideJumpTarget: boolean;
}

interface GotoLoopSpan extends LabelSite {
    /** 该 label 的全部 goto 语句(都在循环体内) */
    gotos: TYPE.Statement[];
    /**
     * 循环体会自然落空(末尾不是 return/throw/break/continue/goto)。
     * 包装后要在循环体末尾补一条 break:落空原本是"继续执行循环体后面的语句",
     * 包进 while (true) 之后必须靠 break 离开,否则变成死循环。
     */
    fallsThrough: boolean;
}

/**
 * 还原结构化分析兜底产生的循环:
 *
 *   label_852: ;
 *   if (!videoDone) {
 *     ...
 *     xpanda_goto(label_852);
 *   } else if (...) { ... }
 *   =>
 *   while (true) {
 *     if (!videoDone) {
 *       ...
 *       continue;
 *     } else if (...) { ... }
 *   }
 *
 * `StructureAnalysis.determineFollowLatch` 确定不了 follow/latch 时会给回边所在区域插一条
 * `xpanda_goto(label)`(见该方法的 goto 兜底),而这条 goto 往往落在深层 if 分支里。
 * 生成 AST 时 `NodeUtils.tryFixGoto` 只在同一个语句块里找 label,找不到就只能原样输出调用,
 * 循环结构彻底丢失(`xpanda_goto` 本身不是可执行代码)。
 *
 * label 一定是循环头(兜底逻辑只对回边这么处理),所以「label 之后、到所在语句块结尾」
 * 就是循环体:把其中的 goto 换成 continue,再整体包进 `while (true)` 即可。
 * 只有能确认整段都是循环体时才改写:
 *   - 循环体内该 label 的 goto 至少有一条,且循环体内没有指向其它 label 的 goto;
 *   - 同名 label(区域复制会产生同名副本)的循环体互不包含、goto 互不重叠;
 *   - label 位于外层循环/switch 里时,循环体内不能有裸 break/continue(会被新循环截获);
 *   - goto 不在循环体内的嵌套循环里(continue 会绑到内层循环上)。
 *
 * 放在 simplify 流水线开头:后面的活跃性分析/条件折叠需要看到真实的循环结构,
 * 否则循环体内的死存储会被当成直线代码清掉(计数器 `v11 = 0` 会被常量传播成 `0 + 1`)。
 *
 * @Author: jmp0
 */
export function restoreGotoLoops(program: TYPE.Program): void {
    // 每轮只改写一处,避免一次替换让其余候选的位置失效
    for (let round = 0; round < 8; round++) {
        if (!restoreOne(program)) return;
    }
}

function restoreOne(program: TYPE.Program): boolean {
    const sites: LabelSite[] = [];
    collectSites(program, program, sites);
    const all: GotoLoopSpan[] = [];
    for (const site of sites) {
        const span = buildSpan(site);
        if (span) all.push(span);
    }
    // 同名 label(区域复制会留下同名副本)的循环体互相包含或共用 goto 时归属不明,整组放弃
    const disjoint = all.filter((span) => !all.some((other) => other !== span
        && other.label === span.label && overlaps(span, other)));
    // 同一函数内该 label 的每条 goto 都必须落在某个候选循环体里:
    // 还有跳转留在循环体之外时(label 所在语句块之外也有 goto),包 while 会把它甩到循环外
    const valid = disjoint.filter((span) => sameLabelGotos(span.fn, span.label)
        .every((goto) => disjoint.some((other) => other.label === span.label && other.gotos.includes(goto))));
    // 逆序:同一批候选里嵌套的 label(内层)先还原
    for (let i = valid.length - 1; i >= 0; i--) {
        applySpan(valid[i]);
        return true;
    }
    return false;
}

function overlaps(span: GotoLoopSpan, other: GotoLoopSpan): boolean {
    return span.gotos.some((goto) => other.gotos.includes(goto));
}

/** 同一函数内(不进嵌套函数)指向 label 的全部 goto 语句 */
function sameLabelGotos(fn: TYPE.Node, label: string): TYPE.Statement[] {
    const gotos: TYPE.Statement[] = [];
    walkNode(fn, (current) => {
        if (isFunctionLike(current) || isClassLike(current)) return current === fn;
        if (isGotoStatement(current, label)) gotos.push(current as TYPE.Statement);
        return true;
    });
    return gotos;
}

/** 收集候选 label:遍历所有语句列表;fn 是当前所在的函数节点,goto 只在同一函数内折算 */
function collectSites(
    node: TYPE.Node,
    fn: TYPE.Node,
    sites: LabelSite[],
    insideJumpTarget: boolean = false,
): void {
    const keys = (VISITOR_KEYS as any)[node.type] as string[] | undefined;
    if (!keys) return;
    for (const key of keys) {
        const value = (node as any)[key];
        if (Array.isArray(value)) {
            // switch 的 case 体不是普通语句块,包 while 会改变 case 里 break 的含义
            if (key !== "consequent") {
                const list = value as TYPE.Statement[];
                for (let index = 0; index < list.length; index++) {
                    const statement = list[index];
                    if (!statement || typeof statement.type !== "string") continue;
                    if (!isLabeledStatement(statement) || !isEmptyStatement(statement.body)) continue;
                    sites.push({ list, index, label: statement.label.name, fn, insideJumpTarget });
                }
            }
            for (const child of value) {
                if (!child || typeof child.type !== "string") continue;
                visitChild(child);
            }
        } else if (value && typeof value.type === "string") {
            visitChild(value);
        }
    }

    function visitChild(child: TYPE.Node): void {
        if (isFunctionLike(child) || isClassLike(child)) {
            // 嵌套函数单独算,外层循环/switch 与它的 break/continue 无关
            collectSites(child, child, sites, false);
            return;
        }
        // 外层循环/switch/label 里的 label:循环体内的裸 break/continue 可能属于外层
        const nested = insideJumpTarget || isJumpTargetNode(child) || child.type === "LabeledStatement";
        collectSites(child, fn, sites, nested);
    }
}

function buildSpan(site: LabelSite): GotoLoopSpan | null {
    const body = site.list.slice(site.index + 1);
    if (body.length === 0) return null;
    const gotos: TYPE.Statement[] = [];
    // 循环体内该 label 的 goto(不进嵌套函数)
    walkNode(blockStatement(body), (current) => {
        if (isFunctionLike(current) || isClassLike(current)) return false;
        if (!isGotoStatement(current, site.label)) return true;
        gotos.push(current as TYPE.Statement);
        return true;
    });
    if (gotos.length === 0) return null;
    for (const statement of body) {
        if (hasOtherGoto(statement, site.label)) return null;
        // 循环体外没有外层循环/switch 时,循环体里的 break/continue 只可能是本循环
        // 兜底时留下的出口跳转(外部结构没归约出来),包进 while (true) 正好接住;
        // 有外层循环/switch 时它们可能原本绑在外层,保守放弃。
        if (site.insideJumpTarget && hasFreeJump(statement)) return null;
    }
    for (const goto of gotos) {
        if (insideNestedLoop(body, goto)) return null;
    }
    // 循环体末尾可能自然落空:包装前这些语句是循环头之后的一段直线代码,落空只是
    // 继续执行循环体后面的语句(含方法结尾的隐含 return);包进 while (true) 之后
    // 就变成了"再执行一遍循环体",所以要在末尾补 break 离开循环:
    //
    //   label: A; if (c) goto label; B
    //     =>  while (true) { A; if (c) continue; break; } B
    const last = body[body.length - 1];
    const fallsThrough = !terminatesInLoop(last, site.label);
    return { ...site, gotos, fallsThrough };
}

/**
 * 语句是否一定不会自然落空(return/throw/break/continue,或本循环的 goto),
 * 用于确认循环体末尾可达路径一定离开循环。
 */
function terminatesInLoop(statement: TYPE.Statement, label: string): boolean {
    if (isGotoStatement(statement, label)) return true;
    switch (statement.type) {
        case "ReturnStatement":
        case "ThrowStatement":
        case "BreakStatement":
        case "ContinueStatement":
            return true;
        case "BlockStatement":
            return statement.body.length > 0 && terminatesInLoop(statement.body[statement.body.length - 1], label);
        case "IfStatement":
            return statement.alternate != null
                && terminatesInLoop(statement.consequent, label)
                && terminatesInLoop(statement.alternate, label);
        case "LabeledStatement":
            return terminatesInLoop(statement.body, label);
        case "SwitchStatement":
            return statement.cases.some((one) => one.test === null)
                && statement.cases.every((one) => {
                    if (one.consequent.length === 0) return false;
                    const last = one.consequent[one.consequent.length - 1];
                    // case 末尾的裸 break 只跳出 switch,switch 之后的语句仍然会执行,
                    // 所以它不能算"离开循环体"(否则外层 while (true) 会漏补 break 成死循环)。
                    if (last.type === "BreakStatement" && last.label == null) return false;
                    return terminatesInLoop(last, label);
                });
        case "TryStatement":
            return terminatesInLoop(statement.block, label)
                && (!statement.handler || terminatesInLoop(statement.handler.body, label));
        default:
            return false;
    }
}

function applySpan(span: GotoLoopSpan): void {
    const body = span.list.splice(span.index + 1);
    // 末尾补的 break 在替换 goto 之后追加,保证它绑定到新包出来的 while 上
    const block = blockStatement(body);
    replaceGotos(block, span.label);
    if (span.fallsThrough) block.body.push(breakStatement());
    span.list.splice(span.index, 1, whileStatement(booleanLiteral(true), block));
}

/** 把子树里的 `xpanda_goto(label)` 语句换成 continue(不进嵌套函数) */
function replaceGotos(node: TYPE.Node, label: string): void {
    const keys = (VISITOR_KEYS as any)[node.type] as string[] | undefined;
    if (!keys) return;
    for (const key of keys) {
        const value = (node as any)[key];
        if (Array.isArray(value)) {
            for (let i = 0; i < value.length; i++) {
                const child = value[i];
                if (!child || typeof child.type !== "string") continue;
                if (isGotoStatement(child, label)) {
                    value[i] = continueStatement();
                    continue;
                }
                if (isFunctionLike(child) || isClassLike(child)) continue;
                replaceGotos(child, label);
            }
        } else if (value && typeof value.type === "string") {
            if (isGotoStatement(value, label)) {
                (node as any)[key] = continueStatement();
                continue;
            }
            if (isFunctionLike(value) || isClassLike(value)) continue;
            replaceGotos(value, label);
        }
    }
}

function isGotoStatement(node: TYPE.Node, label: string): boolean {
    if (!isExpressionStatement(node)) return false;
    const expression = node.expression;
    if (!isCallExpression(expression)) return false;
    if (!isIdentifier(expression.callee) || expression.callee.name !== GOTO_CALLEE) return false;
    const args = expression.arguments;
    return args.length === 1 && isIdentifier(args[0] as TYPE.Node) && (args[0] as TYPE.Identifier).name === label;
}

/** 子树里是否有指向其它 label 的 goto */
function hasOtherGoto(root: TYPE.Node, label: string): boolean {
    let found = false;
    walkNode(root, (current) => {
        if (found) return false;
        if (isFunctionLike(current) || isClassLike(current)) return false;
        if (!isExpressionStatement(current) || !isCallExpression(current.expression)) return true;
        const callee = current.expression.callee;
        if (!isIdentifier(callee) || callee.name !== GOTO_CALLEE) return true;
        const args = current.expression.arguments;
        if (!(args.length === 1 && isIdentifier(args[0] as TYPE.Node) && (args[0] as TYPE.Identifier).name === label)) {
            found = true;
        }
        return !found;
    });
    return found;
}

/** root 到 target 的祖先链(不含 target);找不到(或在嵌套函数里)时返回 null */
function ancestorChain(root: TYPE.Node, target: TYPE.Node): TYPE.Node[] | null {
    const chain: TYPE.Node[] = [];
    const visit = (node: TYPE.Node): boolean => {
        if (node === target) return true;
        if (isFunctionLike(node) || isClassLike(node)) return false;
        chain.push(node);
        const keys = (VISITOR_KEYS as any)[node.type] as string[] | undefined;
        if (keys) {
            for (const key of keys) {
                const value = (node as any)[key];
                if (Array.isArray(value)) {
                    for (const child of value) {
                        if (child && typeof child.type === "string" && visit(child)) return true;
                    }
                } else if (value && typeof value.type === "string" && visit(value)) return true;
            }
        }
        chain.pop();
        return false;
    };
    return visit(root) ? chain : null;
}

function containsNodeDeep(root: TYPE.Node, target: TYPE.Node): boolean {
    let found = root === target;
    if (found) return true;
    walkNode(root, (current) => {
        if (found) return false;
        if (current === target) {
            found = true;
            return false;
        }
        return true;
    });
    return found;
}

/** goto 与循环体之间是否隔着嵌套循环 */
function insideNestedLoop(body: TYPE.Statement[], goto: TYPE.Node): boolean {
    for (const statement of body) {
        if (!containsNodeDeep(statement, goto)) continue;
        const chain = ancestorChain(statement, goto);
        // 祖先链拿不到(嵌套函数等)时保守放弃
        return chain === null || chain.some(isLoopNode);
    }
    return true;
}

/** 子树里是否有绑定在当前语句之外的裸 break/continue(新循环会截获它们) */
function hasFreeJump(root: TYPE.Node): boolean {
    let free = false;
    const visit = (node: TYPE.Node, inJumpTarget: boolean): void => {
        if (free) return;
        if (isFunctionLike(node) || isClassLike(node)) return;
        if ((node.type === "BreakStatement" || node.type === "ContinueStatement") && !inJumpTarget) {
            free = true;
            return;
        }
        const inner = inJumpTarget || isJumpTargetNode(node);
        const keys = (VISITOR_KEYS as any)[node.type] as string[] | undefined;
        if (!keys) return;
        for (const key of keys) {
            const value = (node as any)[key];
            if (Array.isArray(value)) {
                for (const child of value) {
                    if (child && typeof child.type === "string") visit(child, inner);
                }
            } else if (value && typeof value.type === "string") {
                visit(value, inner);
            }
        }
    };
    visit(root, false);
    return free;
}

function isLoopNode(node: TYPE.Node): boolean {
    return node.type === "WhileStatement" || node.type === "DoWhileStatement" || node.type === "ForStatement"
        || node.type === "ForInStatement" || node.type === "ForOfStatement";
}

function isJumpTargetNode(node: TYPE.Node): boolean {
    return isLoopNode(node) || node.type === "SwitchStatement";
}
