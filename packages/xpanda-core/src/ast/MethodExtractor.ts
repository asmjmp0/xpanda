import * as t from "@babel/types";
import traverse from "@babel/traverse";
import { NodeFactory } from "./NodeFactory";

/**
 * Source-level method extraction helpers.
 *
 * The MCP server decompiles whole classes; these helpers parse the generated
 * JavaScript and pull out one method (plus its line range) so agents can read a
 * method without the rest of the class. They intentionally work on the final
 * source, which keeps static-file lambda inlining and dynamic class-level
 * simplification intact.
 *
 * @Author: jmp0
 */

export type ExtractedMethodKind = "method" | "constructor" | "get" | "set" | "function" | "assignment";

export interface ExtractedMethod {
    name: string;
    kind: ExtractedMethodKind;
    ownerClass?: string;
    code: string;
    startLine: number;
    endLine: number;
}

export interface MethodRange {
    name: string;
    kind: ExtractedMethodKind;
    ownerClass?: string;
    startLine: number;
    endLine: number;
}

interface Candidate {
    name: string;
    kind: ExtractedMethodKind;
    ownerClass?: string;
    node: t.Node;
    priority: number;
}

function parseProgram(source: string): t.Program | null {
    try {
        return NodeFactory.parse(source);
    } catch {
        return null;
    }
}

function keyName(node: t.Node | null | undefined): string | null {
    if (!node) return null;
    if (t.isIdentifier(node)) return node.name;
    if (t.isStringLiteral(node) || t.isNumericLiteral(node)) return String(node.value);
    if (t.isPrivateName(node)) return "#" + node.id.name;
    return null;
}

function classOwnerName(path: any): string | undefined {
    const classPath = path.findParent((parent: any) => parent.isClassDeclaration() || parent.isClassExpression());
    const id = classPath?.node?.id;
    if (!t.isIdentifier(id)) return undefined;
    return id.name;
}

function toCandidate(path: any): Candidate | null {
    const node = path.node;
    if (t.isClassMethod(node) || t.isClassPrivateMethod(node) || t.isTSDeclareMethod(node)) {
        const name = keyName(node.key);
        if (!name) return null;
        const kind: ExtractedMethodKind = node.kind === "constructor" ? "constructor"
            : node.kind === "get" ? "get"
                : node.kind === "set" ? "set" : "method";
        return {
            name,
            kind,
            ownerClass: classOwnerName(path),
            node,
            priority: kind === "constructor" ? 3 : kind === "get" || kind === "set" ? 2 : 1,
        };
    }
    if (t.isObjectMethod(node)) {
        const name = keyName(node.key);
        if (!name) return null;
        const kind: ExtractedMethodKind = node.kind === "get" ? "get" : node.kind === "set" ? "set" : "method";
        return { name, kind, node, priority: 1 };
    }
    if (t.isFunctionDeclaration(node) && t.isIdentifier(node.id)) {
        return { name: node.id.name, kind: "function", node, priority: 1 };
    }
    if (t.isVariableDeclarator(node) && t.isIdentifier(node.id)
        && (t.isFunctionExpression(node.init) || t.isArrowFunctionExpression(node.init))) {
        return { name: node.id.name, kind: "function", node, priority: 0 };
    }
    if (t.isAssignmentExpression(node) && (t.isFunctionExpression(node.right) || t.isArrowFunctionExpression(node.right))) {
        if (!t.isMemberExpression(node.left)) return null;
        const name = keyName(node.left.property);
        if (!name) return null;
        let ownerClass: string | undefined;
        if (t.isMemberExpression(node.left.object) && t.isIdentifier(node.left.object.property)) {
            if (node.left.object.property.name === "prototype" && t.isIdentifier(node.left.object.object)) {
                ownerClass = node.left.object.object.name;
            }
        }
        return { name, kind: "assignment", ownerClass, node, priority: 0 };
    }
    return null;
}

function collectCandidates(source: string): Candidate[] {
    const program = parseProgram(source);
    if (!program) return [];
    const candidates: Candidate[] = [];
    traverse(t.file(program), {
        enter(path: any) {
            const candidate = toCandidate(path);
            if (candidate) candidates.push(candidate);
        },
    });
    return candidates;
}

function requestedMethod(methodName: string): { name: string; kind?: ExtractedMethodKind } {
    const name = methodName.trim();
    if (name === "<ctor>" || name === "constructor") return { name: "constructor", kind: "constructor" };
    if (name.startsWith("%%get-")) return { name: name.substring(6), kind: "get" };
    if (name.startsWith("%%set-")) return { name: name.substring(6), kind: "set" };
    return { name };
}

/** Extract one method/function from generated source. */
export function extractMethodFromSource(source: string, methodName: string): ExtractedMethod | null {
    const request = requestedMethod(methodName);
    const matches = collectCandidates(source).filter((candidate) => {
        if (candidate.name !== request.name) return false;
        return request.kind ? candidate.kind === request.kind : true;
    });
    if (matches.length === 0) return null;
    matches.sort((a, b) => b.priority - a.priority);
    const match = matches[0];
    const code = renderCandidate(match);
    const startLine = match.node.loc?.start.line ?? 0;
    const endLine = match.node.loc?.end.line ?? startLine;
    return {
        name: match.name,
        kind: match.kind,
        ownerClass: match.ownerClass,
        code,
        startLine,
        endLine,
    };
}

/** List method/function names and line ranges in generated source. */
export function listMethodsFromSource(source: string): MethodRange[] {
    const result: MethodRange[] = [];
    for (const candidate of collectCandidates(source)) {
        const startLine = candidate.node.loc?.start.line ?? 0;
        const endLine = candidate.node.loc?.end.line ?? startLine;
        if (startLine <= 0) continue;
        result.push({
            name: candidate.name,
            kind: candidate.kind,
            ownerClass: candidate.ownerClass,
            startLine,
            endLine,
        });
    }
    result.sort((a, b) => a.startLine - b.startLine);
    return result;
}

function renderCandidate(candidate: Candidate): string {
    switch (candidate.kind) {
        case "function":
            if (t.isVariableDeclarator(candidate.node)) {
                return NodeFactory.generate(t.variableDeclaration("const", [candidate.node]) as any);
            }
            return NodeFactory.generate(candidate.node as any);
        case "assignment":
            return NodeFactory.generate(t.expressionStatement(candidate.node as t.Expression) as any);
        default:
            return NodeFactory.generate(candidate.node as any);
    }
}
