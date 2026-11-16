import * as t from "@babel/types";
import { NodeFactory } from "../ast/NodeFactory";
import { NodeUtils } from "../ast/NodeUtils";
import { runPostProcessPasses } from "../decompiler/post-pass/PostProcessPass";
import { SimplifyExport } from "../simplify/SimplifyExport";
import { PandaClass } from "../file/clazz/PandaClass";
import type { PandaMethod } from "../file/method/PandaMethod";
import { StaticPandaDecompilerMethodHandler } from "./StaticPandaDecompilerMethodHandler";
import { StaticPandaLexical } from "./StaticPandaLexical";
import { StaticPandaFile } from "./StaticPandaFile";
import { sanitizeClassName, sanitizeIdentifier, sanitizeMemberName, simpleClassName } from "./StaticNaming";
import { StaticLambdaInliner } from "./StaticLambdaInliner";

const ACC_STATIC = 0x0008;
const ACC_NATIVE = 0x0100;
const ACC_ABSTRACT = 0x0400;

/**
 * ArkTS-Sta class/module decompiler.
 *
 * Parsing/disassembly live in the static module; this entry only renders the
 * AST and reuses the shared post-process + simplify pipeline.
 *
 * @Author: jmp0
 */
export class StaticDecompiler {
    private readonly handler = new StaticPandaDecompilerMethodHandler();
    private readonly lexical = new StaticPandaLexical();

    /** Raw (not simplified) AST for one class. Returns null when it has no code. */
    decompileClassAst(clazz: PandaClass): t.Program | null {
        const program = t.program([]);
        const factory = NodeFactory;
        factory.addComment(program as any, "\n* class name:" + clazz.name.content + "\n* Source code created from an ArkTS-Sta .abc file.\n* powered by xpanda decompiler, author: jmp0\n");
        const isModule = this.isModuleClass(clazz);
        if (isModule) {
            this.renderModule(clazz, program);
        } else {
            const declaration = this.renderClass(clazz);
            if (!declaration) return null;
            program.body.push(declaration);
        }
        if (program.body.length === 0) return null;
        runPostProcessPasses(program);
        return program;
    }

    decompileClass(clazz: PandaClass): string {
        const program = this.decompileClassAst(clazz);
        if (!program) return "";
        try {
            SimplifyExport.simplify(program);
        } catch {
            // Keep the structural output when a dynamic-only optimizer pass
            // does not understand a static-language shape.
        }
        return NodeFactory.generate(program);
    }

    decompileClassRaw(clazz: PandaClass): string {
        const program = this.decompileClassAst(clazz);
        if (!program) return "";
        return NodeFactory.generate(program);
    }

    /**
     * File-level decompilation: builds every class AST, simplifies it, then
     * reconstructs compiler-generated lambdas across class boundaries. Lambda
     * classes whose construction sites were all inlined are omitted.
     */
    decompileFilePrograms(file: StaticPandaFile, simplify: boolean): Map<PandaClass, t.Program> {
        const classes = file.getAllClasses().filter((clazz) =>
            clazz.getClassName() && this.hasCode(clazz));
        const programs = new Map<PandaClass, t.Program>();
        for (const clazz of classes) {
            try {
                const program = this.decompileClassAst(clazz);
                if (program) programs.set(clazz, program);
            } catch {
                // A single malformed class must not abort the whole file.
            }
        }
        if (!simplify) return programs;

        for (const program of programs.values()) {
            try {
                SimplifyExport.simplify(program);
            } catch {
                // Keep the structural output when a dynamic-only optimizer pass
                // does not understand a static-language shape.
            }
        }

        const inliner = new StaticLambdaInliner(programs);
        const changed = inliner.inlineAll();
        for (const clazz of changed) {
            const program = programs.get(clazz);
            if (!program) continue;
            try {
                SimplifyExport.simplify(program);
            } catch {
                // keep the inlined but unsimplified program
            }
        }
        inliner.cleanup();
        return programs;
    }

