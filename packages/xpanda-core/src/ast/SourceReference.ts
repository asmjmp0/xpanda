import * as t from "@babel/types";
import traverse from "@babel/traverse";
import { NodeFactory } from "./NodeFactory";

/**
 * Source-level reference collection.
 *
 * Dynamic Panda bytecode calls are indirect (the callee sits in the
 * accumulator), so method call sites are not visible in the instruction
 * operands. The decompiled source still carries the final names; this helper
 * extracts method/field/class references from it. Static .abc keeps using the
 * exact bytecode xref index.
 *
 * @Author: jmp0
 */

export type SourceRefType = "method" | "field" | "class";
export type SourceRefKind = "call" | "new" | "field-read" | "field-write" | "class-ref";

export interface SourceReference {
    targetType: SourceRefType;
    targetName: string;
    targetOwner?: string;
    fromClass: string;
    fromMethod: string;
    line: number;
    kind: SourceRefKind;
}

function propertyName(node: t.Node | null | undefined): string | null {
    if (!node) return null;
    if (t.isIdentifier(node)) return node.name;
    if (t.isStringLiteral(node) || t.isNumericLiteral(node)) return String(node.value);
    if (t.isPrivateName(node)) return "#" + node.id.name;
    return null;
}

function unwrapMemberChain(node: t.Expression | t.Super): { owner?: string; name: string; fromThis?: boolean } | null {
    if (!t.isMemberExpression(node) && !t.isOptionalMemberExpression(node)) return null;
    const name = propertyName(node.property);
    if (!name) return null;
    if (t.isThisExpression(node.object)) return { name, fromThis: true };
    if (t.isIdentifier(node.object)) return { owner: node.object.name, name };
    if (t.isMemberExpression(node.object) && t.isIdentifier(node.object.property)
        && node.object.property.name === "prototype" && t.isIdentifier(node.object.object)) {
        return { owner: node.object.object.name, name };
    }
    return { name };
}

function calleeTarget(node: t.Node | null | undefined): { owner?: string; name: string; fromThis?: boolean; bare?: boolean } | null {
    if (!node) return null;
    if (t.isIdentifier(node)) return { name: node.name, bare: true };
    if (t.isMemberExpression(node) || t.isOptionalMemberExpression(node)) return unwrapMemberChain(node);
    return null;
}

function inferenceName(path: any): string | null {
    const node = path.node;
    if (t.isFunctionDeclaration(node) || t.isFunctionExpression(node)) {
        return t.isIdentifier(node.id) ? node.id.name : null;
    }
    if (t.isArrowFunctionExpression(node)) {
        const parent = path.parentPath?.node;
        if (t.isVariableDeclarator(parent) && t.isIdentifier(parent.id)) return parent.id.name;
        if (t.isAssignmentExpression(parent) && parent.right === node) {
            if (t.isIdentifier(parent.left)) return parent.left.name;
            if (t.isMemberExpression(parent.left)) return propertyName(parent.left.property);
        }
        if (t.isObjectProperty(parent) && t.isExpression(parent.value)) return propertyName(parent.key);
    }
    return null;
}

