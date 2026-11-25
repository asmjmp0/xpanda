import type { PandaClass } from "@asm-xpanda/core";
import type { AbcSession } from "./registry";
import { isStaticSession, staticClassSource } from "./staticDecompile";

/**
 * 单类源码缓存:动态会话用 LRU Map,static 会话复用文件级输出缓存。
 * @Author: jmp0
 */

export const MAX_DECOMPILE_CACHE = 4;
export const MAX_SEARCH_CACHE = 128;

export function sourceCacheKey(clazz: PandaClass, simplify: boolean): string {
    return clazz.name.content + "|" + (simplify ? "1" : "0");
}

/** 取单类源码(必要时反编译并写入指定缓存) */
export function getClassSource(
    session: AbcSession,
    clazz: PandaClass,
    simplify: boolean,
    cache: Map<string, string> = session.decompiles,
    limit = MAX_DECOMPILE_CACHE,
): string {
    if (isStaticSession(session)) return staticClassSource(session, clazz, simplify);
    const key = sourceCacheKey(clazz, simplify);
    const hit = cache.get(key);
    if (hit !== undefined) {
        cache.delete(key);
        cache.set(key, hit);
        return hit;
    }
    const content = simplify
        ? session.decompiler.decompileClass(clazz)
        : session.decompiler.decompileClassRaw(clazz);
    cache.set(key, content);
    while (cache.size > limit) {
        const oldest = cache.keys().next().value as string;
        cache.delete(oldest);
    }
    return content;
}

/** 该类在当前 simplify 设置下是否已有缓存 */
export function hasClassSource(
    session: AbcSession,
    clazz: PandaClass,
    simplify: boolean,
    cache: Map<string, string> = session.decompiles,
): boolean {
    if (isStaticSession(session)) {
        return session.staticOutputs.get(simplify ? "1" : "0")?.has(clazz.name.content) ?? false;
    }
    return cache.has(sourceCacheKey(clazz, simplify));
}