    /** File-level decompilation returning per-class rendered source. */
    decompileFile(file: StaticPandaFile, simplify = true): Array<{ clazz: PandaClass; code: string }> {
        const programs = this.decompileFilePrograms(file, simplify);
        const result: Array<{ clazz: PandaClass; code: string }> = [];
        for (const clazz of file.getAllClasses()) {
            const program = programs.get(clazz);
            if (!program) continue;
            try {
                result.push({ clazz, code: NodeFactory.generate(program) });
            } catch {
                // skip an unprintable class
            }
        }
        return result;
    }

    decompile(file: StaticPandaFile): string[] {
        const out: string[] = [];
        for (const clazz of file.getAllClasses()) {
            if (!this.hasCode(clazz)) continue;
            const content = this.decompileClass(clazz);
            if (!content) continue;
            out.push("\n/***************************" + clazz.name.content + "*************************************\n" + content);
        }
        return out;
    }

    private hasCode(clazz: PandaClass): boolean {
        if (!clazz.getClassName()) return false;
        for (const method of clazz.pandaMethods.values()) {
            if (method.methodCode) return true;
        }
        return false;
    }

    private isModuleClass(clazz: PandaClass): boolean {
        const name = clazz.getClassName();
        return name.endsWith("/ETSGLOBAL;") && !name.startsWith("Lstd/");
    }

    private renderModule(clazz: PandaClass, program: t.Program): void {
        const declarators: t.VariableDeclarator[] = [];
        for (const field of clazz.pandaFields ?? []) {
            declarators.push(t.variableDeclarator(t.identifier(field.getName()), null));
        }
        if (declarators.length > 0) program.body.push(t.variableDeclaration("let", declarators));
        const cctor = clazz.pandaMethods.get("<cctor>");
        if (cctor && cctor.methodCode) {
            // Keep the register temporaries out of the module scope.
            const init = this.handler.decompileMethod(cctor, this.lexical);
            program.body.push(t.expressionStatement(
                t.callExpression(t.functionExpression(null, [], init.body), [])));
        }
        for (const [name, method] of clazz.pandaMethods) {
            if (name === "<cctor>" || name === "main") continue;
            if (!method.methodCode || this.isNative(method)) continue;
            program.body.push(this.handler.decompileMethod(method, this.lexical));
        }
    }

    private renderClass(clazz: PandaClass): t.ClassDeclaration | null {
        const className = sanitizeClassName(clazz.getClassName());
        if (!className) return null;
        const superClass = this.superClassName(clazz);
        const body: Array<t.ClassMethod | t.ClassProperty | t.ClassPrivateProperty | t.StaticBlock> = [];

        for (const field of clazz.pandaFields ?? []) {
            const name = field.getName();
            const isStatic = this.isStaticField(field.accessFlag);
            if (name.startsWith("#") && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name.substring(1))) {
                body.push(t.classPrivateProperty(t.privateName(t.identifier(name.substring(1))), null, null, isStatic));
            } else {
                body.push(t.classProperty(t.identifier(sanitizeMemberName(name)), null, null, null, false, isStatic));
            }
        }

        const cctor = clazz.pandaMethods.get("<cctor>");
        if (cctor && cctor.methodCode) {
            const init = this.handler.decompileMethod(cctor, this.lexical);
            // Wrap the initializer in an IIFE so the shared simplify pipeline
            // (which visits function bodies) can fold the register temporaries.
            const statements = init.body.body;
            if (statements.length > 0) {
                body.push(t.staticBlock([
                    t.expressionStatement(t.callExpression(t.functionExpression(null, [], t.blockStatement(statements)), [])),
                ]));
            }
        }

