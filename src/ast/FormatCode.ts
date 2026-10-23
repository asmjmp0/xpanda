/**
 * Babel generator 不会对超长行折行,`A || B || ...` 这样的条件链会整条挤在一行。
 * 这里只做一件事:把超过 {@link MAX_LINE_WIDTH} 的行在顶层 `||` / `&&` / `??` 前折行。
 *
 * 安全性:
 *   - 只在操作符前插入换行,新行以操作符开头,不会触发 ASI;
 *   - 顶层含有三目 `? :` 的行保持原样(拆开后可读性反而更差);
 *   - 字符串、模板字符串、注释、正则字面量内部的操作符不参与折行。
 *
 * @Author: jmp0
 */

const MAX_LINE_WIDTH = 120;
const CONTINUATION = "  ";

interface ScanState {
    template: boolean;
    blockComment: boolean;
}

interface LineScanResult {
    /** 顶层逻辑操作符的起始下标 */
    positions: number[];
    /** 顶层是否有三目 `?` */
    hasConditional: boolean;
    state: ScanState;
}

const REGEX_PREFIX_KEYWORDS = new Set([
    "return", "typeof", "instanceof", "in", "of", "new", "delete", "void",
    "throw", "case", "do", "else", "yield", "await",
]);

/** 把生成代码中过长的逻辑链格式化成多行 */
export function formatLongLogicalChains(code: string): string {
    if (code.indexOf("||") < 0 && code.indexOf("&&") < 0 && code.indexOf("??") < 0) {
        return code;
    }
    const lines = code.split("\n");
    const result: string[] = [];
    let state: ScanState = { template: false, blockComment: false };
    for (const line of lines) {
        const scan = scanLine(line, state);
        state = scan.state;
        if (line.length <= MAX_LINE_WIDTH || scan.positions.length === 0 || scan.hasConditional) {
            result.push(line);
            continue;
        }
        const indent = /^[ \t]*/.exec(line)![0];
        const firstEnd = scan.positions[0];
        result.push(line.slice(0, firstEnd).replace(/[ \t]+$/, ""));
        for (let i = 0; i < scan.positions.length; i++) {
            const start = scan.positions[i];
            const end = i + 1 < scan.positions.length ? scan.positions[i + 1] : line.length;
            result.push(indent + CONTINUATION + line.slice(start, end).trim());
        }
    }
    return result.join("\n");
}

function scanLine(line: string, initial: ScanState): LineScanResult {
    const positions: number[] = [];
    let hasConditional = false;
    let template = initial.template;
    let blockComment = initial.blockComment;
    let depth = 0;
    let i = 0;
    let prev = "";
    let prevWord = "";

    while (i < line.length) {
        if (blockComment) {
            const end = line.indexOf("*/", i);
            if (end < 0) return { positions, hasConditional, state: { template, blockComment } };
            blockComment = false;
            i = end + 2;
            prev = "/";
            continue;
        }
        if (template) {
            const end = skipQuoted(line, i, "`");
            if (end < 0) return { positions, hasConditional, state: { template: true, blockComment } };
            template = false;
            i = end;
            prev = "`";
            prevWord = "";
            continue;
        }

        const ch = line[i];
        if (ch === '"' || ch === "'") {
            const end = skipQuoted(line, i, ch);
            i = end < 0 ? line.length : end;
            prev = ch;
            prevWord = "";
            continue;
        }
        if (ch === "`") {
            const end = skipQuoted(line, i, "`");
            if (end < 0) {
                template = true;
                return { positions, hasConditional, state: { template, blockComment } };
            }
            i = end;
            prev = "`";
            prevWord = "";
            continue;
        }
        if (ch === "/" && line[i + 1] === "/") {
            return { positions, hasConditional, state: { template, blockComment } };
        }
        if (ch === "/" && line[i + 1] === "*") {
            blockComment = true;
            i += 2;
            continue;
        }
        if (ch === "/" && startsRegex(prev, prevWord)) {
            const end = skipRegex(line, i);
            i = end < 0 ? line.length : end;
            prev = "/";
            prevWord = "";
            continue;
        }

        if (ch === "(" || ch === "[" || ch === "{") {
            depth++;
        } else if (ch === ")" || ch === "]" || ch === "}") {
            depth = Math.max(0, depth - 1);
        } else if (depth === 0) {
            const next = line[i + 1];
            const after = line[i + 2];
            if ((ch === "|" && next === "|" && after !== "=" && after !== "|")
                || (ch === "&" && next === "&" && after !== "=" && after !== "&")) {
                positions.push(i);
                i += 2;
                prev = ch;
                prevWord = "";
                continue;
            }
            if (ch === "?" && next === "?") {
                if (after !== "=") positions.push(i);
                i += 2;
                prev = "?";
                prevWord = "";
                continue;
            }
            if (ch === "?" && next !== ".") {
                hasConditional = true;
            }
        }

        if (/[A-Za-z0-9_$]/.test(ch)) {
            prevWord = /[A-Za-z0-9_$]/.test(prevWord) || prevWord === "" ? prevWord + ch : ch;
        } else if (ch !== " " && ch !== "\t") {
            prevWord = "";
        }
        if (ch !== " " && ch !== "\t") prev = ch;
        i++;
    }

    return { positions, hasConditional, state: { template, blockComment } };
}

/** 返回闭合引号之后的下标;未闭合返回 -1 */
function skipQuoted(line: string, start: number, quote: string): number {
    for (let i = start + 1; i < line.length; i++) {
        if (line[i] === "\\") {
            i++;
            continue;
        }
        if (line[i] === quote) return i + 1;
    }
    return -1;
}

/** 返回正则字面量结束后的下标;未闭合返回 -1 */
function skipRegex(line: string, start: number): number {
    let inClass = false;
    for (let i = start + 1; i < line.length; i++) {
        if (line[i] === "\\") {
            i++;
            continue;
        }
        if (line[i] === "[") {
            inClass = true;
        } else if (line[i] === "]") {
            inClass = false;
        } else if (line[i] === "/" && !inClass) {
            return i + 1;
        }
    }
    return -1;
}

function startsRegex(prevChar: string, prevWord: string): boolean {
    if (prevWord !== "" && REGEX_PREFIX_KEYWORDS.has(prevWord)) return true;
    if (prevChar === "") return true;
    return "([{=,:;!&|?+-*%<>~^".includes(prevChar);
}
