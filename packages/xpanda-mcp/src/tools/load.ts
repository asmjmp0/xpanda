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
        title: "加载 .abc / .hap 文件",
        description: "解析鸿蒙 HarmonyOS 文件,支持两种输入:.abc(Panda 字节码)与 .hap(应用包 ZIP 容器)。"
            + "返回的 fileId 是后续所有工具的必填参数;同一文件重复加载会复用已解析会话。"
            + "加载 .hap 时返回 kind=\"hap\" 与包内 .abc 条目清单,用 hap_read_abc 解出后即可使用全部 abc_* 工具;"
            + "hap_resources 可直接查询包内资源表。",
        inputSchema: {
            path: z.string().describe(".abc 或 .hap 文件路径(绝对路径或相对当前目录)"),
        },
    }, async ({ path }) => {
        try {
            const { session, cached } = registry.load(path);
            if (session.kind === "hap") {
                const app = session.moduleJson?.app ?? {};
                const module = session.moduleJson?.module ?? {};
                return jsonResult({
                    kind: "hap",
                    fileId: session.fileId,
                    path: session.path,
                    cached,
                    bundleName: app.bundleName ?? null,
                    moduleName: module.name ?? null,
                    versionName: app.versionName ?? null,
                    virtualMachine: module.virtualMachine ?? null,
                    fileSizeBytes: require("fs").statSync(session.path).size,
                    abcEntries: session.abcEntries,
                    resourceItemCount: session.resourceItemCount,
                    hint: "hap_read_abc 把 .abc 条目解出为 abc 会话(返回 abcFileId);hap_resources 查询资源表。",
                });
            }
            const header = session.pandaFile.header;
            const classNames = session.pandaFile.getAllClasses().map((c) => demangleClassName(c.name.content));
            const preview = classNames.slice(0, 100);
            return jsonResult({
                kind: "abc",
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
        title: "关闭会话",
        description: "释放已加载会话(abc 或 hap)的内存。处理完一个文件后建议关闭。",
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
