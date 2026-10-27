import { Program } from "@babel/types";
import traverse from "@babel/traverse";
import * as TYPE from "@babel/types";
import { collectAssignedNames, collectReadNames, isNodeEqual, isPureExpression } from "./AstUtils";


const {
    assignmentExpression,
    binaryExpression,
    conditionalExpression,
    expressionStatement,
    file,
    identifier,
    isAssignmentExpression,
    isBinaryExpression,
    isBlockStatement,
    isBreakStatement,
    isExpressionStatement,
    isIdentifier,
    isLogicalExpression,
    isNullLiteral,
    isStatement,
    logicalExpression,
    nullLiteral,
} = TYPE;

/**
 * 还原 nullish coalescing 的 switch lowering:
 *
 *   v8 = obj.contentId;
 *   switch (obj.contentId) {
 *     case null:
 *     case undefined:
 *       v8 = "";
 *       break;
 *   }
 *   =>
 *   v8 = obj.contentId ?? "";
 *
 * 另一种形态是两个 case 各自赋值同一个默认值(编译器把 `a ?? b` 展开成
 * `if (a === null) b = d; else if (a === undefined) b = d`):
 *
 *   v0 = v0 == null ? undefined : v0.voteupCount;
 *   switch (v0) {
 *     case null:
 *       v0 = 0;
 *       break;
 *     case undefined:
 *       v0 = 0;
 *       break;
 *   }
 *   =>
 *   v0 = (v0 == null ? undefined : v0.voteupCount) ?? 0;
 *
 * HighLevelGrammarSimplify 会把 `if (x === null || x === undefined) x = default`
 * 合成 switch；当判别式和赋值目标不是同一个临时变量（判别式已被复制传播成成员表达式）
 * 时，现有的 canTransform2questionMarkStatement 无法还原，这里在流水线末尾补一轮。
 *
 * 没有走 switch 的形态也在这里还原（见 foldIf / foldConditional）：
 *
 *   v8 = v6?.text;
 *   acc = v8?.runs;
 *   if (acc == null) { acc = []; }
 *   return acc;
 *   =>
 *   v8 = v6?.text;
 *   return v8?.runs ?? [];
 *
 * @Author: jmp0
 */
export class NullishCoalescingSimplify {
    simplify(node: Program): boolean {
        let changed = false;
        traverse(file(node), {
            noScope: true,
            SwitchStatement: (path) => {
                if (this.foldSwitch(path)) changed = true;
            },
            IfStatement: (path) => {
                if (this.foldIf(path)) changed = true;
            },
            ConditionalExpression: (path) => {
                if (this.foldConditional(path)) changed = true;
            },
        });
        return changed;
    }

    /**
     * `X = E; if (X == null) { X = D }` → `X = E ?? D`。
     *
     * 这是 `a ?? d` 最常见的 lowering(判别式在被赋值的临时量上):
     *
     *   v8 = v6?.text;
     *   acc = v8?.runs;
     *   if (acc == null) {
     *     acc = [];
     *   }
     *   return acc;
     * =>
     *   return v8?.runs ?? [];
     *
     * 也接受未合并的严格形态(`X === null || X === undefined`)与取反形态
     * (`X != null` / `X !== null && X !== undefined`)——后者的 nullish 分支在 else。
     * 必须是紧邻的一条 `X = E`(E 的求值次数与顺序在 ?? 里完全一致)、分支体只有
     * `X = D` 一条语句(另一分支为空),且 D 不读取 X(?? 的右值读到的仍是合并前的值)。
     * 放在 foldReturnAssignments 之前执行,`X = E ?? D; return X` 才能继续折成
     * `return E ?? D`。
     */
    private foldIf(path: any): boolean {
        const ifNode = path.node as TYPE.IfStatement;
        const check = this.nullishTarget(ifNode.test);
        if (!check) return false;
        const nullishBranch = check.truthyIsNullish ? ifNode.consequent : ifNode.alternate;
        const otherBranch = check.truthyIsNullish ? ifNode.alternate : ifNode.consequent;
        if (!nullishBranch || (otherBranch && !this.isEmptyBranch(otherBranch))) return false;

        const prev = path.getPrevSibling();
        if (!prev || !isExpressionStatement(prev.node) || !isAssignmentExpression(prev.node.expression)) return false;
        const prevAssign = prev.node.expression;
        if (prevAssign.operator !== "=" || !isIdentifier(prevAssign.left)) return false;
        const target = prevAssign.left.name;

        const defaultValue = this.nullishAssignment(nullishBranch, target);
        if (!defaultValue) return false;
        // ?? 的右值读到的是 X 的旧值(此时为 null/undefined),不能依赖它。
        if (collectReadNames(defaultValue).has(target)) return false;
        // 判别式要么就是被赋值的临时量,要么与右值完全相同(复制传播把临时量换成了
        // 纯成员表达式,switch 形态的 foldSwitch 也走同样的判定)。
        const matchesTemp = isIdentifier(check.target) && check.target.name === target;
        const matchesValue = isNodeEqual(check.target, prevAssign.right) && isPureExpression(check.target);
        if (!matchesTemp && !matchesValue) return false;

        prev.replaceWith(expressionStatement(
            assignmentExpression("=", identifier(target), logicalExpression("??", prevAssign.right, defaultValue)),
        ));
        path.remove();
        return true;
    }

