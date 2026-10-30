/**
 * Compile the finally-shape fixtures with the reference `es2abc` and summarize the
 * try-table / handler shapes. This is the ground truth for "is this handler a
 * finally or a catch?" questions.
 *
 * Usage (from the repo root):
 *   yarn tsx .agents/skills/xpanda-structure-forensics/scripts/compile-shapes.ts
 *   yarn tsx .../compile-shapes.ts --out /tmp/my-shapes
 *
 * The summary is heuristic: a `finally` handler has the `ldhole`/`noteq` rethrow
 * guard and usually comes in a pair with a pure rethrow bridge for the same try
 * start; a `catch` handler is `sta e; <body>; lda e; throw` with no hole guard.
 * Always read the dumped `.asm` for the exact shape.
 */
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

interface TryEntry {
    begin: string;
    end: string;
    handler: string;
}

const scriptDir = __dirname;
const root = path.resolve(scriptDir, "../../../..");
const fixtureDir = path.resolve(scriptDir, "../fixtures/finally-shapes");
const es2abc = path.join(root, "reference/es2abc");

let outDir = path.join(os.tmpdir(), "xpanda-finally-shapes");
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out") outDir = path.resolve(args[++i] ?? outDir);
}

if (!fs.existsSync(es2abc)) {
    console.error(`reference es2abc not found: ${es2abc}`);
    process.exit(1);
}
if (!fs.existsSync(fixtureDir)) {
    console.error(`fixtures not found: ${fixtureDir}`);
    process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });

function splitFunctions(asm: string): Array<{ name: string; lines: string[] }> {
    const functions: Array<{ name: string; lines: string[] }> = [];
    let current: { name: string; lines: string[] } | null = null;
    for (const line of asm.split("\n")) {
        const match = line.match(/^\.function .*?\s(\S+)\(/);
        if (match) {
            current = { name: match[1], lines: [] };
            functions.push(current);
            continue;
        }
        if (current) current.lines.push(line);
    }
    return functions;
}

function parseEntries(lines: string[]): TryEntry[] {
    const entries: TryEntry[] = [];
    let current: Partial<TryEntry> = {};
    for (const line of lines) {
        let match: RegExpMatchArray | null;
        if ((match = line.match(/try_begin_label\s*:\s*label@(\d+)/))) {
            current.begin = match[1];
        } else if ((match = line.match(/try_end_label\s*:\s*label@(\d+)/))) {
            current.end = match[1];
        } else if ((match = line.match(/catch_begin_label\s*:\s*label@(\d+)/))) {
            current.handler = match[1];
            if (current.begin && current.end && current.handler) entries.push(current as TryEntry);
            current = {};
        }
    }
    return entries;
}

function classifyHandler(lines: string[], handler: string, handlerLabels: Set<string>): string {
    const index = lines.findIndex((line) => line.trimStart().startsWith(`label@${handler}:`));
    if (index < 0) return "?";
    // Bound the handler window at the next handler label: the async reject wrapper
    // and the sibling finally/rethrow handler sit in the same function, and a wide
    // window would see their `ldhole`/`asyncfunctionreject`.
    let end = lines.length;
    for (let i = index + 1; i < lines.length; i++) {
        const match = lines[i].match(/^\s*label@(\d+):/);
        if (match && handlerLabels.has(match[1])) {
            end = i;
            break;
        }
    }
    const window = lines.slice(index, end).join("\n");
    if (/ldhole/.test(window) && /noteq/.test(window)) return "finally";
    if (/asyncfunctionreject/.test(window)) return "async-reject";
    return "catch-plain";
}

const fixtures = fs.readdirSync(fixtureDir).filter((file) => file.endsWith(".ts")).sort();
for (const file of fixtures) {
    const name = file.replace(/\.ts$/, "");
    const asmFile = path.join(outDir, `${name}.asm`);
    const abcFile = path.join(outDir, `${name}.abc`);
    const asm = execFileSync(
        es2abc,
        ["--extension=ts", "--module", "--dump-normalized-asm-program", path.join(fixtureDir, file), `--output=${abcFile}`],
        { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    fs.writeFileSync(asmFile, asm);
    console.log(`\n## ${path.relative(root, path.join(fixtureDir, file))}`);
    for (const fn of splitFunctions(asm)) {
        const entries = parseEntries(fn.lines);
        if (entries.length === 0) continue;
        console.log(`  ${fn.name}`);
        const handlerLabels = new Set(entries.map((entry) => entry.handler));
        const byStart = new Map<string, TryEntry[]>();
        for (const entry of entries) {
            const group = byStart.get(entry.begin) ?? [];
            group.push(entry);
            byStart.set(entry.begin, group);
        }
        for (const entry of entries) {
            const group = byStart.get(entry.begin) ?? [];
            const pair = group.length > 1 ? ` (${group.length} entries for start ${entry.begin})` : "";
            console.log(`    try ${entry.begin}..${entry.end} -> handler ${entry.handler}: ${classifyHandler(fn.lines, entry.handler, handlerLabels)}${pair}`);
        }
    }
    console.log(`    asm: ${asmFile}`);
}

console.log(`\nnormalized asm dumps: ${outDir}`);
console.log("legend: finally = ldhole/noteq rethrow guard; catch-plain = sta e; body; lda e; throw (no hole guard); async-reject = promise rejection wrapper");
