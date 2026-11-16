/**
 * Naming helpers shared by the ArkTS-Sta class renderer and the lambda inliner.
 * @Author: jmp0
 */

/** `L@ohos/UiTest/Component;` → `Component`; strips generic/signature suffixes. */
export function simpleClassName(raw: string): string {
    let name = raw;
    if (name.startsWith("L") && name.endsWith(";")) name = name.substring(1, name.length - 1);
    const slash = name.lastIndexOf("/");
    if (slash >= 0) name = name.substring(slash + 1);
    return name;
}

/** Rendered JS class name for a static class descriptor. */
export function sanitizeClassName(raw: string): string {
    let name = raw;
    if (name.startsWith("L") && name.endsWith(";")) name = name.substring(1, name.length - 1);
    const slash = name.lastIndexOf("/");
    if (slash >= 0) name = name.substring(slash + 1);
    name = name.replace(/^@[^$]+\$[^$]+\$/, "");
    if (name.startsWith("%%partial-")) name = "Partial" + name.substring("%%partial-".length);
    name = name.replace(/\$ObjectLiteral$/, "_ObjectLiteral");
    return sanitizeIdentifier(name);
}

export function sanitizeMemberName(name: string): string {
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) return name;
    return name.replace(/[^A-Za-z0-9_$]/g, "_");
}

export function sanitizeIdentifier(name: string): string {
    let value = name;
    if (value === "<ctor>") return "constructor";
    if (value === "<cctor>") return "staticInitializer";
    value = value.replace(/^%%lambda-/, "lambda_");
    value = value.replace(/^%%/, "");
    value = value.replace(/[^A-Za-z0-9_$]/g, "_");
    if (value.length === 0) return "anonymous";
    if (/^[0-9]/.test(value)) return "_" + value;
    return value;
}