    /**
     * `X == null ? D : X`(`X === null || X === undefined ? D : X`)→ `X ?? D`。
     * 条件为真时 X 一定是 null/undefined,两分支与 ?? 逐一对应;判别式必须与
     * 非 nullish 分支是同一个表达式。
     */
    private foldConditional(path: any): boolean {
        const node = path.node as TYPE.ConditionalExpression;
        const check = this.nullishTarget(node.test);
        if (!check) return false;
        const value = check.truthyIsNullish ? node.alternate : node.consequent;
        const defaultValue = check.truthyIsNullish ? node.consequent : node.alternate;
        if (!isNodeEqual(check.target, value as TYPE.Expression) || !isPureExpression(check.target)) return false;
        path.replaceWith(logicalExpression("??", check.target, defaultValue));
        return true;
    }

    /** 分支是否为空(空块 / 空语句 / `X = X` 自赋值)。 */
    private isEmptyBranch(branch: TYPE.Node): boolean {
        if (isBlockStatement(branch)) {
            return branch.body.every((stmt) => isStatement(stmt) && this.isNoOpStatement(stmt));
        }
        return isStatement(branch) && this.isNoOpStatement(branch);
    }

    private isNoOpStatement(stmt: TYPE.Statement): boolean {
        if (stmt.type === "EmptyStatement") return true;
        if (!isExpressionStatement(stmt) || !isAssignmentExpression(stmt.expression)) return false;
        const assign = stmt.expression;
        return assign.operator === "=" && isIdentifier(assign.left) && isIdentifier(assign.right)
            && assign.left.name === assign.right.name;
    }

    /** 分支体只含 `name = value;` 时返回 value。 */
    private nullishAssignment(branch: TYPE.Node, name: string): TYPE.Expression | null {
        const body = isBlockStatement(branch) ? branch.body : [branch as TYPE.Statement];
        if (body.length !== 1) return null;
        const stmt = body[0];
        if (!isExpressionStatement(stmt) || !isAssignmentExpression(stmt.expression)) return null;
        const assign = stmt.expression;
        if (assign.operator !== "=" || !isIdentifier(assign.left) || assign.left.name !== name) return null;
        return assign.right;
    }

    /**
     * 识别 nullish 判断:返回被判断的变量名,以及“test 为真时是 nullish 分支”。
     *   X == null / X === null || X === undefined          → true
     *   X != null / X !== null && X !== undefined          → false
     */
    private nullishTarget(test: TYPE.Expression): { target: TYPE.Expression; truthyIsNullish: boolean } | null {
        if (isBinaryExpression(test) && (test.operator === "==" || test.operator === "!=")) {
            if (!isNullLiteral(test.right)) return null;
            return { target: test.left as TYPE.Expression, truthyIsNullish: test.operator === "==" };
        }
        if (isBinaryExpression(test) && (test.operator === "==" || test.operator === "!=") && isNullLiteral(test.left)) {
            return { target: test.right as TYPE.Expression, truthyIsNullish: test.operator === "==" };
        }
        if (isLogicalExpression(test) && (test.operator === "||" || test.operator === "&&")) {
            const isOr = test.operator === "||";
            const left = test.left as TYPE.Expression;
            const right = test.right as TYPE.Expression;
            const leftTarget = isOr ? this.strictCheck(left, "===", "null") : this.strictCheck(left, "!==", "null");
            const rightTarget = isOr
                ? this.strictCheck(right, "===", "undefined")
                : this.strictCheck(right, "!==", "undefined");
            if (!leftTarget || !rightTarget || !isNodeEqual(leftTarget, rightTarget)) return null;
            return { target: leftTarget, truthyIsNullish: isOr };
        }
        return null;
    }

