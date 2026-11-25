import { PandaClass, StaticPandaFile } from "@asm-xpanda/core";
import type { AbcSession } from "./registry";

/**
 * ArkTS-Sta (static runtime) 反编译辅助。
 *
 * StaticDecompiler 需要在文件级运行才能跨类还原编译器生成的 lambda
 * (lambda 类与调用方是不同的 class record),因此单类反编译也先从整份文件
 * 的渲染结果里取,并按 simplify 标志缓存,避免每次调用重跑整条流水线。
 * @Author: jmp0
 */

/** 会话是否为 ArkTS-Sta(static runtime)字节码 */
export function isStaticSession(session: AbcSession): session is AbcSession & { pandaFile: StaticPandaFile } {
    return session.pandaFile instanceof StaticPandaFile;
}

/** 取(必要时构建)文件级 static 输出缓存:类名 → 源码 */
export function getStaticOutputs(session: AbcSession, simplify: boolean): Map<string, string> {
    if (!isStaticSession(session)) throw new Error("不是 static 会话");
    const key = simplify ? "1" : "0";
    const cached = session.staticOutputs.get(key);
    if (cached) return cached;
    const outputs = new Map<string, string>();
    for (const result of session.staticDecompiler.decompileFile(session.pandaFile, simplify)) {
        if (result.code.length > 0) outputs.set(result.clazz.name.content, result.code);
    }
    session.staticOutputs.set(key, outputs);
    return outputs;
}

/** 单类 static 源码(来自文件级缓存) */
export function staticClassSource(session: AbcSession, clazz: PandaClass, simplify: boolean): string {
    return getStaticOutputs(session, simplify).get(clazz.name.content) ?? "";
}
