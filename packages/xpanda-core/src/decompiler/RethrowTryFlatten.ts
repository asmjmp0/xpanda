import * as TYPE from "@babel/types";
import { VISITOR_KEYS } from "@babel/types";

/**
 * 合并嵌套的 rethrow try 壳(模块级 class 定义的词法环境保护)。
 *
 * ArkTS 给每个模块级 class 定义生成一个保护壳:
 *
 *   panda_jmp0_reserved_lex_begin; let local_1_0;
 *   try { …defineclasswithbuffer…; … } catch (e) { poplexenv; throw e }
 *
 * catch 只是重抛,等价于没有 catch;但 handler 不能丢(去掉 try 区域后 class
 * 表达式链会和后面的 stmodulevar 分开,模块变量取到未赋值的 acc)。结构化归约
 * 会把后续语句并进 try 体,这些壳于是层层嵌套——每个 class 一层。语句本身不会
 * 被复制,但每层给后面所有行增加 2 个空格缩进:issue7 的 liverevlink-impl 有
 * 80 层壳,行首空白占了 raw 输出(50MB)的 71.8%,合并后只剩 ~14MB。
 *
 * 内层壳的 catch 与外层等价,把它的块内语句并进外层块即可把嵌套层数归零。
 * 语句顺序不变;只有块级声明的作用域从内层块扩大到外层块,因此要求:
 *   - 内层 try 是外层块的最后一条语句(后面没有别的语句会看到声明);
 *   - 外层块前面的语句既不重复声明这些名字,也不引用它们(否则遮蔽 / TDZ 语义会变)。
 * 名字冲突时保留原样,继续尝试更内层(内层通常声明的是各自的 lexenv 槽)。
 */
export function flattenRethrowTryChains(program: TYPE.Program): void {
    visit(program);
}

function visit(node: TYPE.Node): void {
    if (!node || typeof (node as TYPE.Node).type !== "string") return;
    if (TYPE.isTryStatement(node) && !node.finalizer && isRethrowCatch(node.handler)) {
        mergeTrailingRethrowTries(node);
    }
    const keys = VISITOR_KEYS[node.type] as string[] | undefined;
    if (!keys) return;
    for (const key of keys) {
        const value = (node as any)[key];
        if (Array.isArray(value)) {
            for (const child of value) if (child && typeof child.type === "string") visit(child);
        } else if (value && typeof value.type === "string") {
            visit(value);
        }
    }
}

/** `catch (e) { throw e }` 或 `catch (e) { acc = e; throw acc }`(TryCatchPandaStatement 的搬运前缀) */
function isRethrowCatch(handler: TYPE.CatchClause | null | undefined): boolean {
    if (!handler || !TYPE.isIdentifier(handler.param)) return false;
    const statements = handler.body.body;
    if (statements.length === 0 || statements.length > 2) return false;
    const throwStatement = statements[statements.length - 1];
    if (!TYPE.isThrowStatement(throwStatement) || !TYPE.isIdentifier(throwStatement.argument)) return false;
    const thrown = throwStatement.argument.name;
    if (statements.length === 1) return thrown === handler.param.name;
    const prologue = statements[0];
    if (!TYPE.isExpressionStatement(prologue) || !TYPE.isAssignmentExpression(prologue.expression)) return false;
    const assignment = prologue.expression;
    return assignment.operator === "="
        && TYPE.isIdentifier(assignment.left) && assignment.left.name === "acc"
        && TYPE.isIdentifier(assignment.right) && assignment.right.name === handler.param.name
        && thrown === "acc";
}

function mergeTrailingRethrowTries(tryNode: TYPE.TryStatement): void {
    const statements = tryNode.block.body;
    while (statements.length > 0) {
        const last = statements[statements.length - 1];
        if (!TYPE.isTryStatement(last) || last.finalizer || !isRethrowCatch(last.handler)) return;
        if (!canSplice(statements, last)) return;
        statements.splice(statements.length - 1, 1, ...last.block.body);
    }
}

function canSplice(outerStatements: TYPE.Statement[], innerTry: TYPE.TryStatement): boolean {
    const declared = collectBlockScopedNames(innerTry.block.body);
    if (declared.size === 0) return true;
    for (let i = 0; i < outerStatements.length - 1; i++) {
        const statement = outerStatements[i];
        const outerDeclared = collectBlockScopedNames([statement]);
        for (const name of declared) {
            if (outerDeclared.has(name)) return false;
        }
        if (referencesAnyName(statement, declared)) return false;
    }
    return true;
}

function collectBlockScopedNames(statements: TYPE.Statement[]): Set<string> {
    const names = new Set<string>();
    for (const statement of statements) {
        if (TYPE.isVariableDeclaration(statement) && statement.kind !== "var") {
            for (const declarator of statement.declarations) {
                if (TYPE.isIdentifier(declarator.id)) names.add(declarator.id.name);
            }
        } else if ((TYPE.isClassDeclaration(statement) || TYPE.isFunctionDeclaration(statement))
            && statement.id && TYPE.isIdentifier(statement.id)) {
            names.add(statement.id.name);
        }
    }
    return names;
}

function referencesAnyName(node: TYPE.Node, names: Set<string>): boolean {
    if (!node || typeof (node as TYPE.Node).type !== "string") return false;
    if (TYPE.isIdentifier(node) && names.has(node.name)) return true;
    const keys = VISITOR_KEYS[node.type] as string[] | undefined;
    if (!keys) return false;
    for (const key of keys) {
        const value = (node as any)[key];
        if (Array.isArray(value)) {
            for (const child of value) if (child && typeof child.type === "string" && referencesAnyName(child, names)) return true;
        } else if (value && typeof value.type === "string" && referencesAnyName(value, names)) {
            return true;
        }
    }
    return false;
}