    private strictCheck(node: TYPE.Node, operator: string, kind: "null" | "undefined"): TYPE.Expression | null {
        if (!isBinaryExpression(node) || node.operator !== operator) return null;
        const matched = kind === "null" ? isNullLiteral(node.right) : isIdentifier(node.right, { name: "undefined" });
        return matched ? node.left as TYPE.Expression : null;
    }

    private foldSwitch(path: any): boolean {
        const switchNode = path.node as TYPE.SwitchStatement;
        const nullCase = switchNode.cases.find((c) => isNullLiteral(c.test));
        const undefinedCase = switchNode.cases.find((c) => isIdentifier(c.test, { name: "undefined" }));
        if (!nullCase || !undefinedCase || nullCase === undefinedCase) return false;
        const defaultCase = switchNode.cases.find((c) => c.test === null) ?? null;
        // 只处理 null/undefined(可选 default)三种 case;带其它 case 的是源码 switch
        const extraCases = switchNode.cases.filter(
            (c) => c !== nullCase && c !== undefinedCase && c !== defaultCase);
        if (extraCases.length > 0) return false;

        // 两个 nullish case 的落点:返回 { target, value } / undefined(空 case) / null(不是可折形态)。
        // 两个 case 都赋值时右值必须相同;只有一个赋值时依赖 fallthrough,
        // 有值的 case 必须排在最后(nullish 对只在 null/undefined 上命中,顺序不影响)。
        const pair = this.caseAssignedPair(nullCase, undefinedCase);
        if (!pair) return false;
        const target = pair.target;
        if (defaultCase) {
            // `switch (X) { case null: case undefined: T = undefined; break; default: T = E }`
            // 是 `X?.…` 的 lowering,不是 `??`:nullish 时取 undefined,其余取 E。
            if (!isIdentifier(pair.value, { name: "undefined" })) return false;
            return this.foldNullishDefault(path, switchNode, defaultCase, target);
        }
        return this.foldNullishPair(path, switchNode, pair, nullCase, undefinedCase);
    }

    /**
     * `X = D; switch (D) { case null: case undefined: X = E; break }` → `X = D ?? E`。
     *
     * 判别式是 target 自身时也可以没有紧邻的 `X = D`(值早就在 X 里,
     * zhihu DefaultCreationPublishRepository 的 `v1 = v1 ?? v2`):此时输出
     * `X = X ?? E`,不删前一条语句。
     */
    private foldNullishPair(
        path: any,
        switchNode: TYPE.SwitchStatement,
        pair: AssignedPair,
        nullCase: TYPE.SwitchCase,
        undefinedCase: TYPE.SwitchCase,
    ): boolean {
        const target = pair.target;
        const fallback = pair.value;
        // 只有一个 case 赋值时依赖 fallthrough:有值的 case 必须排在后面,
        // 否则判别式为较早 case 的值时不会执行赋值(例如 null 有值、undefined 为空)。
        if (pair.nullValue === undefined || pair.undefinedValue === undefined) {
            const bodyCase = pair.nullValue !== undefined ? nullCase : undefinedCase;
            if (switchNode.cases[switchNode.cases.length - 1] !== bodyCase) return false;
        }
        const discriminant = switchNode.discriminant;
        const resolved = this.resolvePairValue(path, target, discriminant);
        if (!resolved) return false;

        path.replaceWith(expressionStatement(
            assignmentExpression("=", identifier(target), logicalExpression("??", resolved.value, fallback)),
        ));
        if (resolved.remove) resolved.remove.remove();
        return true;
    }

