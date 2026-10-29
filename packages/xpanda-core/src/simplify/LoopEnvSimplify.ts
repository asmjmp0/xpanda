import * as TYPE from "@babel/types";
import traverse, { NodePath } from "@babel/traverse";
import { ISimplify } from "./ISimplify";
import { isPureExpression, walkNode } from "./AstUtils";

const {
    file,
    identifier,
    isAssignmentExpression,
    isBlockStatement,
    isExpressionStatement,
    isIdentifier,
    isMemberExpression,
    isObjectProperty,
    isReferenced,
    isUpdateExpression,
    isVariableDeclarator,
    variableDeclaration,
    variableDeclarator,
} = TYPE;

/**
 * Restore per-iteration lexical environment bindings.
 *
 * ArkTS lowers a loop-body scope whose captured variables survive across
 * iterations into one environment created before the loop plus a *rotation* at
 * the loop latch:
 *
 *   newlexenv N; ...             // first iteration's bindings
 *   loop:
 *     ...
 *     ldlexvar 0,0 ... 0,N-1     // copy every slot into registers
 *     poplexenv
 *     newlexenv N                // next iteration's bindings
 *     stlexvar 0,0 ... 0,N-1
 *     jmp loop
 *
 * Lexical analysis names the second environment as a new instance
 * (`local_3_2_0 = local_3_0`, ...). In the emitted JavaScript that is
 * semantically wrong: the loop body still refers to the first environment's
 * bindings, so closures created in every iteration observe the last
 * iteration's values and a loop-carried variable updated in the rotated
 * environment never affects the loop test.
 *
 * The correct shape relies on JavaScript's own per-iteration bindings:
 *
 *   let i;                       let i = 0;
 *   for (i = 0; ...)      ->     for (let i = 0; ...; i++) { ... }
 *   { ...; let r = i; i++; }
 *
 * The rotation declaration is removed, references to the rotated environment
 * are renamed to the original environment, and the environment declaration is
 * moved into the loop scope (the `for` init for variables used by the
 * loop head, otherwise the top of the loop body).
 *
 * Only the exact copy shape produced by the compiler is handled; anything
 * ambiguous is left untouched.
 *
 * @Author: jmp0
 */
export class LoopEnvSimplify implements ISimplify {
    simplify(node: TYPE.Program): boolean {
        const loops: NodePath<TYPE.ForStatement | TYPE.WhileStatement | TYPE.DoWhileStatement>[] = [];
        traverse(file(node), {
            ForStatement: (path) => { loops.push(path); },
            WhileStatement: (path) => { loops.push(path); },
            DoWhileStatement: (path) => { loops.push(path); },
        });
        if (loops.length === 0) return false;
        // Innermost first: an outer loop rewrite reuses the same body/test nodes,
        // so the already-collected inner paths stay valid.
        loops.sort((a, b) => loopDepth(b) - loopDepth(a));
        let changed = false;
        for (const loop of loops) {
            const body = loop.get("body");
            if (!isBlockStatement(body.node)) continue;
            const rotation = findRotation(body as NodePath<TYPE.BlockStatement>);
            if (!rotation) continue;
            if (applyRotation(loop, body as NodePath<TYPE.BlockStatement>, rotation)) changed = true;
        }
        return changed;
    }
}

interface Pair {
    readonly rotated: string;
    readonly base: string;
}

interface Rotation {
    readonly paths: NodePath<TYPE.VariableDeclaration>[];
    readonly pairs: Pair[];
}

interface EnvSlot {
    readonly prefix: string;
    readonly kind: string;
    readonly depth: number;
    readonly instance: number;
    readonly index: number;
}

/** `local_<depth>[_<instance>]_<slot>` / `sendable_<depth>[_<instance>]_<slot>`. */
function parseEnvSlot(name: string): EnvSlot | null {
    const match = /^(local|sendable)_(\d+)(?:_(\d+))?_(\d+)$/.exec(name);
    if (!match) return null;
    return {
        prefix: name.slice(0, name.lastIndexOf("_")),
        kind: match[1]!,
        depth: Number(match[2]),
        instance: match[3] === undefined ? 1 : Number(match[3]),
        index: Number(match[4]),
    };
}

/**
 * `let local_3_2_0 = local_3_0, local_3_2_1 = local_3_1` — a full copy of one
 * environment into a later instance of the same depth.
 */
