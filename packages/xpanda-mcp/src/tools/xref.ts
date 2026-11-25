import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { XrefIndex, type SourceReference, type Xref } from "@asm-xpanda/core";
import { demangleClassName, findClass } from "../nameutil";
import type { AbcSession, Registry } from "../registry";
import { isStaticSession } from "../staticDecompile";
import {
    allSourceReferences,
    getSourceReferences,
    methodNameVariants,
    resolveSourceOwner,
    sourceClassMap,
    sourceClassName,
} from "../sourceRefs";
import { errorResult, jsonResult } from "./util";

/**
 * abc_xrefs / abc_call_graph:交叉引用与调用图
 * @Author: jmp0
 */

const MAX_CALL_GRAPH_NODES = 1000;

interface GraphNode {
    id: string;
    classRaw: string;
    className: string;
    method: string;
    depth: number;
    via: Array<"callers" | "callees" | "root">;
}

interface GraphEdge {
    from: string;
    to: string;
    kind: string;
}

function nodeId(classRaw: string | undefined, method: string): string {
    return demangleClassName(classRaw ?? "?") + "#" + method;
}

function displayXref(ref: Xref): Record<string, unknown> {
    return {
        fromClass: demangleClassName(ref.fromClass),
        fromClassRaw: ref.fromClass,
        fromMethod: ref.fromMethod,
        pc: ref.fromPC,
        opcode: ref.opcode,
        kind: ref.kind,
        targetType: ref.targetType,
        targetName: ref.targetType === "class" ? demangleClassName(ref.targetName) : ref.targetName,
        targetClass: ref.targetOwner ? demangleClassName(ref.targetOwner) : null,
        targetClassRaw: ref.targetOwner ?? null,
    };
}

function displaySourceRef(ref: SourceReference, classMap: Map<string, string>): Record<string, unknown> {
    const targetOwner = resolveSourceOwner(classMap, ref.targetOwner) ?? ref.targetOwner ?? null;
    return {
        fromClass: demangleClassName(ref.fromClass),
        fromClassRaw: ref.fromClass,
        fromMethod: ref.fromMethod,
        line: ref.line,
        pc: null,
        opcode: "source",
        kind: ref.kind,
        targetType: ref.targetType,
        targetName: ref.targetType === "class" ? demangleClassName(ref.targetName) : ref.targetName,
        targetClass: targetOwner ? demangleClassName(targetOwner) : null,
        targetClassRaw: targetOwner ?? null,
        origin: "source",
    };
}

/** 把类名参数解析成文件中的实际类记录(支持 mangled / demangled) */
function resolveClass(session: AbcSession, className: string): string {
    return findClass(session.pandaFile, className).name.content;
}

/** 方法名支持 constructor / <ctor> 等源码名映射 */
function resolveMethodName(session: AbcSession, classRaw: string, methodName: string): string {
    const clazz = findClass(session.pandaFile, classRaw);
    if (clazz.pandaMethods.has(methodName)) return methodName;
    if (methodName === "constructor" && clazz.pandaMethods.has("<ctor>")) return "<ctor>";
    if (methodName === "<ctor>" && clazz.pandaMethods.has("constructor")) return "constructor";
    return methodName;
}

function xrefIndex(session: AbcSession): XrefIndex {
    if (!session.xrefIndex) session.xrefIndex = XrefIndex.build(session.pandaFile);
    return session.xrefIndex;
}

interface CallRef {
    targetOwner?: string;
    targetName: string;
    fromClass: string;
    fromMethod: string;
    kind: string;
    line?: number;
}

interface CallProvider {
    calleesOf(ownerClass: string, methodName: string): CallRef[];
    callersOf(ownerClass: string, methodName: string): CallRef[];
    failureCount: number;
    truncatedClasses: boolean;
}

/** 静态字节码的方法引用是精确的,直接使用 XrefIndex。 */
function staticCallProvider(session: AbcSession): CallProvider {
    const index = xrefIndex(session);
    return {
        calleesOf: (ownerClass, methodName) => index.calleesOf(ownerClass, methodName),
        callersOf: (ownerClass, methodName) => index.callersOf(ownerClass, methodName),
        failureCount: index.failureCount,
        truncatedClasses: false,
    };
}

/**
 * 动态字节码的 call 指令把函数对象放在累加器里,方法 id 不在操作数中。
 * 因此用反编译源码的调用表达式构建调用关系;owner 可解析时映射回类记录。
 */
