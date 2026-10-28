import { PandaFile, ENTRY_FUNCTION_MAIN } from "./file/PandaFile";
import { PandaClass, ImportType, ExportType } from "./file/clazz/PandaClass";
import { PandaLexical } from "./disasm/PandaLexical";
import { CodeGenerator } from "./codegen/CodeGenerator";
import { PandaDecompilerMethodHandler } from "./decompiler/MethodHandler";
import { StructureAnalysis } from "./decompiler/StructureAnalysis";
import { SimpleAnalysis } from "./decompiler/SimpleAnalysis";
import { NodeFactory } from "./ast/NodeFactory";
import { NodeUtils } from "./ast/NodeUtils";
import { SimplifyExport } from "./simplify/SimplifyExport";
import type { PandaMethod } from "./file/method/PandaMethod";

/**
 * 反编译器总入口(移植自 Java jmp0.abc.decompiler.PandaDecompiler)
 * 与 Java 版的差异:AST 构建与 simplify 全部进程内完成,不再依赖 GraalVM JS 与外部 node
 * @Author: jmp0
 */
export class PandaDecompiler {
    private readonly codeGenerator: CodeGenerator;
    private readonly methodHandler: PandaDecompilerMethodHandler;

    constructor() {
        this.codeGenerator = new CodeGenerator();
        this.methodHandler = new PandaDecompilerMethodHandler(this.codeGenerator);
    }

    /** decompileRaw 等价:输出 AST JSON */
    private decompileRaw(pandaClass: PandaClass): string {
        // 生成名计数按类复位,保证单类输出不依赖处理顺序(并行反编译的前提)
        this.methodHandler.reset();
        const pandaLexical = new PandaLexical(pandaClass);
        const factory = this.codeGenerator.getNodeFactory();
        const utils = this.codeGenerator.getNodeUtils();
        const funcMain0Method = pandaClass.pandaMethods.get(ENTRY_FUNCTION_MAIN);
        if (!funcMain0Method) return "//no function main...";
        const programNode = factory.programNode();

        // imports
        if (pandaClass.pandaClassModuleData) {
            for (const anImport of pandaClass.pandaClassModuleData.imports) {
                let importNode: any = null;
                switch (anImport.type) {
                    case ImportType.SPECIFIER:
                    case ImportType.SAME_SPECIFIER:
                        importNode = factory.importDeclarationNode(
                            factory.importSpecifierNode(anImport.localName, anImport.importName!),
                            anImport.path);
                        break;
                    case ImportType.NAMESPACE:
                        importNode = factory.importDeclarationNode(
                            factory.importNamespaceSpecifierNode(anImport.localName),
                            anImport.path);
                        break;
                    case ImportType.DEFAULT:
                        importNode = factory.importDeclarationNode(
                            factory.importDefaultSpecifierNode(anImport.localName),
                            anImport.path);
                        break;
                }
                if (importNode) utils.insertNodeToBody(importNode, programNode);
            }
        }

        // 头注释
        const builder: string[] = [];
        builder.push("\n* class name:" + pandaClass.name.content + "\n");
        builder.push("* Source code created from a .abc file.\n");
        builder.push("* powered by xpanda decompiler, author: jmp0\n");
        // 空模块:类记录只有 func_main_0 且字节码仅为 returnundefined(接口/纯类型源文件被
        // ArkTS 擦除后的产物),显式标注避免"反编译没有输出"的困惑
        if (this.isEmptyModuleRecord(pandaClass, pandaLexical, funcMain0Method)) {
            builder.push("* empty module: no runtime code in this class record (interface / type-only source file)\n");
        }

        // 导出变量声明
        if (pandaClass.pandaClassModuleData) {
            const nameSet = new Set<string>();
            for (const exp of pandaClass.pandaClassModuleData.exports) {
                // 只有本地导出才引入模块级绑定;间接导出(export {a} from "path")没有本地变量
                if (exp.type === ExportType.LOCAL && exp.localName !== null) nameSet.add(exp.localName);
            }
            if (nameSet.size > 0) {
                const arrayObject = this.codeGenerator.arrayObject();
                for (const s of nameSet) {
                    this.codeGenerator.addToArray(arrayObject, factory.variableDeclaratorNode(factory.identifierNode(s) as any, null));
                }
                utils.insertNodeToBody(factory.variableDeclarationNode(arrayObject as any, "let") as any, programNode);
            }
        }
        factory.addComment(programNode, builder.join(""));

        if (!pandaLexical.has(funcMain0Method)) {
            // func_main_0 反汇编失败(如 jeq/jne 家族指令未实现):输出失败标记,由上层降级为空输出
            return "//decompile failed: func_main_0 disassembly failed";
        }
        const pandaIRCFG = pandaLexical.getPandaIRCFG(funcMain0Method);
        this.decompileSingleFunction(pandaIRCFG, pandaLexical, programNode);

        // exports
        if (pandaClass.pandaClassModuleData) {
            for (const exp of pandaClass.pandaClassModuleData.exports) {
                let exportNode: any = null;
                switch (exp.type) {
                    case ExportType.ALL:
                        exportNode = factory.exportAllDeclarationNode(exp.path!);
                        break;
                    case ExportType.INDIRECT:
                        if (exp.exportName === "default") {
                            exportNode = factory.exportNamedDeclarationNode(factory.exportDefaultSpecifierNode(exp.localName!) as any, exp.path);
                        } else {
                            exportNode = factory.exportNamedDeclarationNode(factory.exportSpecifierNode(exp.localName!, exp.exportName!), exp.path);
                        }
                        break;
                    case ExportType.LOCAL: {
                        if (exp.exportName === "default") {
                            exportNode = factory.exportDefaultDeclarationNode(exp.localName!);
                        } else {
                            exportNode = factory.exportNamedDeclarationNode(factory.exportSpecifierNode(exp.localName!, exp.exportName!), exp.path);
                        }
                        break;
                    }
                }
                if (exportNode) utils.insertNodeToBody(exportNode, programNode);
            }
        }
        return utils.toJson(programNode);
    }

