import * as t from "@babel/types";
import traverse from "@babel/traverse";
import type { PandaClass } from "../file/clazz/PandaClass";
import { sanitizeClassName } from "./StaticNaming";

interface ParamSource {
    kind: "capture" | "arg";
    index: number;
}

interface LambdaInfo {
    clazz: PandaClass;
    /** Rendered JS class name (`lambda_lambda_invoke_201`). */
    jsName: string;
    arity: number;
    fields: string[];
    thisFieldIndex: number;
    bodyMethodName: string;
    bodyNode: t.ClassMethod | t.FunctionDeclaration;
    paramSources: ParamSource[];
    bodyIsAsync: boolean;
}

/**
 * Reconstructs ArkTS-Sta compiler-generated closures.
 *
 * The static compiler lowers every closure to a class
 * (`%%lambda-lambda_invoke-N extends LambdaM`) whose fields are captures and
 * whose `invokeM` delegates to a hoisted `lambda_invoke-N` method. This pass
 * turns `new lambda_N(captures)` back into an arrow function and removes the
 * generated classes/methods when every construction site was inlined.
 *
 * It runs at the file level (the lambda class and its caller are different
 * class records) and after the first simplify pass, when `new Promise(new
 * lambda_N(...))` is already a nested expression.
 *
 * @Author: jmp0
 */
export class StaticLambdaInliner {
    private readonly infos = new Map<string, LambdaInfo>();
    private readonly lambdaClasses = new Map<string, PandaClass>();
    private readonly programs: Map<PandaClass, t.Program>;
    private readonly changed = new Set<PandaClass>();
    private readonly remaining = new Set<string>();

    constructor(programs: Map<PandaClass, t.Program>) {
        this.programs = programs;
        for (const [clazz, program] of programs) {
            if (!isLambdaClass(clazz)) continue;
            const info = buildLambdaInfo(clazz, program, programs);
            if (!info) continue;
            this.infos.set(info.jsName, info);
            this.lambdaClasses.set(info.jsName, clazz);
        }
    }

    /** Inline every lambda construction site. Returns the programs that changed. */
    inlineAll(): Set<PandaClass> {
        for (let round = 0; round < 8; round++) {
            let any = false;
            for (const [clazz, program] of this.programs) {
                if (!this.inlineProgram(program)) continue;
                this.changed.add(clazz);
                any = true;
            }
            if (!any) break;
        }
        return this.changed;
    }

    /**
     * Drop fully-inlined lambda classes and unreferenced hoisted body methods.
     * Returns the classes that should not be emitted.
     */
    cleanup(): Set<PandaClass> {
        const referenced = collectReferencedNames(this.programs);
        const omitted = new Set<PandaClass>();
        for (const [jsName, clazz] of this.lambdaClasses) {
            if (this.infos.has(jsName) && !this.remaining.has(jsName) && !referenced.has(jsName)) {
                omitted.add(clazz);
            }
        }
        for (const clazz of omitted) this.programs.delete(clazz);

        // Recompute references without the omitted lambda classes; a hoisted
        // body method is dead once no remaining lambda class or source method
        // calls it.
        const liveNames = collectReferencedNames(this.programs);
        for (const [clazz, program] of this.programs) {
            if (removeDeadGeneratedMethods(program, liveNames)) this.changed.add(clazz);
        }
        return omitted;
    }

    private inlineProgram(program: t.Program): boolean {
        let changed = false;
        traverse(t.file(program), {
            NewExpression: (path) => {
                if (!t.isIdentifier(path.node.callee)) return;
                const info = this.infos.get(path.node.callee.name);
                if (!info) return;
                const arrow = this.buildArrow(info, path.node, path.parentPath?.node);
                if (!arrow) {
                    this.remaining.add(info.jsName);
                    return;
                }
                path.replaceWith(arrow);
                changed = true;
            },
        });
        return changed;
    }