function matchRotation(declaration: TYPE.VariableDeclaration): Pair[] | null {
    if (declaration.kind !== "let" || declaration.declarations.length === 0) return null;
    const pairs: Pair[] = [];
    const slots = new Set<number>();
    let rotatedPrefix: string | null = null;
    let basePrefix: string | null = null;
    for (const declarator of declaration.declarations) {
        if (!isIdentifier(declarator.id) || !declarator.init || !isIdentifier(declarator.init)) return null;
        const rotated = parseEnvSlot(declarator.id.name);
        const base = parseEnvSlot(declarator.init.name);
        if (!rotated || !base) return null;
        if (rotated.index !== base.index || slots.has(rotated.index)) return null;
        if (rotated.kind !== base.kind || rotated.depth !== base.depth) return null;
        if (rotated.prefix === base.prefix || rotated.instance <= base.instance) return null;
        if (rotatedPrefix === null) {
            rotatedPrefix = rotated.prefix;
            basePrefix = base.prefix;
        } else if (rotated.prefix !== rotatedPrefix || base.prefix !== basePrefix) {
            return null;
        }
        slots.add(rotated.index);
        pairs.push({ rotated: declarator.id.name, base: declarator.init.name });
    }
    if (rotatedPrefix === null || basePrefix === null) return null;
    return pairs;
}

/** The unique environment rotation inside a loop body (nested loops excluded). */
function findRotation(body: NodePath<TYPE.BlockStatement>): Rotation | null {
    const found: Rotation[] = [];
    const scanList = (listPath: NodePath<TYPE.BlockStatement>): void => {
        const statements = listPath.get("body") as NodePath<TYPE.Statement>[];
        let index = 0;
        while (index < statements.length) {
            const run = collectRotationRun(statements, index);
            if (run) {
                found.push({ paths: run.paths, pairs: run.pairs });
                index = run.end;
            } else {
                index += 1;
            }
        }
    };
    scanList(body);
    body.traverse({
        Function: (path) => path.skip(),
        ForStatement: (path) => path.skip(),
        WhileStatement: (path) => path.skip(),
        DoWhileStatement: (path) => path.skip(),
        ForInStatement: (path) => path.skip(),
        ForOfStatement: (path) => path.skip(),
        BlockStatement: (path) => { scanList(path as NodePath<TYPE.BlockStatement>); },
    });
    return found.length === 1 ? found[0]! : null;
}

interface RotationRun {
    readonly paths: NodePath<TYPE.VariableDeclaration>[];
    readonly pairs: Pair[];
    readonly end: number;
}

/** Consecutive `let local_3_2_i = local_3_i;` declarations starting at `start`. */
function collectRotationRun(statements: NodePath<TYPE.Statement>[], start: number): RotationRun | null {
    const firstPath = statements[start]!;
    if (!firstPath.isVariableDeclaration()) return null;
    const first = matchRotation(firstPath.node);
    if (!first) return null;
    const suffix = rotationInstanceSuffix(first);
    if (suffix === null) return null;
    const pairs = first.slice();
    const paths: NodePath<TYPE.VariableDeclaration>[] = [firstPath as NodePath<TYPE.VariableDeclaration>];
    const slots = new Set(first.map((pair) => parseEnvSlot(pair.rotated)!.index));
    let index = start + 1;
    while (index < statements.length) {
        const nextPath = statements[index]!;
        if (!nextPath.isVariableDeclaration()) break;
        const next = matchRotation(nextPath.node);
        if (!next || rotationInstanceSuffix(next) !== suffix) break;
        let accepted = true;
        for (const pair of next) {
            const slot = parseEnvSlot(pair.rotated)!.index;
            if (slots.has(slot)) accepted = false;
        }
        if (!accepted) break;
        for (const pair of next) slots.add(parseEnvSlot(pair.rotated)!.index);
        pairs.push(...next);
        paths.push(nextPath as NodePath<TYPE.VariableDeclaration>);
        index += 1;
    }
    return { paths, pairs, end: index };
}

/** The rotated/base prefix pair; a continued run must repeat exactly this pair. */
function rotationInstanceSuffix(pairs: Pair[]): string | null {
    const first = pairs[0];
    if (!first) return null;
    const rotated = parseEnvSlot(first.rotated);
    const base = parseEnvSlot(first.base);
    if (!rotated || !base) return null;
    return rotated.prefix + "|" + base.prefix;
}