function dynamicCallProvider(session: AbcSession, simplify: boolean, maxClasses: number): CallProvider {
    const classMap = sourceClassMap(session);
    let allRefs: SourceReference[] | null = null;
    let truncatedClasses = false;

    const ensureAll = (): SourceReference[] => {
        if (!allRefs) {
            const result = allSourceReferences(session, simplify, maxClasses);
            allRefs = result.refs;
            truncatedClasses = result.truncatedClasses;
        }
        return allRefs;
    };

    const refsForClass = (classRaw: string): SourceReference[] => {
        try {
            const clazz = findClass(session.pandaFile, classRaw);
            return getSourceReferences(session, clazz, simplify);
        } catch {
            return [];
        }
    };

    const resolvedOwner = (ref: SourceReference): string | undefined => {
        const mapped = resolveSourceOwner(classMap, ref.targetOwner);
        return mapped ?? ref.targetOwner;
    };

    return {
        calleesOf: (ownerClass, methodName) => {
            const result: CallRef[] = [];
            const variants = methodNameVariants(methodName);
            for (const ref of refsForClass(ownerClass)) {
                if (ref.fromClass !== ownerClass || !variants.has(ref.fromMethod)) continue;
                if (ref.targetType !== "method") continue;
                if (ref.kind !== "call" && ref.kind !== "new") continue;
                result.push({
                    targetOwner: resolvedOwner(ref),
                    targetName: ref.targetName,
                    fromClass: ref.fromClass,
                    fromMethod: ref.fromMethod,
                    kind: ref.kind,
                    line: ref.line,
                });
            }
            return result;
        },
        callersOf: (ownerClass, methodName) => {
            const result: CallRef[] = [];
            const variants = methodNameVariants(methodName);
            for (const ref of ensureAll()) {
                if (ref.targetType !== "method" || !variants.has(ref.targetName)) continue;
                const owner = resolveSourceOwner(classMap, ref.targetOwner);
                if (owner !== ownerClass) continue;
                result.push({
                    targetOwner: ownerClass,
                    targetName: methodName,
                    fromClass: ref.fromClass,
                    fromMethod: ref.fromMethod,
                    kind: ref.kind,
                    line: ref.line,
                });
            }
            return result;
        },
        failureCount: 0,
        get truncatedClasses() { return truncatedClasses; },
    };
}

function callProvider(session: AbcSession, simplify: boolean, maxClasses: number): CallProvider {
    return isStaticSession(session)
        ? staticCallProvider(session)
        : dynamicCallProvider(session, simplify, maxClasses);
}