    private buildArrow(info: LambdaInfo, node: t.NewExpression, parent: t.Node | undefined): t.ArrowFunctionExpression | null {
        if (node.arguments.length !== info.fields.length) return null;
        const args: t.Expression[] = [];
        for (const arg of node.arguments) {
            if (!t.isExpression(arg)) return null;
            if (!isSafeCapture(arg)) return null;
            args.push(arg);
        }
        const thisExpr = info.thisFieldIndex >= 0 ? args[info.thisFieldIndex] : null;

        const arrowParams = this.arrowParamsFor(info, parent);
        if (arrowParams.length !== info.arity) return null;

        const body = t.cloneNode(info.bodyNode.body as t.BlockStatement, true);
        const replacements = new Map<string, t.Expression>();
        for (let i = 0; i < info.paramSources.length; i++) {
            const source = info.paramSources[i];
            const param = info.bodyNode.params[i];
            if (!t.isIdentifier(param)) return null;
            if (source.kind === "capture") {
                const value = args[source.index];
                if (!value) return null;
                replacements.set(param.name, value);
            } else {
                const value = arrowParams[source.index];
                if (!value) return null;
                replacements.set(param.name, t.identifier(value.name));
            }
        }

        const arrow = t.arrowFunctionExpression(arrowParams, body, info.bodyIsAsync);
        if (replacements.size > 0 || (thisExpr && !t.isThisExpression(thisExpr))) {
            const wrapper = t.program([t.expressionStatement(arrow)]);
            const inserted = new Set<t.Node>();
            traverse(t.file(wrapper), {
                Identifier: (path) => {
                    if (inserted.has(path.node)) return;
                    const replacement = replacements.get(path.node.name);
                    if (!replacement || !path.isReferencedIdentifier()) return;
                    // Keep shadowed locals declared inside the inlined body.
                    if (path.scope.hasBinding(path.node.name)) return;
                    const clone = t.cloneNode(replacement, true);
                    inserted.add(clone);
                    path.replaceWith(clone);
                    path.skip();
                },
                ThisExpression: (path) => {
                    if (!thisExpr || t.isThisExpression(thisExpr)) return;
                    const fn = path.getFunctionParent();
                    if (fn && !fn.isArrowFunctionExpression()) return;
                    path.replaceWith(t.cloneNode(thisExpr, true));
                },
            });
        }
        return arrow;
    }

    private arrowParamsFor(info: LambdaInfo, parent: t.Node | undefined): t.Identifier[] {
        const isPromiseExecutor = !!parent && t.isNewExpression(parent)
            && t.isIdentifier(parent.callee) && parent.callee.name === "Promise";
        if (isPromiseExecutor && info.arity === 2) {
            return [t.identifier("resolve"), t.identifier("reject")];
        }
        const params: t.Identifier[] = [];
        for (let i = 0; i < info.arity; i++) params.push(t.identifier("arg" + i));
        return params;
    }
}

// ---------------------------------------------------------------------------

function isLambdaClass(clazz: PandaClass): boolean {
    return clazz.getClassName().includes("%%lambda-lambda_invoke-");
}