function loopDepth(path: NodePath<TYPE.Node>): number {
    let depth = 0;
    let current: NodePath<TYPE.Node> | null = path;
    while (current.parentPath) {
        depth += 1;
        current = current.parentPath;
    }
    return depth;
}

/** The rotation must execute on the loop latch, after all user code of the iteration. */
function isLatchPosition(rotation: Rotation, body: NodePath<TYPE.BlockStatement>, baseNames: Set<string>): boolean {
    const last = rotation.paths[rotation.paths.length - 1];
    if (!last) return false;
    const list = last.parentPath;
    if (!list || !list.isBlockStatement()) return false;
    // The compiler may wrap the latch in one or more trailing try blocks (the
    // user try plus the loop's outer try). Each wrapper must be the last
    // statement of its parent block, and the chain must end at the loop body.
    let current: NodePath<TYPE.Node> | null = list;
    while (current && current.isBlockStatement() && current.node !== body.node) {
        const owner = current.parentPath;
        if (!owner || !owner.isTryStatement()) return false;
        const parent = owner.parentPath;
        if (!parent || !parent.isBlockStatement()) return false;
        const index = parent.node.body.indexOf(owner.node as any);
        if (index < 0 || index !== parent.node.body.length - 1) return false;
        current = parent;
    }
    if (!current || current.node !== body.node) return false;
    // Nothing after the rotation may still use the original environment: those
    // statements run with the rotated one (and are renamed with it).
    const statements = list.node.body;
    const index = statements.indexOf(last.node);
    if (index < 0) return false;
    for (let i = index + 1; i < statements.length; i++) {
        let usesBase = false;
        walkNode(statements[i], (item) => {
            if (isIdentifier(item) && baseNames.has(item.name)) {
                usesBase = true;
                return false;
            }
            return true;
        });
        if (usesBase) return false;
    }
    return true;
}

interface DeclaratorInfo {
    readonly declarator: NodePath<TYPE.VariableDeclarator>;
    readonly declaration: NodePath<TYPE.VariableDeclaration>;
}

/** Declarators of the given names in the loop's own function (nested functions excluded). */
function findDeclarators(
    functionPath: NodePath<TYPE.Node>,
    names: Set<string>,
): Map<string, DeclaratorInfo> | null {
    const found = new Map<string, DeclaratorInfo>();
    let duplicated = false;
    functionPath.traverse({
        Function: (path) => {
            if (path.node !== functionPath.node) path.skip();
        },
        VariableDeclarator: (path) => {
            if (!isIdentifier(path.node.id) || !names.has(path.node.id.name)) return;
            if (!path.parentPath.isVariableDeclaration()) return;
            if (found.has(path.node.id.name)) {
                duplicated = true;
                return;
            }
            found.set(path.node.id.name, {
                declarator: path as NodePath<TYPE.VariableDeclarator>,
                declaration: path.parentPath as NodePath<TYPE.VariableDeclaration>,
            });
        },
    });
    return duplicated ? null : found;
}

/** Names read or written by `node` (nested functions excluded, matching the optimizer's model). */
function readWriteNames(node: TYPE.Node | null | undefined): { reads: Set<string>; writes: Set<string> } {
    const reads = new Set<string>();
    const writes = new Set<string>();
    walkNode(node, (item, parent) => {
        if (!isIdentifier(item)) return true;
        if (!parent) {
            reads.add(item.name);
            return true;
        }
        if (isAssignmentExpression(parent) && parent.left === item) {
            writes.add(item.name);
            if (parent.operator !== "=") reads.add(item.name);
            return true;
        }
        if (isUpdateExpression(parent) && parent.argument === item) {
            writes.add(item.name);
            reads.add(item.name);
            return true;
        }
        if (isVariableDeclarator(parent) && parent.id === item) {
            writes.add(item.name);
            return true;
        }
        if (isMemberExpression(parent) && parent.property === item && !parent.computed) return true;
        if (isObjectProperty(parent) && parent.key === item && !parent.computed
            && !(parent as TYPE.ObjectProperty).shorthand) {
            return true;
        }
        if (isReferenced(item, parent)) reads.add(item.name);
        return true;
    });
    return { reads, writes };
}

interface OutsideUse {
    readonly node: TYPE.Identifier;
    readonly name: string;
    readonly write: boolean;
    readonly read: boolean;
}

