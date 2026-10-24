import type { PandaClass, PandaFile } from "xpanda-core";

/**
 * MCP 层类名工具:L-prefixed mangled 名(Lpkg/Name;)与 demangled 名(pkg/Name)互转
 * @Author: jmp0
 */

/** demangled 名 → mangled 名(补全 L 前缀与 ; 后缀) */
export function normalizeClassName(input: string): string {
    let s = input.trim();
    if (!s.startsWith("L")) s = "L" + s;
    if (!s.endsWith(";")) s = s + ";";
    return s;
}

/** mangled 名 → demangled 名 */
export function demangleClassName(name: string): string {
    if (name.length >= 2 && name.startsWith("L") && name.endsWith(";")) {
        return name.substring(1, name.length - 1);
    }
    return name;
}

/**
 * 按类名查找:精确匹配(两种形态)→ 唯一子串匹配 → 失败时列出候选
 */
export function findClass(pandaFile: PandaFile, className: string): PandaClass {
    const all = pandaFile.getAllClasses();
    const target = normalizeClassName(className);
    const targetDemangled = demangleClassName(target);

    let hit = all.find((c) => c.name.content === target || demangleClassName(c.name.content) === targetDemangled);
    if (hit) return hit;

    // 宽松兜底:子串匹配(忽略大小写),仅唯一命中时采用
    const needle = targetDemangled.toLowerCase();
    const fuzzy = all.filter((c) => demangleClassName(c.name.content).toLowerCase().includes(needle));
    if (fuzzy.length === 1) return fuzzy[0];

    const candidates = (fuzzy.length > 0 ? fuzzy : all)
        .slice(0, 8)
        .map((c) => demangleClassName(c.name.content));
    throw new Error(
        "类未找到: " + className
        + (candidates.length > 0 ? "\n候选: \n - " + candidates.join("\n - ") : "\n(文件中没有类)")
        + "\n可先用 abc_list_classes 查看类列表");
}