function buildLambdaInfo(
    clazz: PandaClass,
    program: t.Program,
    programs: Map<PandaClass, t.Program>,
): LambdaInfo | null {
    const classNode = program.body.find((node): node is t.ClassDeclaration =>
        t.isClassDeclaration(node) && node.id?.name === sanitizeClassName(clazz.getClassName()));
    if (!classNode) return null;

    const invokeName = [...clazz.pandaMethods.keys()].find((name) => /^invoke\d+$/.test(name));
    if (!invokeName) return null;
    const arity = Number.parseInt(invokeName.substring("invoke".length), 10);
    if (!Number.isFinite(arity)) return null;

    const invokeNode = classNode.body.body.find((member): member is t.ClassMethod =>
        t.isClassMethod(member) && t.isIdentifier(member.key) && member.key.name === invokeName);
    if (!invokeNode) return null;

    const call = findLambdaInvokeCall(invokeNode.body);
    if (!call) return null;
    const bodyMethodName = lambdaCalleeName(call);
    if (!bodyMethodName) return null;

    const fields = (clazz.pandaFields ?? []).map((field) => field.getName());
    const thisFieldIndex = fields.indexOf("$this");

    const ownerClassName = lambdaOwnerClassName(clazz, call);
    const bodyNode = findBodyNode(programs, bodyMethodName, ownerClassName);
    if (!bodyNode) return null;
    if (bodyNode.params.length !== call.arguments.length) return null;
    if (call.arguments.some((arg) => !t.isExpression(arg))) return null;
    // A body that reads `this` must have the receiver capture; otherwise the
    // arrow would see the construction site's `this`.
    if (thisFieldIndex < 0 && containsThis(bodyNode.body)) return null;

    const invokeParams = new Map<string, number>();
    invokeNode.params.forEach((param, index) => {
        if (t.isIdentifier(param)) invokeParams.set(param.name, index);
    });

    const paramSources: ParamSource[] = [];
    for (const arg of call.arguments as t.Expression[]) {
        if (t.isMemberExpression(arg) && t.isThisExpression(arg.object)
            && t.isIdentifier(arg.property) && !arg.computed) {
            const index = fields.indexOf(arg.property.name);
            if (index < 0) return null;
            paramSources.push({ kind: "capture", index });
            continue;
        }
        if (t.isIdentifier(arg) && invokeParams.has(arg.name)) {
            paramSources.push({ kind: "arg", index: invokeParams.get(arg.name)! });
            continue;
        }
        return null;
    }

    return {
        clazz,
        jsName: sanitizeClassName(clazz.getClassName()),
        arity,
        fields,
        thisFieldIndex,
        bodyMethodName,
        bodyNode,
        paramSources,
        bodyIsAsync: containsAwait(bodyNode.body),
    };
}

/** `this.$this.lambda_invoke_201(...)` / `lambda_invoke_201(...)`. */
function findLambdaInvokeCall(node: t.Node): t.CallExpression | null {
    let found: t.CallExpression | null = null;
    const visit = (value: any): void => {
        if (found || !value || typeof value !== "object") return;
        if (Array.isArray(value)) {
            for (const item of value) visit(item);
            return;
        }
        if (value.type === "CallExpression" && lambdaCalleeName(value) !== null) {
            found = value;
            return;
        }
        for (const key of Object.keys(value)) {
            if (key === "loc" || key === "start" || key === "end" || key === "parent") continue;
            visit(value[key]);
        }
    };
    visit(node);
    return found;
}

function lambdaCalleeName(call: t.CallExpression): string | null {
    const callee = call.callee;
    if (t.isIdentifier(callee) && callee.name.startsWith("lambda_invoke_")) return callee.name;
    if (t.isMemberExpression(callee) && t.isIdentifier(callee.property)
        && !callee.computed && callee.property.name.startsWith("lambda_invoke_")) {
        return callee.property.name;
    }
    return null;
}

function lambdaOwnerClassName(clazz: PandaClass, call: t.CallExpression): string | null {
    const callee = call.callee;
    if (!t.isMemberExpression(callee) || callee.computed) return null;
    const object = callee.object;
    if (!t.isMemberExpression(object) || !t.isThisExpression(object.object)
        || !t.isIdentifier(object.property)) {
        return null;
    }
    const fieldName = object.property.name;
    const field = clazz.pandaFields?.find((item) => item.getName() === fieldName);
    if (!field) return null;
    const owner = clazz.indexHeader.pandaClasses[field.typeIdx];
    return owner ? sanitizeClassName(owner.getClassName()) : null;
}

function findBodyNode(
    programs: Map<PandaClass, t.Program>,
    name: string,
    ownerClassName: string | null,
): t.ClassMethod | t.FunctionDeclaration | null {
    const candidates: Array<[PandaClass, t.Program]> = [...programs];
    // Prefer the resolved owner, then ETSGLOBAL, then any class with a unique match.
    const ordered = ownerClassName
        ? candidates.sort(([a], [b]) =>
            (sanitizeClassName(a.getClassName()) === ownerClassName ? -1 : 0) -
            (sanitizeClassName(b.getClassName()) === ownerClassName ? -1 : 0))
        : candidates;
    let fallback: t.ClassMethod | t.FunctionDeclaration | null = null;
    for (const [clazz, program] of ordered) {
        const className = sanitizeClassName(clazz.getClassName());
        for (const node of program.body) {
            if (t.isFunctionDeclaration(node) && node.id?.name === name) {
                if (className === "ETSGLOBAL" || ownerClassName === null) return node;
                fallback = node;
            }
            if (t.isClassDeclaration(node) && className === (ownerClassName ?? className)) {
                for (const member of node.body.body) {
                    if (t.isClassMethod(member) && t.isIdentifier(member.key) && member.key.name === name) {
                        return member;
                    }
                }
            }
        }
        if (fallback) return fallback;
    }
    return fallback;
}

