/**
 * Hook source rewriting: turn the entry/init function(s) into module exports and append
 * the dynamic setter/setup scaffolding.
 * @Author: jmp0
 */
import { PandaPatchError } from "./PatchTypes";

/** 把模块里的 `function <name>` 声明改写成 `export function`,已是导出形式则保持 */
function ensureExportedFunction(result: string, name: string, what: string): string {
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) {
        throw new PandaPatchError(`invalid ${what} name '${name}'`);
    }
    const declaration = new RegExp(`(?:^|[\\s;}])(?:async\\s+)?function\\s+${name}\\b`);
    if (!declaration.test(result)) {
        throw new PandaPatchError(
            `${what} source must declare 'function ${name}(...)'`);
    }
    if (new RegExp(`(?:^|[\\s;}])export\\s+default\\s+(?:async\\s+)?function\\s+${name}\\b`).test(result)) {
        throw new PandaPatchError(
            `${what} source cannot use 'export default function ${name}'; `
            + `declare 'export function ${name}(...)' instead`);
    }
    const exportedFunction = new RegExp(`(?:^|[\\s;}])export\\s+(?:async\\s+)?function\\s+${name}\\b`);
    const exportedSpecifier = new RegExp(`\\bexport\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`);
    if (exportedFunction.test(result) || exportedSpecifier.test(result)) return result;
    const match = new RegExp(`(^|[\\s;}])((?:async\\s+)?function\\s+${name}\\b)`).exec(result);
    if (!match) {
        throw new PandaPatchError(
            `${what} source must declare 'function ${name}(...)'`);
    }
    const insertAt = match.index + match[1].length;
    return `${result.slice(0, insertAt)}export ${result.slice(insertAt)}`;
}

/**
 * class 注入要求 hook/init 源码声明同名函数(编译后成为 hook class 的 `#*#<name>` 方法)。
 * 函数声明会被改写成 `export function` —— 目标 module 需要 import 这个导出。
 *
 * `initName` 非空时,同一个源文件里的 `function <initName>` 也会被导出,由入口类的
 * `func_main_0` 调用(dynamic 在 setup 之后,static 直接调用)。
 */
export function buildHookClassSource(
    hookNames: string[],
    source: string,
    setterNames: string[] = [],
    initName?: string,
    extraExports: string[] = [],
): string {
    let result = source.trim();
    if (initName !== undefined && hookNames.includes(initName)) {
        throw new PandaPatchError(`init function '${initName}' collides with a hook function`);
    }
    for (const hookName of hookNames) {
        result = ensureExportedFunction(result, hookName, "hook");
    }
    if (initName !== undefined) {
        result = ensureExportedFunction(result, initName, "init");
    }
    for (const name of extraExports) {
        if (name === initName || hookNames.includes(name)) {
            throw new PandaPatchError(`exported function '${name}' collides with a hook/init function`);
        }
        result = ensureExportedFunction(result, name, "exported");
    }
    const setters: string[] = [];
    for (const name of setterNames) {
        if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) {
            throw new PandaPatchError(`invalid dynamic setter name '${name}'`);
        }
        if (new RegExp(`\\bfunction\\s+${name}\\b`).test(result)) {
            throw new PandaPatchError(
                `dynamic setter '${name}' collides with a function already declared in the hook source`);
        }
        setters.push(`export function ${name}(fn) { return fn; }`);
    }
    if (setterNames.length > 0) {
        if (/\bxpanda_reserved_setup\b/.test(result)) {
            throw new PandaPatchError(
                "dynamic hook source cannot declare 'xpanda_reserved_setup'; that class installs the patch slots");
        }
        setters.push(
            "export class xpanda_reserved_setup {\n"
            + "  static xpanda_reserved_setup() {}\n"
            + "}\n"
            + "xpanda_reserved_setup.xpanda_reserved_setup();",
        );
    }
    return `${result}\n${setters.length > 0 ? `${setters.join("\n")}\n` : ""}`;
}
