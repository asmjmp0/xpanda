/**
 * Shiki-powered JavaScript syntax highlighting (VS Code Dark+ palette).
 * The highlighter is a lazily-created singleton: first call loads the grammar
 * (one-time cost, Vite code-splits it), later calls are fast synchronous
 * tokenization. The pure-JS regex engine keeps the bundle WASM-free.
 * codeToTokens() returns tokens already split per line, so each rendered line
 * stays independently valid HTML for dangerouslySetInnerHTML (same rendering
 * contract as the previous zero-dependency scanner).
 * @Author: jmp0
 */
import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
// Explicit theme import (instead of the "shiki" main entry) keeps the bundler
// from pulling in the full 200+ language/theme registry.
import themeDarkPlus from "shiki/themes/dark-plus.mjs";

const LANG = "javascript";
const THEME = "dark-plus";

let highlighterPromise: Promise<HighlighterCore> | null = null;

function getHighlighter(): Promise<HighlighterCore> {
    highlighterPromise ??= createHighlighterCore({
        // Dynamic import: the grammar becomes its own lazily-fetched chunk.
        langs: [import("shiki/langs/javascript.mjs")],
        themes: [themeDarkPlus],
        engine: createJavaScriptRegexEngine({ forgiving: true }),
    }).catch((err: unknown) => {
        highlighterPromise = null; // drop the failed promise so the next call can retry
        throw err;
    });
    return highlighterPromise;
}

function escHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Escaped, colorless lines — instant placeholder shown while Shiki initializes. */
export function plainLines(code: string): string[] {
    return code.split("\n").map(escHtml);
}

/** Returns per-line highlighted HTML (each line has no trailing newline). */
export async function highlightLines(code: string): Promise<string[]> {
    const highlighter = await getHighlighter();
    const { tokens } = highlighter.codeToTokens(code, { lang: LANG, theme: THEME });
    return tokens.map((line) => line.map(emitToken).join(""));
}

function emitToken(tok: { content: string; color?: string; fontStyle?: number }): string {
    const text = escHtml(tok.content);
    const css: string[] = [];
    if (tok.color) css.push(`color:${tok.color}`);
    // Shiki fontStyle bits: 1 = bold, 2 = italic, 4 = underline
    if (tok.fontStyle && tok.fontStyle & 1) css.push("font-weight:600");
    if (tok.fontStyle && tok.fontStyle & 2) css.push("font-style:italic");
    if (tok.fontStyle && tok.fontStyle & 4) css.push("text-decoration:underline");
    return css.length ? `<span style="${css.join(";")}">${text}</span>` : text;
}
