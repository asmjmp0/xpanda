import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { demangleClassName } from "../nameutil";
import type { Registry } from "../registry";
import { errorResult, jsonResult } from "./util";

/**
 * abc_load / abc_close:会话生命周期管理
 * @Author: jmp0
 */
export function registerLoadTools(server: McpServer, registry: Registry): void {
    server.registerTool("abc_load", {
        title: "加载 .abc 文件",
        description: "解析鸿蒙 HarmonyOS .abc(Panda 字节码)文件,返回文件头信息与类列表预览。"
            + "返回的 fileId 是后续所有工具的必填参数;同一文件重复加载会复用已解析会话。",
        inputSchema: {
            path: z.string().describe(".abc 文件路径(绝对路径或相对当前目录)"),
        },
    }, async ({ path }) => {
        try {
            const { session, cached } = registry.load(path);
            const header = session.pandaFile.header;
            const classNames = session.pandaFile.getAllClasses().map((c) => demangleClassName(c.name.content));
            const preview = classNames.slice(0, 100);
            return jsonResult({
                fileId: session.fileId,
                path: session.path,
                cached,
                bytecodeVersion: Array.from(header.version).join("."),
                checksum: "0x" + (header.checksum >>> 0).toString(16),
                fileSizeBytes: session.pandaFile.data.byteLength,
                classCount: classNames.length,
                foreignClassCount: session.pandaFile.foreignPandaClasses.length,
                lnpCount: session.pandaFile.lnpOffsets.length,
                classesPreview: preview,
                previewTruncated: classNames.length > preview.length,
                hint: "使用 abc_list_classes 分页浏览全部类;abc_decompile_class 反编译单个类。",
            });
        } catch (e) {
            return errorResult(e);
        }
    });

    server.registerTool("abc_close", {
        title: "关闭 .abc 会话",
        description: "释放已加载的 .abc 会话内存。处理完一个文件后建议关闭。",
        inputSchema: {
            fileId: z.string().describe("abc_load 返回的文件 ID"),
        },
    }, async ({ fileId }) => {
        try {
            const removed = registry.close(fileId);
            return jsonResult({ fileId, closed: removed });
        } catch (e) {
            return errorResult(e);
        }
    });
}
