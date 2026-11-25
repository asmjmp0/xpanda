import { collectSourceReferences, type PandaClass, type SourceReference } from "@asm-xpanda/core";
import { demangleClassName } from "./nameutil";
import type { AbcSession } from "./registry";
import { getClassSource, MAX_SEARCH_CACHE } from "./sourceCache";

/**
 * 动态字节码的调用目标在寄存器/累加器里,指令操作数拿不到直接方法 id。
 * 这里对反编译后的源码做引用收集,供 abc_call_graph 与 abc_xrefs(source=true) 使用。
 * @Author: jmp0
 */

export function sourceRefsKey(clazz: PandaClass, simplify: boolean): string {
    return clazz.name.content + "|" + (simplify ? "1" : "0");
}

export function getSourceReferences(session: AbcSession, clazz: PandaClass, simplify: boolean): SourceReference[] {
    const key = sourceRefsKey(clazz, simplify);
    const cached = session.sourceRefs.get(key);
    if (cached) return cached;
    const source = getClassSource(session, clazz, simplify, session.searchSources, MAX_SEARCH_CACHE);
    const refs = source ? collectSourceReferences(source, clazz.name.content) : [];
    session.sourceRefs.set(key, refs);
    return refs;
}

/** 源码类名(通常只保留最后一段,去掉 & 包装) */
export function sourceClassName(rawName: string): string {
    const demangled = demangleClassName(rawName);
    const last = demangled.substring(demangled.lastIndexOf("/") + 1);
    return last.replace(/^&+/, "").replace(/&+$/, "");
}

/**
 * 源码类名 → 实际类记录。同名类可能来自不同包,冲突时视为不可解析,
 * 避免把 `Foo.bar()` 错误连到另一个包的同名 Foo。
 */
export function sourceClassMap(session: AbcSession): Map<string, string> {
    const map = new Map<string, string>();
    const ambiguous = new Set<string>();
    for (const clazz of session.pandaFile.getAllClasses()) {
        const raw = clazz.name.content;
        const names = new Set<string>([
            raw,
            demangleClassName(raw),
            sourceClassName(raw),
        ]);
        for (const name of names) {
            if (!name) continue;
            const existing = map.get(name);
            if (existing && existing !== raw) {
                ambiguous.add(name);
                continue;
            }
            map.set(name, raw);
        }
    }
    for (const name of ambiguous) map.delete(name);
    return map;
}

export function resolveSourceOwner(map: Map<string, string>, owner: string | undefined): string | undefined {
    if (!owner) return undefined;
    return map.get(owner) ?? map.get(sourceClassName(owner));
}

export function hasCode(clazz: PandaClass): boolean {
    for (const method of clazz.pandaMethods.values()) {
        if (method.methodCode) return true;
    }
    return false;
}

/** 方法名在反编译源码中的可能形态(raw 前缀被 sanitize 掉 / constructor) */
export function methodNameVariants(methodName: string): Set<string> {
    const variants = new Set<string>([methodName]);
    const stripped = methodName
        .replace(/^#~@\d+>#/, "")
        .replace(/^#~@\d+=#/, "")
        .replace(/^#\*#/, "")
        .replace(/^%%(get|set)-/, "");
    variants.add(stripped);
    if (methodName === "<ctor>") variants.add("constructor");
    if (methodName === "constructor") variants.add("<ctor>");
    return variants;
}

/** 有代码的类(源码级引用扫描范围) */
export function sourceClasses(session: AbcSession): PandaClass[] {
    return session.pandaFile.getAllClasses().filter(hasCode);
}

/** 扫描指定数量的类,收集源码级引用 */
export function allSourceReferences(
    session: AbcSession,
    simplify: boolean,
    maxClasses: number,
): { refs: SourceReference[]; scannedClasses: number; truncatedClasses: boolean } {
    const classes = sourceClasses(session);
    const selected = classes.slice(0, Math.max(1, maxClasses));
    const refs: SourceReference[] = [];
    for (const clazz of selected) {
        try {
            refs.push(...getSourceReferences(session, clazz, simplify));
        } catch {
            // 单类反编译失败不影响整体扫描
        }
    }
    return {
        refs,
        scannedClasses: selected.length,
        truncatedClasses: selected.length < classes.length,
    };
}
