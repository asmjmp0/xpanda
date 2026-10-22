import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { demangleClassName } from "../nameutil";
import type { Registry } from "../registry";
import { ResourceIndexFile } from "../../res/ResourceIndexFile";
import { errorResult, jsonResult } from "./util";

/**
 * hap_read_abc / hap_resources:鸿蒙 HAP 应用包工具
 *   - hap_read_abc:把包内 .abc 条目解出为 abc 会话,后续用 abc_* 工具分析;
 *   - hap_resources:解析 resources.index,按名字/类型/限定词/ID 查询资源项。
 * @Author: jmp0
 */

const RESOURCE_PAGE_LIMIT = 200;

/** 解析 id 过滤参数:接受数字或 "0x" 十六进制字符串 */
function parseResourceId(raw: string): number | null {
    const text = raw.trim();
    if (/^-?\d+$/.test(text)) return Number(text);
    if (/^0x[0-9a-fA-F]+$/.test(text)) return Number.parseInt(text, 16);
    return null;
}

export function registerHapTools(server: McpServer, registry: Registry): void {
    server.registerTool("hap_read_abc", {
        title: "解出 HAP 内的 .abc",
        description: "从已加载的 .hap 应用包会话中解出指定 .abc 条目,注册为 abc 会话。"
            + "返回的 abcFileId 可用于全部 abc_* 工具(列类/反编译/字符串搜索等)。"
            + "包内只有一个 .abc 时 entry 可省略。",
        inputSchema: {
            fileId: z.string().describe("hap 会话的文件 ID(abc_load 加载 .hap 时返回)"),
            entry: z.string().optional().describe(".abc 条目名,如 \"ets/modules.abc\";省略时要求包内恰好一个 .abc 条目"),
        },
    }, async ({ fileId, entry }) => {
        try {
            const hapSession = registry.getHap(fileId);
            let entryName = entry;
            if (!entryName) {
                if (hapSession.abcEntries.length === 0) throw new Error("hap 中没有 .abc 条目");
                if (hapSession.abcEntries.length > 1) {
                    throw new Error("hap 中有 " + hapSession.abcEntries.length + " 个 .abc 条目,请用 entry 指定: "
                        + hapSession.abcEntries.map((e) => e.name).join(", "));
                }
                entryName = hapSession.abcEntries[0].name;
            }
            const { session, cached } = registry.loadAbcEntry(hapSession, entryName);
            const classNames = session.pandaFile.getAllClasses().map((c) => demangleClassName(c.name.content));
            return jsonResult({
                abcFileId: session.fileId,
                entry: entryName,
                cached,
                bytecodeVersion: Array.from(session.pandaFile.header.version).join("."),
                classCount: classNames.length,
                classesPreview: classNames.slice(0, 50),
                previewTruncated: classNames.length > 50,
                hint: "abcFileId 可用于 abc_list_classes / abc_decompile_class / abc_search_strings 等全部 abc_* 工具。",
            });
        } catch (e) {
            return errorResult(e);
        }
    });

    server.registerTool("hap_resources", {
        title: "查询 HAP 资源表",
        description: "解析 .hap 包内 resources.index(Restool/RestoolV2 格式),返回资源项"
            + "(id/name/type/limitKey/value),支持按名字子串、类型、限定词(base/dark/en_US…)与 ID 过滤,"
            + "并给出过滤后的类型/限定词分布汇总。",
        inputSchema: {
            fileId: z.string().describe("hap 会话的文件 ID(abc_load 加载 .hap 时返回)"),
            name: z.string().optional().describe("资源名子串过滤(大小写不敏感),如 \"app_name\""),
            type: z.string().optional().describe('资源类型精确过滤,如 "string" / "color" / "float" / "media" / "profile"'),
            limitKey: z.string().optional().describe('限定词精确过滤,如 "base" / "dark" / "en_US"'),
            id: z.string().optional().describe('资源 ID 过滤,接受 "0x03000003" 或十进制'),
            offset: z.number().optional().describe("分页起始(默认 0)"),
            limit: z.number().optional().describe("分页大小(默认 50,上限 " + RESOURCE_PAGE_LIMIT + ")"),
        },
    }, async ({ fileId, name, type, limitKey, id, offset, limit }) => {
        try {
            const hapSession = registry.getHap(fileId);
            const indexData = hapSession.hap.getResourcesIndexData();
            if (!indexData) throw new Error("hap 中没有 resources.index");
            const indexFile = new ResourceIndexFile(indexData);

            const idFilter = id ? parseResourceId(id) : null;
            if (id && idFilter === null) throw new Error("id 参数无效: " + id + ',应为 "0x03000003" 或十进制数字');
            const nameLower = name ? name.toLowerCase() : null;

            const matched = indexFile.items.filter((item) => {
                if (nameLower && !item.name.toLowerCase().includes(nameLower)) return false;
                if (type && item.typeName !== type) return false;
                if (limitKey && item.limitKey !== limitKey) return false;
                if (idFilter !== null && item.id !== idFilter) return false;
                return true;
            });

            const byType = new Map<string, number>();
            const byLimitKey = new Map<string, number>();
            for (const item of matched) {
                byType.set(item.typeName, (byType.get(item.typeName) ?? 0) + 1);
                byLimitKey.set(item.limitKey, (byLimitKey.get(item.limitKey) ?? 0) + 1);
            }

            const pageOffset = Math.max(0, offset ?? 0);
            const pageLimit = Math.min(Math.max(1, limit ?? 50), RESOURCE_PAGE_LIMIT);
            const page = matched.slice(pageOffset, pageOffset + pageLimit).map((item) => ({
                id: "0x" + item.id.toString(16).padStart(8, "0"),
                name: item.name,
                type: item.typeName,
                limitKey: item.limitKey,
                value: item.value,
            }));

            return jsonResult({
                fileId,
                format: indexFile.isNewModule ? "RestoolV2" : "Restool",
                version: indexFile.version,
                total: indexFile.items.length,
                matched: matched.length,
                byType: Object.fromEntries(byType),
                byLimitKey: Object.fromEntries(byLimitKey),
                offset: pageOffset,
                limit: pageLimit,
                items: page,
                truncated: pageOffset + page.length < matched.length,
            });
        } catch (e) {
            return errorResult(e);
        }
    });
}