export function registerXrefTools(server: McpServer, registry: Registry): void {
    server.registerTool("abc_xrefs", {
        title: "查询交叉引用",
        description: "查找类 / 方法 / 字段 / 字符串被哪些类、方法、pc 引用。"
            + "动态 .abc 的字段引用来自属性名指令(owner 可能未知),static .abc 还能解析字段/类 id。"
            + "方法/字段可通过 ownerClass 缩小范围;结果分页返回。",
        inputSchema: {
            fileId: z.string().describe("abc_load 返回的文件 ID"),
            targetType: z.enum(["class", "method", "field", "string"]).describe("引用目标类型"),
            target: z.string().describe("目标名(类名可 mangled/demangled;字符串按精确内容匹配)"),
            ownerClass: z.string().optional().describe("方法/字段的所属类(可选;不传则匹配所有类)"),
            source: z.boolean().optional().describe("动态 .abc 额外扫描反编译源码的调用点(默认 false;方法/类调用建议开启)"),
            maxClasses: z.number().int().min(1).max(1000).optional().describe("source=true 时最多扫描的类数,默认 200"),
            offset: z.number().int().min(0).optional().describe("起始索引,默认 0"),
            limit: z.number().int().min(1).max(500).optional().describe("每页数量,默认 50"),
        },
    }, async ({ fileId, targetType, target, ownerClass, source, maxClasses, offset, limit }) => {
        try {
            const session = registry.get(fileId);
            const index = xrefIndex(session);
            const ownerRaw = ownerClass ? findClass(session.pandaFile, ownerClass).name.content : undefined;
            const merged: Array<Record<string, unknown>> = index
                .referencesTo(targetType, target, ownerRaw ?? ownerClass)
                .map((ref) => ({ ...displayXref(ref), origin: "bytecode" }));

            const classMap = sourceClassMap(session);
            let sourceScannedClasses = 0;
            let sourceTruncatedClasses = false;
            if (source === true && targetType !== "string") {
                const scan = allSourceReferences(session, true, maxClasses ?? 200);
                sourceScannedClasses = scan.scannedClasses;
                sourceTruncatedClasses = scan.truncatedClasses;
                const targetRaw = targetType === "class"
                    ? (() => { try { return findClass(session.pandaFile, target).name.content; } catch { return undefined; } })()
                    : undefined;
                const methodVariants = targetType === "method" ? methodNameVariants(target) : null;
                for (const ref of scan.refs) {
                    if (ref.targetType !== targetType) continue;
                    if (targetType === "method" || targetType === "field") {
                        if (targetType === "method" ? !methodVariants!.has(ref.targetName) : ref.targetName !== target) continue;
                        if (ownerRaw && resolveSourceOwner(classMap, ref.targetOwner) !== ownerRaw) continue;
                    } else {
                        const refClass = resolveSourceOwner(classMap, ref.targetName)
                            ?? resolveSourceOwner(classMap, ref.targetOwner)
                            ?? ref.targetName;
                        if (targetRaw) {
                            if (refClass !== targetRaw) continue;
                        } else if (sourceClassName(refClass) !== sourceClassName(target)) {
                            continue;
                        }
                    }
                    merged.push(displaySourceRef(ref, classMap));
                }
            }

            // 去重:同一调用点可能同时被字节码与源码命中
            const seen = new Set<string>();
            const unique = merged.filter((entry) => {
                const key = JSON.stringify(entry);
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
            const pageOffset = Math.max(0, offset ?? 0);
            const pageLimit = Math.max(1, limit ?? 50);
            const page = unique.slice(pageOffset, pageOffset + pageLimit);
            const hint = isStaticSession(session)
                ? "static 字节码的方法/字段/类引用来自精确指令操作数。"
                : (targetType === "method" || targetType === "class")
                    ? (source === true
                        ? "已合并反编译源码调用点;dynamic 字节码的 call 目标是间接的,源码扫描可能遗漏间接调用。"
                        : "dynamic 字节码的 call 目标在累加器中,字节码 xref 只能看到方法定义;传 source=true 可扫描反编译源码的调用点。")
                    : "dynamic 字段引用来自属性名指令(owner 可能未知),字符串引用来自字面量/全局名。";

            return jsonResult({
                fileId,
                targetType,
                target,
                targetOwner: ownerClass ?? null,
                total: unique.length,
                offset: pageOffset,
                limit: pageLimit,
                returned: page.length,
                truncated: pageOffset + page.length < unique.length || sourceTruncatedClasses,
                sourceScannedClasses,
                sourceTruncatedClasses,
                xrefCount: index.xrefCount,
                disassemblyFailures: index.failureCount,
                matches: page,
                hint,
            });
        } catch (e) {
            return errorResult(e);
        }
    });

    server.registerTool("abc_call_graph", {
        title: "调用图 / 调用者 / 被调用者",
        description: "基于字节码 xref 构建调用关系:direction=callers 查谁调用了目标方法,"
            + "callees 查目标调用了谁,both 同时展开。depth 控制层数,maxNodes 防止图过大;"
            + "format=mermaid 时额外返回可直接渲染的 Mermaid 图。",
        inputSchema: {
            fileId: z.string().describe("abc_load 返回的文件 ID"),
            className: z.string().describe('类名,如 "Lpkg/Name;" 或 "pkg/Name"'),
            methodName: z.string().describe('方法名,如 "onCreate" / "constructor"'),
            direction: z.enum(["callers", "callees", "both"]).optional().describe("展开方向,默认 both"),
            depth: z.number().int().min(1).max(5).optional().describe("展开层数,默认 2"),
            maxNodes: z.number().int().min(1).max(MAX_CALL_GRAPH_NODES).optional().describe("最大节点数,默认 200"),
            maxClasses: z.number().int().min(1).max(1000).optional().describe("动态源码扫描/调用者搜索最多扫描的类数,默认 200"),
            simplify: z.boolean().optional().describe("动态源码扫描是否使用优化后的源码,默认 true"),
            format: z.enum(["json", "mermaid"]).optional().describe("额外返回的图格式,默认 json"),
        },
    }, async ({ fileId, className, methodName, direction, depth, maxNodes, maxClasses, simplify, format }) => {
        try {
            const session = registry.get(fileId);
            const classRaw = resolveClass(session, className);
            const actualMethod = resolveMethodName(session, classRaw, methodName);
            const provider = callProvider(session, simplify ?? true, maxClasses ?? 200);
            const dir = direction ?? "both";
            const levels = depth ?? 2;
            const nodeCap = maxNodes ?? 200;

            const nodes = new Map<string, GraphNode>();
            const edges = new Map<string, GraphEdge>();
            let truncated = false;

            const addNode = (classRawName: string, method: string, level: number,
                via: "callers" | "callees" | "root"): GraphNode | null => {
                const id = nodeId(classRawName, method);
                const existing = nodes.get(id);
                if (existing) {
                    if (!existing.via.includes(via)) existing.via.push(via);
                    if (level < existing.depth) existing.depth = level;
                    return existing;
                }
                if (nodes.size >= nodeCap) {
                    truncated = true;
                    return null;
                }
                const node: GraphNode = {
                    id,
                    classRaw: classRawName,
                    className: demangleClassName(classRawName),
                    method,
                    depth: level,
                    via: [via],
                };
                nodes.set(id, node);
                return node;
            };

            const addEdge = (from: string, to: string, kind: string): void => {
                const key = from + "\u0000" + to + "\u0000" + kind;
                if (edges.has(key)) return;
                edges.set(key, { from, to, kind });
            };

            const root = addNode(classRaw, actualMethod, 0, "root");
            const visitedCallers = new Set<string>([nodeId(classRaw, actualMethod)]);
            const visitedCallees = new Set<string>([nodeId(classRaw, actualMethod)]);

            const expandCallees = (): void => {
                let frontier = [{ classRaw, method: actualMethod, depth: 0, id: root?.id ?? nodeId(classRaw, actualMethod) }];
                for (let level = 0; level < levels && frontier.length > 0 && !truncated; level++) {
                    const next: typeof frontier = [];
                    for (const current of frontier) {
                        for (const ref of provider.calleesOf(current.classRaw, current.method)) {
                            const targetId = nodeId(ref.targetOwner, ref.targetName);
                            const added = addNode(ref.targetOwner ?? "?", ref.targetName, level + 1, "callees");
                            if (!added) break;
                            addEdge(current.id, targetId, ref.kind);
                            if (!visitedCallees.has(targetId)) {
                                visitedCallees.add(targetId);
                                next.push({
                                    classRaw: ref.targetOwner ?? "?",
                                    method: ref.targetName,
                                    depth: level + 1,
                                    id: targetId,
                                });
                            }
                        }
                        if (truncated) break;
                    }
                    frontier = next;
                }
            };

            const expandCallers = (): void => {
                let frontier = [{ classRaw, method: actualMethod, depth: 0, id: root?.id ?? nodeId(classRaw, actualMethod) }];
                for (let level = 0; level < levels && frontier.length > 0 && !truncated; level++) {
                    const next: typeof frontier = [];
                    for (const current of frontier) {
                        for (const ref of provider.callersOf(current.classRaw, current.method)) {
                            const callerId = nodeId(ref.fromClass, ref.fromMethod);
                            const added = addNode(ref.fromClass, ref.fromMethod, level + 1, "callers");
                            if (!added) break;
                            addEdge(callerId, current.id, ref.kind);
                            if (!visitedCallers.has(callerId)) {
                                visitedCallers.add(callerId);
                                next.push({
                                    classRaw: ref.fromClass,
                                    method: ref.fromMethod,
                                    depth: level + 1,
                                    id: callerId,
                                });
                            }
                        }
                        if (truncated) break;
                    }
                    frontier = next;
                }
            };

            if (dir === "callees" || dir === "both") expandCallees();
            if (dir === "callers" || dir === "both") expandCallers();

            const nodeList = Array.from(nodes.values());
            const edgeList = Array.from(edges.values());
            const mermaid = buildMermaid(nodeList, edgeList);
            return jsonResult({
                fileId,
                root: {
                    class: demangleClassName(classRaw),
                    classRaw,
                    method: actualMethod,
                },
                direction: dir,
                depth: levels,
                nodeCount: nodeList.length,
                edgeCount: edgeList.length,
                truncated,
                disassemblyFailures: provider.failureCount,
                sourceTruncatedClasses: provider.truncatedClasses,
                nodes: nodeList,
                edges: edgeList,
                ...(format === "mermaid" ? { mermaid } : {}),
            });
        } catch (e) {
            return errorResult(e);
        }
    });
}

function buildMermaid(nodes: GraphNode[], edges: GraphEdge[]): string {
    const ids = new Map<string, string>();
    nodes.forEach((node, index) => ids.set(node.id, "n" + index));
    const lines = ["graph LR"];
    for (const node of nodes) {
        const label = (node.className + "." + node.method).replace(/"/g, "#quot;");
        lines.push("  " + ids.get(node.id) + "[\"" + label + "\"]");
    }
    for (const edge of edges) {
        const from = ids.get(edge.from);
        const to = ids.get(edge.to);
        if (from && to) lines.push("  " + from + " --> " + to);
    }
    return lines.join("\n");
}
