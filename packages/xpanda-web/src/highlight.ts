/**
 * 零依赖的轻量 JavaScript 语法高亮:单遍字符扫描,按行输出独立合法的 HTML。
 * 只覆盖反编译输出会出现的语法(注释 / 字符串 / 模板字符串 / 数字 / 关键字);
 * 跨行的块注释与模板字符串通过扫描状态保持,pushLine 时闭合并重开 span,
 * 保证每行 HTML 可独立交给 dangerouslySetInnerHTML 渲染。
 * @Author: jmp0
 */

const KEYWORDS = new Set([
    "as", "async", "await", "break", "case", "catch", "class", "const", "continue",
    "debugger", "default", "delete", "do", "else", "enum", "export", "extends",
    "false", "finally", "for", "function", "if", "implements", "import", "in",
    "instanceof", "interface", "let", "new", "null", "of", "private", "protected",
    "public", "readonly", "return", "static", "super", "switch", "this", "throw",
    "true", "try", "typeof", "undefined", "var", "void", "while", "yield",
]);

function escHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[A-Za-z0-9_$]/;
const NUM_PART = /[0-9a-zA-Z_.$]/;

/** 返回按行切分的高亮 HTML 数组(每行不含换行符) */
export function highlightLines(code: string): string[] {
    const lines: string[] = [];
    let cur = "";
    // 当前跨行的未闭合 span 类名("tk-com" / "tk-str"),null 表示无
    let openSpan: string | null = null;
    let inBlockComment = false;
    let inTemplate = false;
    let i = 0;

    const pushLine = (): void => {
        if (openSpan !== null) {
            cur += "</span>";
            lines.push(cur);
            cur = `<span class="${openSpan}">`;
            return;
        }
        lines.push(cur);
        cur = "";
    };
    const emitToken = (cls: string, text: string): void => {
        cur += `<span class="tk-${cls}">${escHtml(text)}</span>`;
    };

    while (i < code.length) {
        const ch = code[i];

        // 跨行状态 1:块注释
        if (inBlockComment) {
            if (code.startsWith("*/", i)) {
                cur += "*/</span>";
                openSpan = null;
                inBlockComment = false;
                i += 2;
                continue;
            }
            if (ch === "\n") { pushLine(); i++; } else { cur += escHtml(ch); i++; }
            continue;
        }

        // 跨行状态 2:模板字符串(`...` 可跨行;不做 ${} 嵌套着色,整段按字符串处理)
        if (inTemplate) {
            let j = i;
            let tok = "";
            let closed = false;
            while (j < code.length && code[j] !== "\n") {
                if (code[j] === "\\" && j + 1 < code.length) { tok += code[j] + code[j + 1]; j += 2; continue; }
                if (code[j] === "`") { tok += "`"; j++; closed = true; break; }
                tok += code[j];
                j++;
            }
            cur += escHtml(tok);
            i = j;
            if (closed) {
                cur += "</span>";
                openSpan = null;
                inTemplate = false;
            } else {
                pushLine();
                i++;
            }
            continue;
        }

        if (ch === "\n") { pushLine(); i++; continue; }
        if (ch === " " || ch === "\t" || ch === "\r") { cur += ch; i++; continue; }

        // 行注释
        if (ch === "/" && code[i + 1] === "/") {
            const stop = code.indexOf("\n", i);
            const end = stop === -1 ? code.length : stop;
            emitToken("com", code.slice(i, end));
            i = end;
            continue;
        }
        // 块注释开始
        if (ch === "/" && code[i + 1] === "*") {
            cur += '<span class="tk-com">/*';
            openSpan = "tk-com";
            inBlockComment = true;
            i += 2;
            continue;
        }
        // 单双引号字符串(反编译输出不跨行,遇到换行按未终止字符串容错收尾)
        if (ch === '"' || ch === "'") {
            let j = i + 1;
            let tok = ch;
            while (j < code.length && code[j] !== "\n") {
                if (code[j] === "\\" && j + 1 < code.length) { tok += code[j] + code[j + 1]; j += 2; continue; }
                if (code[j] === ch) { tok += ch; j++; break; }
                tok += code[j];
                j++;
            }
            emitToken("str", tok);
            i = j;
            continue;
        }
        // 模板字符串开始
        if (ch === "`") {
            cur += '<span class="tk-str">`';
            openSpan = "tk-str";
            inTemplate = true;
            i++;
            continue;
        }
        // 数字(宽松覆盖十进制 / 十六进制 / 科学计数)
        if (ch >= "0" && ch <= "9") {
            let j = i + 1;
            while (j < code.length && NUM_PART.test(code[j])) j++;
            emitToken("num", code.slice(i, j));
            i = j;
            continue;
        }
        // 标识符 / 关键字
        if (IDENT_START.test(ch)) {
            let j = i + 1;
            while (j < code.length && IDENT_PART.test(code[j])) j++;
            const word = code.slice(i, j);
            if (KEYWORDS.has(word)) emitToken("kw", word);
            else cur += escHtml(word);
            i = j;
            continue;
        }
        cur += escHtml(ch);
        i++;
    }
    pushLine();
    return lines;
}
