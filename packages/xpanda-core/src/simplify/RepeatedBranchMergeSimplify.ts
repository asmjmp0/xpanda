import * as TYPE from "@babel/types";
import { ISimplify } from "./ISimplify";

const {
    VISITOR_KEYS,
    blockStatement,
    isBlockStatement,
    isClassDeclaration,
    isFunctionDeclaration,
    isIfStatement,
    isNodesEquivalent,
    isProgram,
    isReturnStatement,
    isThrowStatement,
    isUnaryExpression,
    isVariableDeclaration,
    logicalExpression,
    unaryExpression,
} = TYPE;

/**
 * Merge branches that execute the same statement sequence.
 *
 * Runs once as the last step of the simplify pipeline (not part of the
 * fixed-point iteration), after condition folding has normalized the AST.
 *
 * Structured reduction has no goto: when two conditions share one continuation,
 * the continuation is emitted once per predecessor. The ArkTS lowering of
 *
 *   if ((b & 0x80) || (noAssert && typeof b === "undefined")) { NEXT } else { TAIL }
 *
 * is the worst case: every nested read level tests its high bit and its
 * `noAssert && undefined` guard separately, both jumping to the same NEXT block.
 * ByteBuffer.readVarint64 in `bilibili_open.abc` is 64 basic blocks in the abc,
 * but region reduction unfolds it into 512 copies of the finish tail (8.7k
 * output lines from a ~100 line source method).
 *
 * This pass must run after simplify, not in the pre-simplify post-pass:
 * before simplify the duplicated copies still differ in accumulator
 * materialization (`acc = ...`, `vN = acc` register plumbing), so they are not
 * structurally identical and cannot be merged safely. Once simplify has
 * normalized those chains, two local rewrites recover the source shape:
 *
 *   1. `if (C) { S } else if (D) { S }` -> `if (C || D) { S }`
 *      (`else { if (D) { S } else { T } }` -> `if (C || D) { S } else { T }`)
 *
 *   2. `if (C) { if (D) { S } else { T } } S'` where S' === S
 *      -> `if (!C || D) { S } else { T }`
 *
 * Both preserve evaluation order: C is evaluated first, D only when C is true
 * (`!C || D` keeps the same short-circuit), and S/T only run after the tests.
 * A duplicated block S is required to always leave the structure (return or
 * throw), otherwise control would fall through to the copy that is removed.
 *
 * The pass is deliberately limited to large duplicated bodies: small identical
 * branches are usually source-level duplication and are not worth reshaping.
 * Bodies smaller than MIN_DUPLICATE_NODES are left untouched.
 *
 * @Author: jmp0
 */
export class RepeatedBranchMergeSimplify implements ISimplify {
    /** Structural size below which a duplicated branch is not worth merging. */
    private static readonly MIN_DUPLICATE_NODES = 50;
    /** Defensive bound: every round removes at least one duplicate. */
    private static readonly MAX_ROUNDS = 16;

    private sizes: WeakMap<TYPE.Node, number> = new WeakMap();

    simplify(node: TYPE.Program): boolean {
        let changed = false;
        for (let round = 0; round < RepeatedBranchMergeSimplify.MAX_ROUNDS; round++) {
            this.sizes = new WeakMap();
            if (!this.processNode(node)) break;
            changed = true;
        }
        return changed;
    }

    /**
     * Traverse bottom-up. Children are normalized before their containing
     * statement list is inspected, so equal copies stay equal after their own
     * inner duplicates have been merged.
     */
    private processNode(node: TYPE.Node): boolean {
        if (!node || typeof (node as TYPE.Node).type !== "string") return false;
        let changed = false;
        const keys = VISITOR_KEYS[node.type] as string[] | undefined;
        if (!keys) return false;
        for (const key of keys) {
            const value = (node as any)[key];
            if (Array.isArray(value)) {
                for (const child of value) {
                    if (child && typeof child.type === "string" && this.processNode(child)) changed = true;
                }
            } else if (value && typeof value.type === "string" && this.processNode(value)) {
                changed = true;
            }
        }
        if (isProgram(node) || isBlockStatement(node)) {
            if (this.processList(node.body as TYPE.Statement[])) changed = true;
        }
        return changed;
    }

    /** Apply both rewrites to one statement list until it stops changing. */
    private processList(list: TYPE.Statement[]): boolean {
        let changed = false;
        for (let pass = 0; pass < 8; pass++) {
            let local = false;
            for (let i = 0; i < list.length; i++) {
                if (this.mergeElseIfChain(list[i])) local = true;
            }
            for (let i = 0; i < list.length; i++) {
                if (this.mergeDuplicatedContinuation(list, i)) local = true;
            }
            if (!local) break;
            changed = true;
        }
        return changed;
    }