    /**
     * 找到 `target` 里与判别式同值的那份表达式:
     *  - 判别式就是 target 本身 → `X = X ?? E`;
     *  - 紧邻的 `X = D`(D 与判别式相同)→ `X = D ?? E` 并删掉那条赋值;
     *  - `X = D` 与 switch 之间只隔着与 X 无关的语句时,同样折叠并删掉赋值;
     *  - 中间读过 X(但没写)→ 保留赋值,输出 `X = X ?? E`。
     */
    private resolvePairValue(
        path: any,
        target: string,
        discriminant: TYPE.Expression,
    ): { value: TYPE.Expression; remove: any | null } | null {
        const prev = path.getPrevSibling();
        const prevAssign = prev && isExpressionStatement(prev.node) && isAssignmentExpression(prev.node.expression)
            ? prev.node.expression
            : null;
        if (prevAssign && prevAssign.operator === "=" && isIdentifier(prevAssign.left, { name: target })) {
            if (isIdentifier(discriminant, { name: target })) return { value: prevAssign.right, remove: prev };
            if (isNodeEqual(discriminant, prevAssign.right) && isPureExpression(discriminant)) {
                return { value: discriminant, remove: prev };
            }
        }
        if (isIdentifier(discriminant, { name: target })) return { value: identifier(target), remove: null };
        // 非相邻:往前找给 target 赋同一个值的语句,中间不能读/写 target
        let cursor = prev;
        for (let steps = 0; cursor && cursor.node && steps < 8; steps++, cursor = cursor.getPrevSibling()) {
            const node = cursor.node;
            if (!isStatement(node)) return null;
            if (collectAssignedNames(node).has(target)) {
                if (!isExpressionStatement(node) || !isAssignmentExpression(node.expression)) return null;
                const assign = node.expression;
                if (assign.operator !== "=" || !isIdentifier(assign.left, { name: target })) return null;
                if (!isNodeEqual(assign.right, discriminant)) return null;
                if (!isPureExpression(discriminant)) return null;
                return { value: discriminant, remove: cursor };
            }
            if (collectReadNames(node).has(target)) return null;
        }
        return null;
    }

    /**
     * `switch (X) { case null: case undefined: T = undefined; break; default: T = E }`
     * → `T = X == null ? undefined : E`;E 的链根就是 X 时进一步还原成可选链
     * (`session?.getState().status`)。
     */
    private foldNullishDefault(
        path: any,
        switchNode: TYPE.SwitchStatement,
        defaultCase: TYPE.SwitchCase,
        target: string,
    ): boolean {
        const body = defaultCase.consequent;
        if (body.length === 0) return false;
        const last = body[body.length - 1];
        const statements = isBreakStatement(last) ? body.slice(0, -1) : body.slice();
        const value = this.assignedValueOf(statements, target);
        if (value === null || isIdentifier(value, { name: "undefined" })) return false;
        const discriminant = switchNode.discriminant;
        const nullishTest = binaryExpression("==", discriminant as TYPE.Expression, nullLiteral());
        const optional = makeGuardedOptionalChain(value, discriminant as TYPE.Expression);
        if (optional) {
            path.replaceWith(expressionStatement(assignmentExpression("=", identifier(target), optional)));
            return true;
        }
        path.replaceWith(expressionStatement(assignmentExpression(
            "=",
            identifier(target),
            conditionalExpression(nullishTest, identifier("undefined"), value),
        )));
        return true;
    }

    /**
     * 读取两个 nullish case 的落点。
     * 返回 null 表示形态不符;`value` 是两个 case 共同的赋值右值。
     */
    private caseAssignedPair(nullCase: TYPE.SwitchCase, undefinedCase: TYPE.SwitchCase): AssignedPair | null {
        const nullBody = this.caseBodyShape(nullCase);
        if (nullBody === null) return null;
        const undefinedBody = this.caseBodyShape(undefinedCase);
        if (undefinedBody === null) return null;
        const nullAssign = nullBody;
        const undefinedAssign = undefinedBody;
        // 两边都没赋值、或赋值目标不同:不是 `X ?? D`
        if (nullAssign === undefined && undefinedAssign === undefined) return null;
        const first = nullAssign ?? undefinedAssign!;
        if (undefinedAssign !== undefined && nullAssign !== undefined
            && !isNodeEqual(nullAssign.value, undefinedAssign.value)) return null;
        if (nullAssign !== undefined && undefinedAssign !== undefined
            && (nullAssign.target !== undefinedAssign.target)) return null;
        return {
            target: first.target,
            value: first.value,
            nullValue: nullAssign ? nullAssign.value : undefined,
            undefinedValue: undefinedAssign ? undefinedAssign.value : undefined,
        };
    }

