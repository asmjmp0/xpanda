import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PandaClass } from "../../file/clazz/PandaClass";
import { PandaRawType, rawTypeString } from "../../file/desc/enums";
import { demangleClassName, findClass } from "../nameutil";
import type { Registry } from "../registry";
import { errorResult, jsonResult } from "./util";

/**
 * abc_list_classes / abc_get_class:类浏览
 * @Author: jmp0
 */

function accessFlagsHex(flags: number): string {
    return "0x" + (flags >>> 0).toString(16);
}

/** 安全解析父类名(父类可指向 foreign/external 类,解析失败不致命) */
function resolveSuperClassName(clazz: PandaClass): string | null {
    try {
        if (!clazz.superClassOff || !clazz.superClassOff.isValid()) return null;
        // Offset.pandaFile 为 protected,MCP 层经断言访问(与核心解耦,不做修改)
        const pandaFile = (clazz as any).pandaFile;
        const superClass = PandaClass.create(pandaFile, clazz.superClassOff.getOffset(), clazz.indexHeader);
        return superClass.name ? superClass.name.content : null;
    } catch {
        return null;
    }
}

export function registerBrowseTools(server: McpServer, registry: Registry): void {
    server.registerTool("abc_list_classes", {
        title: "列出类",
        description: "分页列出 .abc 文件中的类(名称、方法数、字段数、是否 external),支持按子串过滤。",
        inputSchema: {
            fileId: z.string().describe("abc_load 返回的文件 ID"),
            filter: z.string().optional().describe("类名子串过滤(不区分大小写,匹配 demangled 名)"),
            offset: z.number().int().min(0).optional().describe("起始索引,默认 0"),
            limit: z.number().int().min(1).max(500).optional().describe("每页数量,默认 50"),
        },
    }, async ({ fileId, filter, offset, limit }) => {
        try {
            const session = registry.get(fileId);
            const all = session.pandaFile.getAllClasses();
            let list = all;
            if (filter && filter.length > 0) {
                const needle = filter.toLowerCase();
                list = all.filter((c) => demangleClassName(c.name.content).toLowerCase().includes(needle));
            }
            const start = offset ?? 0;
            const size = limit ?? 50;
            const page = list.slice(start, start + size).map((c) => ({
                name: demangleClassName(c.name.content),
                methods: c.numMethods,
                fields: c.numFields,
                external: c.classExternal,
            }));
            return jsonResult({
                fileId,
                total: all.length,
                filtered: list.length,
                offset: start,
                returned: page.length,
                truncated: start + page.length < list.length,
                classes: page,
            });
        } catch (e) {
            return errorResult(e);
        }
    });

    server.registerTool("abc_get_class", {
        title: "查看类元数据",
        description: "返回单个类的完整元数据:父类、字段表(含类型)、方法表(含 shorty 原型)、import/export 模块元数据。"
            + "类名接受 Lpkg/Name; 或 pkg/Name 两种形态。",
        inputSchema: {
            fileId: z.string().describe("abc_load 返回的文件 ID"),
            className: z.string().describe('类名,如 "Lpkg/Name;" 或 "pkg/Name"'),
        },
    }, async ({ fileId, className }) => {
        try {
            const session = registry.get(fileId);
            const clazz = findClass(session.pandaFile, className);

            const fields = (clazz.pandaFields ?? []).map((f) => ({
                name: f.name.content,
                type: f.pandaType ? rawTypeString(f.pandaType.rawType, true) : null,
                external: f.fieldExternal,
            }));

            const methods: Array<Record<string, unknown>> = [];
            for (const [name, m] of clazz.pandaMethods) {
                const shorty = m.pandaProto
                    ? m.pandaProto.pandaRawTypes.map((t) => rawTypeString(t, false))
                    : null;
                methods.push({
                    name,
                    accessFlags: accessFlagsHex(m.accessFlag),
                    external: m.methodExternal,
                    hasCode: m.methodCode != null,
                    hasTryCatch: m.hasException(),
                    shorty: shorty ? shorty[0] + " (" + shorty.slice(1).join(", ") + ")" : null,
                });
            }

            const moduleData = clazz.pandaClassModuleData;
            return jsonResult({
                fileId,
                name: demangleClassName(clazz.name.content),
                rawName: clazz.name.content,
                superClass: resolveSuperClassName(clazz),
                external: clazz.classExternal,
                accessFlags: accessFlagsHex(clazz.accessFlags),
                fields,
                methods,
                imports: moduleData
                    ? moduleData.imports.map((i) => ({
                        localName: i.localName,
                        importName: i.importName,
                        path: i.path,
                        kind: i.type,
                    }))
                    : [],
                exports: moduleData
                    ? moduleData.exports.map((e) => ({
                        localName: e.localName,
                        exportName: e.exportName,
                        path: e.path,
                        kind: e.type,
                    }))
                    : [],
            });
        } catch (e) {
            return errorResult(e);
        }
    });
}