    /**
     * `if (C) S else if (D) S` (and the block-wrapped `else { if (D) S else T }`)
     * -> `if (C || D) S [else T]`. The bodies must be structurally identical.
     */
    private mergeElseIfChain(statement: TYPE.Statement): boolean {
        if (!isIfStatement(statement) || !statement.alternate) return false;
        let inner: TYPE.IfStatement;
        if (isIfStatement(statement.alternate)) {
            inner = statement.alternate;
        } else if (isBlockStatement(statement.alternate) && statement.alternate.body.length === 1 && isIfStatement(statement.alternate.body[0])) {
            inner = statement.alternate.body[0];
        } else {
            return false;
        }
        const thenBody = this.statementsOf(statement.consequent);
        const elseBody = this.statementsOf(inner.consequent);
        if (thenBody.length === 0 || thenBody.length !== elseBody.length) return false;
        if (this.listSize(thenBody) < RepeatedBranchMergeSimplify.MIN_DUPLICATE_NODES) return false;
        // Only merge terminating copies: a shared continuation produced by region
        // reduction always leaves the structure. Two non-terminating source branches
        // that happen to be identical are left alone (they execute their own copy
        // and then fall through; merging them would be source-shape churn).
        if (!this.listAlwaysExits(thenBody)) return false;
        if (!isNodesEquivalent(statement.consequent, inner.consequent)) return false;
        statement.test = logicalExpression("||", statement.test, inner.test);
        statement.alternate = inner.alternate;
        this.sizes.delete(statement);
        return true;
    }

    /**
     * `if (C) { if (D) { S } T } S'` (S === S', S and T always leave)
     * -> `if (!C || D) { S } else { T }`.
     *
     * When C is false the original falls through to S'; when C is true and D is
     * false it runs T. Both S and T terminate the surrounding structure, so the
     * copy S' after the `if` is exactly the successor of the C-true path and can
     * be folded into the condition.
     */
    private mergeDuplicatedContinuation(list: TYPE.Statement[], index: number): boolean {
        const statement = list[index];
        if (!isIfStatement(statement) || statement.alternate || !isBlockStatement(statement.consequent)) return false;
        const body = statement.consequent.body;
        if (body.length < 2 || !isIfStatement(body[0])) return false;
        const inner = body[0];
        if (inner.alternate) return false;
        const duplicated = this.statementsOf(inner.consequent);
        if (duplicated.length === 0) return false;
        if (this.listSize(duplicated) < RepeatedBranchMergeSimplify.MIN_DUPLICATE_NODES) return false;
        if (!this.listAlwaysExits(duplicated)) return false;
        const tail = body.slice(1);
        if (tail.length === 0 || !this.listAlwaysExits(tail)) return false;
        if (this.hasTopLevelDeclarations(duplicated) || this.hasTopLevelDeclarations(tail)) return false;
        if (list.length - index - 1 < duplicated.length) return false;
        for (let i = 0; i < duplicated.length; i++) {
            if (!isNodesEquivalent(list[index + 1 + i], duplicated[i])) return false;
        }
        statement.test = logicalExpression("||", this.negateTest(statement.test), inner.test);
        statement.consequent = blockStatement(duplicated);
        statement.alternate = blockStatement(tail);
        list.splice(index + 1, duplicated.length);
        this.sizes.delete(statement);
        return true;
    }

    /** Invert a test used in an if; `!!A` is just `A` in boolean position. */
    private negateTest(test: TYPE.Expression): TYPE.Expression {
        if (isUnaryExpression(test) && test.operator === "!") return test.argument as TYPE.Expression;
        return unaryExpression("!", test);
    }

    private statementsOf(node: TYPE.Statement): TYPE.Statement[] {
        return isBlockStatement(node) ? node.body : [node];
    }

    /** All paths through the list leave the enclosing structure. */
    private listAlwaysExits(statements: TYPE.Statement[]): boolean {
        return statements.length > 0 && this.statementAlwaysExits(statements[statements.length - 1]);
    }

    private statementAlwaysExits(statement: TYPE.Statement): boolean {
        if (isReturnStatement(statement) || isThrowStatement(statement)) return true;
        if (isBlockStatement(statement)) return this.listAlwaysExits(statement.body);
        if (isIfStatement(statement)) {
            return !!statement.alternate
                && this.statementAlwaysExits(statement.consequent)
                && this.statementAlwaysExits(statement.alternate);
        }
        return false;
    }

    private hasTopLevelDeclarations(statements: TYPE.Statement[]): boolean {
        return statements.some((statement) => (isVariableDeclaration(statement) && statement.kind !== "var")
            || isClassDeclaration(statement) || isFunctionDeclaration(statement));
    }

    private listSize(statements: TYPE.Statement[]): number {
        let size = 0;
        for (const statement of statements) size += this.sizeOf(statement);
        return size;
    }

    private sizeOf(node: TYPE.Node | null | undefined): number {
        if (!node || typeof (node as TYPE.Node).type !== "string") return 0;
        const cached = this.sizes.get(node);
        if (cached !== undefined) return cached;
        let size = 1;
        const keys = VISITOR_KEYS[node.type] as string[] | undefined;
        if (keys) {
            for (const key of keys) {
                const value = (node as any)[key];
                if (Array.isArray(value)) {
                    for (const child of value) size += this.sizeOf(child);
                } else if (value && typeof value.type === "string") {
                    size += this.sizeOf(value);
                }
            }
        }
        this.sizes.set(node, size);
        return size;
    }
}