function collectOutsideUses(
    functionNode: TYPE.Node,
    loopNode: TYPE.Node,
    names: Set<string>,
): OutsideUse[] {
    const uses: OutsideUse[] = [];
    walkNode(functionNode, (item, parent) => {
        if (item === loopNode) return false;
        if (item !== functionNode
            && (item.type === "FunctionDeclaration" || item.type === "FunctionExpression"
                || item.type === "ArrowFunctionExpression" || item.type === "ClassDeclaration"
                || item.type === "ClassExpression")) {
            return false;
        }
        if (!isIdentifier(item) || !names.has(item.name)) return true;
        if (!parent) return true;
        let read = false;
        let write = false;
        if (isAssignmentExpression(parent) && parent.left === item) {
            write = true;
            if (parent.operator !== "=") read = true;
        } else if (isUpdateExpression(parent) && parent.argument === item) {
            read = true;
            write = true;
        } else if (isVariableDeclarator(parent) && parent.id === item) {
            write = true;
        } else if (isMemberExpression(parent) && parent.property === item && !parent.computed) {
            return true;
        } else if (isObjectProperty(parent) && parent.key === item && !parent.computed
            && !(parent as TYPE.ObjectProperty).shorthand) {
            return true;
        } else if (isReferenced(item, parent)) {
            read = true;
        }
        if (!read && !write) return true;
        uses.push({ node: item, name: item.name, read, write });
        return true;
    });
    return uses;
}