        const accessors = new Map<string, { getter?: PandaMethod; setter?: PandaMethod }>();
        for (const [name, method] of clazz.pandaMethods) {
            if (name === "<cctor>") continue;
            if (name.startsWith("%%get-") || name.startsWith("%%set-")) {
                const key = sanitizeMemberName(name.substring(6));
                const entry = accessors.get(key) ?? {};
                if (name.startsWith("%%get-")) entry.getter = method;
                else entry.setter = method;
                accessors.set(key, entry);
                continue;
            }
            if (!method.methodCode) {
                if (this.isNative(method) || this.isAbstract(method)) {
                    const params: t.Identifier[] = [];
                    const count = method.pandaProto ? Math.max(0, method.pandaProto.pandaRawTypes.length - 1) : Math.max(0, (method.methodCode?.numArgs ?? 0) - 1);
                    for (let i = 0; i < count; i++) params.push(t.identifier("p" + i));
                    const marker = t.blockStatement([]);
                    t.addComment(marker, "inner", this.isNative(method) ? " native method " : " abstract method ", false);
                    const impl = t.functionExpression(null, params, marker);
                    const key = sanitizeIdentifier(name);
                    body.push(NodeFactory.classMethodNode(t.identifier(key), impl, "method", false, this.isStaticMethod(method)));
                }
                continue;
            }
            if (this.isNative(method) || this.isAbstract(method)) continue;
            const isConstructor = name === "<ctor>";
            const fn = this.handler.decompileMethod(method, this.lexical, isConstructor ? "constructor" : undefined);
            body.push(NodeFactory.classMethodNode(
                t.identifier(isConstructor ? "constructor" : sanitizeIdentifier(name)),
                t.functionExpression(null, fn.params as t.Identifier[], fn.body),
                isConstructor ? "constructor" : "method",
                false,
                this.isStaticMethod(method),
            ));
        }
        for (const [key, entry] of accessors) {
            if (entry.getter?.methodCode) {
                const fn = this.handler.decompileMethod(entry.getter, this.lexical);
                body.push(NodeFactory.classMethodNode(
                    t.identifier(key),
                    t.functionExpression(null, fn.params as t.Identifier[], fn.body),
                    "get", false, false));
            }
            if (entry.setter?.methodCode) {
                const fn = this.handler.decompileMethod(entry.setter, this.lexical);
                body.push(NodeFactory.classMethodNode(
                    t.identifier(key),
                    t.functionExpression(null, fn.params as t.Identifier[], fn.body),
                    "set", false, false));
            }
        }

        return t.classDeclaration(
            t.identifier(className),
            superClass ? t.identifier(superClass) : null,
            t.classBody(body),
            null);
    }

    private superClassName(clazz: PandaClass): string | null {
        const offset = clazz.superClassOff;
        if (!offset || !offset.isValid()) return null;
        const file = clazz.getPandaFile();
        if (!file) return null;
        const cached = file.resolveOffset(offset.getOffset());
        const parent = cached instanceof PandaClass
            ? cached
            : PandaClass.create(file, offset.getOffset(), clazz.indexHeader);
        const name = simpleClassName(parent.getClassName());
        if (!name || name === "Object" || name === "ETSGLOBAL") return null;
        return sanitizeClassName(parent.getClassName());
    }

    private isStaticMethod(method: PandaMethod): boolean {
        return (method.accessFlag & ACC_STATIC) !== 0;
    }

    private isNative(method: PandaMethod): boolean {
        return (method.accessFlag & ACC_NATIVE) !== 0;
    }

    private isAbstract(method: PandaMethod): boolean {
        return (method.accessFlag & ACC_ABSTRACT) !== 0;
    }

    private isStaticField(accessFlag: number): boolean {
        return (accessFlag & ACC_STATIC) !== 0;
    }
}

/** Convenience API used by the CLI and tests. */
export function decompileStaticAbc(data: Uint8Array, simplify = true): string {
    const file = new StaticPandaFile(data);
    return new StaticDecompiler().decompileFile(file, simplify)
        .map((result) => "\n/***************************" + result.clazz.name.content + "*************************************\n" + result.code)
        .join("\n");
}