    /**
     * 读取单个 case 体:`[E;] target = value; [break;]`,E 与 value 完全相同
     * (编译器把同一个值先物化到 acc 再赋值,复制传播后变成两句)。
     * 空 case(靠 fallthrough)返回 undefined;形态不符返回 null。
     */
    private caseBodyShape(caseNode: TYPE.SwitchCase): { target: string; value: TYPE.Expression } | null | undefined {
        const body = caseNode.consequent;
        if (body.length === 0) return undefined;
        const last = body[body.length - 1];
        const statements = isBreakStatement(last) ? body.slice(0, -1) : body.slice();
        if (statements.length === 0) return undefined;
        const assignment = statements[statements.length - 1];
        if (!isExpressionStatement(assignment) || !isAssignmentExpression(assignment.expression)) return null;
        const assign = assignment.expression;
        if (assign.operator !== "=" || !isIdentifier(assign.left)) return null;
        // 赋值之前只允许重复求值的同一个表达式(丢弃它不会改变求值次数)
        for (let i = 0; i < statements.length - 1; i++) {
            const extra = statements[i];
            if (!isExpressionStatement(extra) || !isNodeEqual(extra.expression, assign.right)) return null;
        }
        return { target: assign.left.name, value: assign.right };
    }

    /** 读 case 体里唯一的一条 `target = value`(前面允许重复表达式),不含 break */
    private assignedValueOf(statements: TYPE.Statement[], target: string): TYPE.Expression | null {
        if (statements.length === 0) return null;
        const assignment = statements[statements.length - 1];
        if (!isExpressionStatement(assignment) || !isAssignmentExpression(assignment.expression)) return null;
        const assign = assignment.expression;
        if (assign.operator !== "=" || !isIdentifier(assign.left) || assign.left.name !== target) return null;
        for (let i = 0; i < statements.length - 1; i++) {
            const extra = statements[i];
            if (!isExpressionStatement(extra) || !isNodeEqual(extra.expression, assign.right)) return null;
        }
        return assign.right;
    }
}

/** 一个 nullish 分支的赋值信息 */
interface AssignedPair {
    target: string;
    value: TYPE.Expression;
    /** 空 case 时为 undefined */
    nullValue: TYPE.Expression | undefined;
    undefinedValue: TYPE.Expression | undefined;
}

/**
 * `X == null ? undefined : E` 里 E 的链根就是 X 时还原成可选链:
 * `X.a().b` → `X?.a().b`。守卫只在 switch 判别式里求值一次,这里不引入新的求值。
 */
function makeGuardedOptionalChain(chain: TYPE.Expression, guard: TYPE.Expression): TYPE.Expression | null {
    if (isNodeEqual(chain, guard)) return null;
    // 链里已经有 `?.` 时(如 `obj.find(f)?.name`)只把链根补成可选,外层链接
    // 保持原 optional 标志,整条仍是同一个可选链。
    if (TYPE.isOptionalMemberExpression(chain)) {
        const inner = makeGuardedOptionalChain(chain.object as TYPE.Expression, guard);
        if (!inner) return null;
        return TYPE.optionalMemberExpression(inner as any, chain.property as any, chain.computed, chain.optional);
    }
    if (TYPE.isOptionalCallExpression(chain)) {
        const inner = makeGuardedOptionalChain(chain.callee as TYPE.Expression, guard);
        if (!inner) return null;
        return TYPE.optionalCallExpression(inner as any, chain.arguments as any, chain.optional);
    }
    if (TYPE.isMemberExpression(chain)) {
        if (isNodeEqual(chain.object, guard)) {
            return TYPE.optionalMemberExpression(chain.object as any, chain.property as any, chain.computed, true);
        }
        const inner = makeGuardedOptionalChain(chain.object as TYPE.Expression, guard);
        if (!inner) return null;
        return TYPE.optionalMemberExpression(inner as any, chain.property as any, chain.computed, false);
    }
    if (TYPE.isCallExpression(chain)) {
        if (isNodeEqual(chain.callee, guard)) {
            return TYPE.optionalCallExpression(chain.callee as any, chain.arguments as any, true);
        }
        const inner = makeGuardedOptionalChain(chain.callee as TYPE.Expression, guard);
        if (!inner) return null;
        return TYPE.optionalCallExpression(inner as any, chain.arguments as any, false);
    }
    return null;
}