function applyRotation(
    loop: NodePath<TYPE.ForStatement | TYPE.WhileStatement | TYPE.DoWhileStatement>,
    body: NodePath<TYPE.BlockStatement>,
    rotation: Rotation,
): boolean {
    const baseNames = new Set(rotation.pairs.map((pair) => pair.base));
    const rotatedNames = new Set(rotation.pairs.map((pair) => pair.rotated));
    if (baseNames.size !== rotation.pairs.length || rotatedNames.size !== rotation.pairs.length) return false;
    if (!isLatchPosition(rotation, body, baseNames)) return false;

    const functionPath = loop.getFunctionParent() ?? loop.findParent((path) => path.isProgram());
    if (!functionPath) return false;
    const declarators = findDeclarators(functionPath as NodePath<TYPE.Node>, baseNames);
    if (!declarators) return false;
    // A declaration removed by an earlier pass (it was scoped to a try block but
    // the binding is used by the loop) is recreated inside the loop scope, as
    // long as the name is not bound anywhere else.
    for (const name of baseNames) {
        if (!declarators.has(name) && loop.scope.hasBinding(name)) return false;
    }

    let allInsideLoop = true;
    let anyInsideLoop = false;
    for (const name of baseNames) {
        const info = declarators.get(name);
        if (!info) {
            allInsideLoop = false;
        } else if (info.declarator.isDescendant(body)) {
            anyInsideLoop = true;
        } else {
            allInsideLoop = false;
        }
    }
    // A mixed shape (some declarators inside the body, some outside) would
    // broaden the scope of the inside ones; leave it alone.
    if (anyInsideLoop && !allInsideLoop) return false;
    if (allInsideLoop) {
        // Already declared inside the loop body: only unify the names and drop
        // the rotation (which is a self-copy then).
        if (loop.isDoWhileStatement()) return false;
        for (const path of rotation.paths) path.remove();
        renameRotatedEnvironment(loop, rotation.pairs);
        return true;
    }

    // No read of the base environment may happen outside the loop (a read after
    // the loop would need the binding to stay in the enclosing scope).
    const outside = collectOutsideUses(functionPath.node, loop.node, baseNames)
        .filter((use) => {
            const info = declarators.get(use.name);
            return !info || use.node !== info.declarator.node.id;
        });
    if (outside.some((use) => use.read)) return false;
    if (loop.isForStatement() && outside.some((use) => use.write)) return false;


    // Determine which bindings belong to the loop head rather than the body.
    const headNames = new Set<string>();
    const collectHeadNames = (node: TYPE.Node | null | undefined): void => {
        walkNode(node, (item) => {
            if (isIdentifier(item) && baseNames.has(item.name)) headNames.add(item.name);
            return true;
        });
    };
    if (loop.isForStatement()) {
        collectHeadNames(loop.node.init);
        collectHeadNames(loop.node.test);
        collectHeadNames(loop.node.update);
    } else {
        collectHeadNames(loop.node.test);
    }
    // A declarator initializer or an outside `name = value` write means the
    // binding is initialized before the loop: it belongs to the loop head.
    for (const name of baseNames) {
        const info = declarators.get(name);
        if (info?.declarator.node.init) headNames.add(name);
    }
    if (!loop.isForStatement()) {
        for (const use of outside) if (use.write) headNames.add(use.name);
    }

    /** Head declarators in emission order (Set insertion order is stable). */
    const headDeclarators: TYPE.VariableDeclarator[] = [];
    let newInit: TYPE.VariableDeclaration | null = null;
    let convertWhileToFor = false;
    const consumedInitStatements: TYPE.Statement[] = [];

    if (loop.isForStatement()) {
        if (headNames.size > 0) {
            const init = loop.node.init;
            const assigned = new Map<string, TYPE.Expression | null>();
            if (init) {
                if (isAssignmentExpression(init) && init.operator === "=" && isIdentifier(init.left)
                    && headNames.has(init.left.name)) {
                    assigned.set(init.left.name, init.right);
                } else if (init.type === "VariableDeclaration") {
                    for (const declarator of init.declarations) {
                        if (isIdentifier(declarator.id) && headNames.has(declarator.id.name)) {
                            assigned.set(declarator.id.name, declarator.init ?? null);
                        }
                    }
                } else {
                    return false;
                }
            }
            for (const name of headNames) {
                const info = declarators.get(name);
                if (!info) return false;
                const base = info.declarator.node;
                let value: TYPE.Expression | null;
                if (assigned.has(name)) {
                    value = assigned.get(name)!;
                    // The declarator initializer is overwritten by the loop init;
                    // its side effects must not be lost.
                    if (base.init && !isPureExpression(base.init)) return false;
                } else {
                    value = base.init;
                    if (value && !isPureExpression(value)) return false;
                }
                const reads = readWriteNames(value).reads;
                for (const other of baseNames) if (reads.has(other)) return false;
                headDeclarators.push(variableDeclarator(identifier(name) as any, (value ?? null) as any));
            }
            if (init && init.type === "VariableDeclaration") {
                // Merge into the existing declaration (it may declare unrelated
                // temporaries that must stay in the loop init).
                const declared = new Set(init.declarations
                    .filter((declarator) => isIdentifier(declarator.id))
                    .map((declarator) => (declarator.id as TYPE.Identifier).name));
                for (const declarator of headDeclarators) {
                    if (!declared.has((declarator.id as TYPE.Identifier).name)) init.declarations.push(declarator);
                }
                newInit = init;
            } else {
                newInit = variableDeclaration("let", headDeclarators as any);
            }
        }
    } else if (loop.isWhileStatement() && headNames.size > 0) {
        convertWhileToFor = true;
        const loopList = loop.parentPath;
        if (!loopList || !(loopList.isBlockStatement() || loopList.isProgram())) return false;
        const siblings = loopList.node.body;
        const loopIndex = siblings.indexOf(loop.node as any);
        if (loopIndex < 0) return false;
        const initAssignments = new Map<string, { statement: TYPE.Statement; value: TYPE.Expression }>();
        for (const name of headNames) {
            const info = declarators.get(name);
            if (!info) return false;
            const declarationIndex = siblings.indexOf(info.declaration.node as any);
            if (declarationIndex < 0 || declarationIndex >= loopIndex) return false;
            let chosen: TYPE.Expression | null = null;
            for (let i = declarationIndex + 1; i < loopIndex; i++) {
                const statement = siblings[i]!;
                if (!isExpressionStatement(statement)) continue;
                const expression = statement.expression;
                if (!isAssignmentExpression(expression) || expression.operator !== "=") continue;
                if (!isIdentifier(expression.left) || expression.left.name !== name) continue;
                if (chosen !== null) return false;
                chosen = expression.right;
                initAssignments.set(name, { statement, value: expression.right });
            }
            const value = chosen ?? info.declarator.node.init;
            if (!value) return false;
            if (!isPureExpression(value)) return false;
            // The declarator initializer is overwritten by the loop init; its
            // side effects must not be lost.
            if (chosen !== null && info.declarator.node.init && !isPureExpression(info.declarator.node.init)) {
                return false;
            }
            const reads = readWriteNames(value).reads;
            for (const other of baseNames) if (reads.has(other)) return false;
            headDeclarators.push(variableDeclarator(identifier(name) as any, value as any));
        }
        // A write outside the loop that is not one of the consumed initializer
        // statements cannot be moved into the for init.
        for (const use of outside) {
            if (use.write && !initAssignments.has(use.name)) return false;
        }
        // Statements between the (earliest) declaration and the loop must not
        // observe the moved initializer or the binding itself.
        let earliest = loopIndex;
        for (const name of headNames) {
            earliest = Math.min(earliest, siblings.indexOf(declarators.get(name)!.declaration.node as any));
        }
        const consuming = new Set(Array.from(initAssignments.values()).map((entry) => entry.statement));
        const valueReads = new Set<string>();
        for (const declarator of headDeclarators) {
            if (!declarator.init) continue;
            for (const read of readWriteNames(declarator.init).reads) valueReads.add(read);
        }
        for (let i = earliest; i < loopIndex; i++) {
            const statement = siblings[i]!;
            if (consuming.has(statement)) continue;
            let baseDeclaration = false;
            for (const name of baseNames) {
                const info = declarators.get(name);
                if (info && info.declaration.node === statement) baseDeclaration = true;
            }
            if (baseDeclaration) continue;
            if (!isExpressionStatement(statement)) return false;
            const { reads, writes } = readWriteNames(statement);
            for (const name of baseNames) if (reads.has(name) || writes.has(name)) return false;
            for (const written of writes) if (valueReads.has(written)) return false;
        }
        for (const entry of initAssignments.values()) consumedInitStatements.push(entry.statement);
        newInit = variableDeclaration("let", headDeclarators as any);
    } else if (headNames.size > 0) {
        return false;
    }

    // Body bindings must not be initialized outside the loop; their declaration
    // only reserves the slot (the initializer is inside the body).
    const bodyDeclarators: TYPE.VariableDeclarator[] = [];
    for (const pair of rotation.pairs) {
        if (headNames.has(pair.base)) continue;
        const info = declarators.get(pair.base);
        if (info?.declarator.node.init) return false;
        bodyDeclarators.push(variableDeclarator(identifier(pair.base) as any, null));
    }

    // All checks passed; mutate.
    for (const path of rotation.paths) path.remove();
    renameRotatedEnvironment(loop, rotation.pairs);

    if (newInit && loop.isForStatement()) {
        loop.node.init = newInit;
    }

    // Move remaining declarators out of their declarations.
    for (const pair of rotation.pairs) {
        const info = declarators.get(pair.base);
        if (!info) continue;
        const declaration = info.declaration.node;
        declaration.declarations = declaration.declarations.filter((declarator) => declarator !== info.declarator.node);
        if (declaration.declarations.length === 0 && !info.declaration.removed) info.declaration.remove();
    }

    if (bodyDeclarators.length > 0) {
        body.node.body.unshift(variableDeclaration("let", bodyDeclarators as any));
    }

    if (convertWhileToFor) {
        const list = loop.parentPath!.node as TYPE.BlockStatement | TYPE.Program;
        for (const statement of consumedInitStatements) {
            const index = list.body.indexOf(statement);
            if (index >= 0) list.body.splice(index, 1);
        }
        const forStatement = TYPE.forStatement(newInit as any, loop.node.test as any, null, body.node);
        loop.replaceWith(forStatement);
        loop.skip();
    }

    return true;
}

/** Rename every value-position occurrence of the rotated environment inside the loop. */
function renameRotatedEnvironment(
    loop: NodePath<TYPE.ForStatement | TYPE.WhileStatement | TYPE.DoWhileStatement>,
    pairs: Pair[],
): void {
    const rename = new Map(pairs.map((pair) => [pair.rotated, pair.base]));
    loop.traverse({
        Identifier: (path) => {
            const base = rename.get(path.node.name);
            if (base === undefined) return;
            const parent = path.parent;
            if (!parent) return;
            if (isMemberExpression(parent) && parent.property === path.node && !parent.computed) return;
            if (isObjectProperty(parent) && parent.key === path.node && !parent.computed) {
                // Keep the property key, rename only the shorthand value.
                if ((parent as TYPE.ObjectProperty).shorthand) {
                    path.parentPath.replaceWith(TYPE.objectProperty(
                        identifier(path.node.name), identifier(base), false));
                }
                return;
            }
            if (parent.type === "LabeledStatement" || parent.type === "BreakStatement"
                || parent.type === "ContinueStatement") return;
            path.replaceWith(identifier(base) as any);
        },
    });
}