    /**
     * 空模块判定:类记录只有一个方法 func_main_0,且其字节码仅有一条 returnundefined。
     * 接口/纯类型源文件被 ArkTS 编译时擦除,但仍会生成类记录承载模块元数据
     * (pkgName / isCommonjs / hasTopLevelAwait / isSharedModule / moduleRecordIdx 字段),
     * 此时反编译输出只有头注释,需要显式标注。
     */
    private isEmptyModuleRecord(pandaClass: PandaClass, pandaLexical: PandaLexical, funcMain0Method: PandaMethod): boolean {
        if (pandaClass.pandaMethods.size !== 1) return false;
        if (!pandaLexical.has(funcMain0Method)) return false;
        const blocks = pandaLexical.getPandaIRCFG(funcMain0Method).pandaIRBasicBlocks;
        if (blocks.length !== 1) return false;
        const instructions = blocks[0].pandaInstructions;
        return instructions.length === 1 && instructions[0].isReturnIns();
    }

    private decompileSingleFunction(pandaIRCFG: any, pandaLexical: PandaLexical, programNode: any): void {
        this.methodHandler.insertFunctionPreamble(pandaIRCFG.getPandaMethod(), pandaLexical, programNode);
        try {
            new StructureAnalysis(pandaIRCFG, pandaIRCFG.getEntryBlock(), pandaIRCFG.getLastBlock())
                .analysis(this.methodHandler, pandaLexical, programNode);
        } catch (e) {
            new SimpleAnalysis(pandaIRCFG).analysis(this.methodHandler, pandaLexical, programNode);
        }
    }

    /** 进程内 simplify(取代 Java 外部 node cmd.js 进程);解析失败时返回 ""(与 Java 行为对齐) */
    simplifyInProcess(astJson: string): string {
        let program: any;
        try {
            program = JSON.parse(astJson);
        } catch (e) {
            return "";
        }
        SimplifyExport.simplify(program);
        return NodeFactory.generate(program);
    }

    /** 单类反编译 + simplify */
    decompileClass(pandaClass: PandaClass): string {
        const out = this.decompileRaw(pandaClass);
        if (out.length === 0) return "";
        return this.simplifyInProcess(out);
    }

    /** 单类反编译(不 simplify) */
    decompileClassRaw(pandaClass: PandaClass): string {
        const out = this.decompileClassAst(pandaClass);
        if (out.length === 0) return "";
        const object = JSON.parse(out);
        return NodeFactory.generate(object);
    }

    /**
     * 单类 AST JSON(不做 simplify)。
     * 拆出该步骤是为了让 simplify 能在 worker 线程执行:AST JSON 自包含,可跨线程传递。
     * 无 func_main_0 或反汇编失败时返回 ""。
     */
    decompileClassAst(pandaClass: PandaClass): string {
        const out = this.decompileRaw(pandaClass);
        if (out.length === 0) return "";
        if (out === "//no function main..." || out.startsWith("//decompile failed")) return "";
        return out;
    }

    /** 全文件反编译(带 simplify),返回按类分段的结果 */
    decompile(pandaFile: PandaFile): string[] {
        const results: string[] = [];
        for (const pandaClass of pandaFile.getAllClasses()) {
            const out = this.decompileClass(pandaClass);
            if (out.length === 0) continue;
            results.push("\n/***************************" + pandaClass.name.content + "*************************************/\n" + out);
        }
        return results;
    }

    /** 全文件反编译(不 simplify) */
    decompileRawAll(pandaFile: PandaFile): string[] {
        const results: string[] = [];
        for (const pandaClass of pandaFile.getAllClasses()) {
            const content = this.decompileClassRaw(pandaClass);
            if (content.length === 0) continue;
            results.push("\n/***************************" + pandaClass.name.content + "*************************************/\n" + content);
        }
        return results;
    }
}