export function collectSourceReferences(source: string, fromClass: string,
    defaultMethod = "func_main_0"): SourceReference[] {
    let program: t.Program;
    try {
        program = NodeFactory.parse(source);
    } catch {
        return [];
    }
    const references: SourceReference[] = [];
    const methodStack: string[] = [];
    const pushedFunctions = new WeakSet<object>();
    const currentMethod = (): string => methodStack.length > 0 ? methodStack[methodStack.length - 1] : defaultMethod;
    const seen = new Set<string>();
    const emit = (type: SourceRefType, name: string, owner: string | undefined,
        kind: SourceRefKind, line: number): void => {
        if (!name) return;
        const key = type + "\u0000" + (owner ?? "") + "\u0000" + name + "\u0000" + kind + "\u0000" + line;
        if (seen.has(key)) return;
        seen.add(key);
        references.push({
            targetType: type,
            targetName: name,
            targetOwner: owner,
            fromClass,
            fromMethod: currentMethod(),
            line,
            kind,
        });
    };

    traverse(t.file(program), {
        ClassMethod: {
            enter(path: any) { methodStack.push(propertyName(path.node.key) ?? "anonymous"); },
            exit() { methodStack.pop(); },
        } as any,
        ObjectMethod: {
            enter(path: any) { methodStack.push(propertyName(path.node.key) ?? "anonymous"); },
            exit() { methodStack.pop(); },
        } as any,
        FunctionDeclaration: {
            enter(path: any) {
                if (methodStack.length === 0) {
                    const name = inferenceName(path);
                    if (name) {
                        methodStack.push(name);
                        pushedFunctions.add(path.node);
                    }
                }
            },
            exit(path: any) {
                if (pushedFunctions.has(path.node)) {
                    methodStack.pop();
                    pushedFunctions.delete(path.node);
                }
            },
        } as any,
        FunctionExpression: {
            enter(path: any) {
                if (methodStack.length === 0) {
                    const name = inferenceName(path);
                    if (name) {
                        methodStack.push(name);
                        pushedFunctions.add(path.node);
                    }
                }
            },
            exit(path: any) {
                if (pushedFunctions.has(path.node)) {
                    methodStack.pop();
                    pushedFunctions.delete(path.node);
                }
            },
        } as any,
        ArrowFunctionExpression: {
            enter(path: any) {
                if (methodStack.length === 0) {
                    const name = inferenceName(path);
                    if (name) {
                        methodStack.push(name);
                        pushedFunctions.add(path.node);
                    }
                }
            },
            exit(path: any) {
                if (pushedFunctions.has(path.node)) {
                    methodStack.pop();
                    pushedFunctions.delete(path.node);
                }
            },
        } as any,
        CallExpression: (path: any) => {
            const target = calleeTarget(path.node.callee);
            if (!target) return;
            const owner = target.bare || target.fromThis ? fromClass : target.owner;
            emit("method", target.name, owner, "call", path.node.loc?.start.line ?? 0);
        },
        OptionalCallExpression: (path: any) => {
            const target = calleeTarget(path.node.callee);
            if (!target) return;
            const owner = target.bare || target.fromThis ? fromClass : target.owner;
            emit("method", target.name, owner, "call", path.node.loc?.start.line ?? 0);
        },
        NewExpression: (path: any) => {
            if (!t.isIdentifier(path.node.callee)) return;
            const name = path.node.callee.name;
            const line = path.node.loc?.start.line ?? 0;
            emit("class", name, undefined, "class-ref", line);
            emit("method", "<ctor>", name, "new", line);
        },
        AssignmentExpression: (path: any) => {
            const left = path.node.left;
            if (!t.isMemberExpression(left) && !t.isOptionalMemberExpression(left)) return;
            const target = unwrapMemberChain(left);
            if (!target) return;
            const owner = target.fromThis ? fromClass : target.owner;
            emit("field", target.name, owner, "field-write", path.node.loc?.start.line ?? 0);
        },
        MemberExpression: (path: any) => {
            const parent = path.parentPath?.node;
            if ((t.isCallExpression(parent) || t.isOptionalCallExpression(parent) || t.isNewExpression(parent))
                && parent.callee === path.node) return;
            if (t.isAssignmentExpression(parent) && parent.left === path.node) return;
            const target = unwrapMemberChain(path.node);
            if (!target) return;
            const owner = target.fromThis ? fromClass : target.owner;
            emit("field", target.name, owner, "field-read", path.node.loc?.start.line ?? 0);
        },
        OptionalMemberExpression: (path: any) => {
            const parent = path.parentPath?.node;
            if ((t.isCallExpression(parent) || t.isOptionalCallExpression(parent) || t.isNewExpression(parent))
                && parent.callee === path.node) return;
            if (t.isAssignmentExpression(parent) && parent.left === path.node) return;
            const target = unwrapMemberChain(path.node);
            if (!target) return;
            const owner = target.fromThis ? fromClass : target.owner;
            emit("field", target.name, owner, "field-read", path.node.loc?.start.line ?? 0);
        },
    });
    return references;
}
