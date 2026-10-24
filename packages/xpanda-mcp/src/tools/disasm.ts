import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PandaParseException } from "xpanda-core";
import { findClass } from "../nameutil";
import type { Registry } from "../registry";
import { errorResult, textResult, truncateText } from "./util";

/**
 * abc_disassemble_method:方法级反汇编
 * 反编译降级(输出 decompiler_goto)或需核对字节码时使用。
 * @Author: jmp0
 */

export function registerDisasmTools(server: McpServer, registry: Registry): void {
    server.registerTool("abc_disassemble_method", {
        title: "反汇编方法",
        description: "输出单个方法的字节码反汇编(按基本块分组,含 pc、指令、操作数、跳转目标、try/catch 归属)。"
            + "methodName 缺省时反汇编类入口 func_main_0。"
            + "注意:包含 jeq/jne 等未实现跳转指令的方法无法反汇编(反编译器对该类方法同样走降级路径)。",
        inputSchema: {
            fileId: z.string().describe("abc_load 返回的文件 ID"),
            className: z.string().describe('类名,如 "Lpkg/Name;" 或 "pkg/Name"'),
            methodName: z.string().optional().describe('方法名,缺省为类入口 "func_main_0"'),
            maxInstructions: z.number().int().min(1).max(5000).optional().describe("最大输出指令数,默认 1500"),
        },
    }, async ({ fileId, className, methodName, maxInstructions }) => {
        try {
            const session = registry.get(fileId);
            const clazz = findClass(session.pandaFile, className);
            const name = methodName ?? "func_main_0";
            const method = clazz.pandaMethods.get(name);
            if (!method) {
                const names = Array.from(clazz.pandaMethods.keys());
                throw new Error("方法未找到: " + name
                    + "\n类 " + clazz.name.content + " 中的方法: \n - " + names.join("\n - "));
            }
            if (method.methodExternal) {
                throw new Error("方法是 external(外部引用),没有指令体: " + name);
            }

            let cfg;
            try {
                cfg = method.disAssemble();
            } catch (e) {
                if (e instanceof PandaParseException) {
                    throw new Error("反汇编失败: " + e.message
                        + "\n该方法包含未实现的指令(通常是 jeq/jne/jstricteq/jnstricteq 家族),"
                        + "反编译器对该方法同样会降级为线性输出。");
                }
                throw e;
            }
            if (!cfg) throw new Error("方法没有指令体: " + name);

            const code = method.methodCode!;
            const cap = maxInstructions ?? 1500;
            const lines: string[] = [];
            let count = 0;
            let truncated = false;

            lines.push("method: " + name
                + "  vregs=" + code.numVregs + " args=" + code.numArgs
                + "  blocks=" + cfg.pandaIRBasicBlocks.length);
            for (const block of cfg.pandaIRBasicBlocks) {
                if (count >= cap) { truncated = true; break; }
                lines.push("");
                lines.push(block.name
                    + (block.catchBlockList ? "  catch by [" + block.catchBlockList.map((b) => b.name).join(", ") + "]" : "")
                    + ":");
                for (const ins of block.pandaInstructions) {
                    if (count >= cap) { truncated = true; break; }
                    lines.push("\t" + ins.toString());
                    count++;
                }
            }
            if (truncated) {
                lines.push("\n/* ...已按 maxInstructions=" + cap + " 截断,可调大参数继续 */");
            }
            const { text } = truncateText(lines.join("\n"), 200_000);
            return textResult(text);
        } catch (e) {
            return errorResult(e);
        }
    });
}