function isSafeCapture(expr: t.Expression): boolean {
    if (t.isIdentifier(expr) || t.isThisExpression(expr)) return true;
    if (t.isStringLiteral(expr) || t.isNumericLiteral(expr) || t.isBooleanLiteral(expr)
        || t.isNullLiteral(expr) || t.isBigIntLiteral(expr)) return true;
    if (t.isMemberExpression(expr)) {
        if (expr.computed && !t.isStringLiteral(expr.property) && !t.isNumericLiteral(expr.property)) return false;
        return isSafeCapture(expr.object as t.Expression);
    }
    return false;
}

function containsThis(node: t.Node): boolean {
    let found = false;
    const visit = (value: any): void => {
        if (found || !value || typeof value !== "object") return;
        if (Array.isArray(value)) {
            for (const item of value) visit(item);
            return;
        }
        if (value.type === "ThisExpression") {
            found = true;
            return;
        }
        for (const key of Object.keys(value)) {
            if (key === "loc" || key === "start" || key === "end" || key === "parent") continue;
            visit(value[key]);
        }
    };
    visit(node);
    return found;
}

function containsAwait(node: t.Node): boolean {
    let found = false;
    const visit = (value: any): void => {
        if (found || !value || typeof value !== "object") return;
        if (Array.isArray(value)) {
            for (const item of value) visit(item);
            return;
        }
        if (value.type === "AwaitExpression") {
            found = true;
            return;
        }
        for (const key of Object.keys(value)) {
            if (key === "loc" || key === "start" || key === "end" || key === "parent") continue;
            visit(value[key]);
        }
    };
    visit(node);
    return found;
}

function collectReferencedNames(programs: Map<PandaClass, t.Program>): Set<string> {
    const names = new Set<string>();
    for (const program of programs.values()) {
        traverse(t.file(program), {
            ReferencedIdentifier: (path) => {
                names.add(path.node.name);
            },
            MemberExpression: (path) => {
                if (!path.node.computed && t.isIdentifier(path.node.property)) {
                    names.add(path.node.property.name);
                }
            },
            NewExpression: (path) => {
                if (t.isIdentifier(path.node.callee)) names.add(path.node.callee.name);
            },
        });
    }
    return names;
}

function removeDeadGeneratedMethods(program: t.Program, liveNames: Set<string>): boolean {
    let changed = false;
    for (const node of program.body) {
        if (t.isFunctionDeclaration(node) && t.isIdentifier(node.id)
            && /^lambda_invoke_\d+$/.test(node.id.name) && !liveNames.has(node.id.name)) {
            // handled below by rebuilding the body list
        }
        if (t.isClassDeclaration(node)) {
            const kept = node.body.body.filter((member) => {
                if (!t.isClassMethod(member) || !t.isIdentifier(member.key)) return true;
                if (!/^lambda_invoke_\d+$/.test(member.key.name)) return true;
                if (liveNames.has(member.key.name)) return true;
                changed = true;
                return false;
            });
            node.body.body = kept;
        }
    }
    const keptBody = program.body.filter((node) => {
        if (!t.isFunctionDeclaration(node) || !t.isIdentifier(node.id)) return true;
        if (!/^lambda_invoke_\d+$/.test(node.id.name)) return true;
        if (liveNames.has(node.id.name)) return true;
        changed = true;
        return false;
    });
    if (keptBody.length !== program.body.length) program.body = keptBody;
    return changed;
}
