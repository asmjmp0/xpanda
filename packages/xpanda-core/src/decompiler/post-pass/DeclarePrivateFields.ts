import * as TYPE from "@babel/types";

const { VISITOR_KEYS, classPrivateProperty, identifier, privateName, stringLiteral } = TYPE;

/**
 * `#fN` is only legal inside the class that declares it. The private-property
 * handles emit that form for every `ldprivateproperty` / `stprivateproperty` /
 * `defineprivateproperty` / `testin`. Two follow-ups make the output parse:
 *
 *   - a class that mentions `#fN` gets `#fN;` at the top of its body;
 *   - a use that sits outside any class (a `definemethod` iterator or the
 *     instance initializer, both assigned onto the prototype after the class)
 *     is rewritten to the string key `obj["#fN"]` / `"#fN" in obj`.
 *
 * Field order follows the slot encoded in the name (`f0`, `f1`, `f2`, then
 * `f<level>_<slot>`). Nested classes keep their own names.
 *
 * @Author: jmp0
 */
export function declarePrivateFields(program: TYPE.Program): boolean {
    let changed = false;
    walk(program, null);
    return changed;

    function walk(node: TYPE.Node, classBody: TYPE.ClassBody | null): void {
        if (node.type === "ClassBody") {
            if (declareMissing(node)) changed = true;
            for (const statement of node.body) walk(statement, node);
            return;
        }
        if (!classBody && rewriteLoosePrivate(node)) changed = true;
        const keys = (VISITOR_KEYS as Record<string, readonly string[] | undefined>)[node.type];
        if (!keys) return;
        for (const key of keys) {
            const child = (node as any)[key];
            if (Array.isArray(child)) {
                for (const item of child) {
                    if (item && typeof item.type === "string") walk(item, classBody);
                }
            } else if (child && typeof child.type === "string") {
                walk(child, classBody);
            }
        }
    }
}

function declareMissing(body: TYPE.ClassBody): boolean {
    const used = new Set<string>();
    for (const statement of body.body) collectNames(statement, used);
    const declared = new Set<string>();
    for (const statement of body.body) {
        if ((statement.type === "ClassPrivateProperty" || statement.type === "ClassPrivateMethod")
            && statement.key.type === "PrivateName") {
            declared.add(statement.key.id.name);
        }
    }
    const missing = [...used].filter((name) => !declared.has(name));
    if (missing.length === 0) return false;
    missing.sort(compareSlotName);
    const fields = missing.map((name) => classPrivateProperty(privateName(identifier(name))));
    body.body = [...fields, ...body.body];
    return true;
}

/** Private names that belong to this class. A nested class is its own scope. */
function collectNames(node: TYPE.Node, used: Set<string>): void {
    if (node.type === "ClassDeclaration" || node.type === "ClassExpression") return;
    if (node.type === "PrivateName") {
        used.add(node.id.name);
        return;
    }
    const keys = (VISITOR_KEYS as Record<string, readonly string[] | undefined>)[node.type];
    if (!keys) return;
    for (const key of keys) {
        const child = (node as any)[key];
        if (Array.isArray(child)) {
            for (const item of child) {
                if (item && typeof item.type === "string") collectNames(item, used);
            }
        } else if (child && typeof child.type === "string") {
            collectNames(child, used);
        }
    }
}

/**
 * A `#name` that lexically sits outside every class becomes the string key
 * `obj["#name"]` / `"#name" in obj`, which is valid at statement level.
 */
function rewriteLoosePrivate(node: TYPE.Node): boolean {
    if ((node.type === "MemberExpression" || node.type === "OptionalMemberExpression")
        && node.property.type === "PrivateName") {
        const name = node.property.id.name;
        (node as TYPE.MemberExpression).property = stringLiteral("#" + name);
        node.computed = true;
        return true;
    }
    if (node.type === "BinaryExpression" && node.operator === "in" && node.left.type === "PrivateName") {
        const name = node.left.id.name;
        node.left = stringLiteral("#" + name);
        return true;
    }
    return false;
}

/** Slot order: `f0`, `f1`, `f1_0` (level, then slot), `f2`. */
function compareSlotName(a: string, b: string): number {
    const left = slotParts(a);
    const right = slotParts(b);
    const count = Math.max(left.length, right.length);
    for (let i = 0; i < count; i++) {
        const delta = (left[i] ?? -1) - (right[i] ?? -1);
        if (delta !== 0) return delta;
    }
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
}

function slotParts(name: string): number[] {
    const body = name.startsWith("f") ? name.slice(1) : name;
    return body.split("_").map((part) => {
        const value = Number(part);
        return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
    });
}
