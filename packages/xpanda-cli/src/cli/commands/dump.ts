/**
 * `xpanda dump`: copy selected classes (plus their referenced classes) into a new abc.
 * @Author: jmp0
 */
import * as fs from "fs";
import * as path from "path";
import { HapFile, PandaClass, PandaFile } from "xpanda-core";
import { PandaPatchFile } from "xpanda-asm";
import { matchLongOption, takeValue } from "../args";
import { fail } from "../help";
import { displayPath, isHapInput, readInputBytes, writeBytesEnsured } from "../input";

/** Class-name query matching: exact raw name, exact demangled name, then suffix/substring. */
function matchDumpClasses(pf: PandaFile, query: string): PandaClass[] {
    const all = pf.getAllClasses().filter((clazz) => !clazz.classExternal && clazz.name.content.length > 0);
    const strip = (name: string): string => name.replace(/^L/, "").replace(/;$/, "");
    const normalized = strip(query);
    const exact = all.filter((clazz) => clazz.name.content === query);
    if (exact.length > 0) return exact;
    const demangled = all.filter((clazz) => strip(clazz.name.content) === normalized);
    if (demangled.length > 0) return demangled;
    const suffix = all.filter((clazz) => {
        const name = strip(clazz.name.content);
        return name.endsWith("/" + normalized) || name === normalized;
    });
    if (suffix.length > 0) return suffix;
    return all.filter((clazz) => clazz.name.content.includes(query) || strip(clazz.name.content).includes(normalized));
}

function resolveDumpClasses(pf: PandaFile, queries: string[], source: string): string[] {
    const names: string[] = [];
    for (const query of queries) {
        const matches = matchDumpClasses(pf, query);
        if (matches.length === 0) fail(`dump: class not found in ${source}: ${query}`, "dump");
        if (matches.length > 1) {
            const candidates = matches.slice(0, 10).map((clazz) => clazz.name.content).join(", ");
            fail(`dump: ambiguous class ${query} in ${source}: ${candidates}`, "dump");
        }
        const name = matches[0].name.content;
        if (!names.includes(name)) names.push(name);
    }
    return names;
}

/** Dump selected classes from one abc to a single new abc file. */
function dumpAbcData(data: Uint8Array, queries: string[], output: string, source: string): void {
    const pandaFile = new PandaFile(data);
    const names = resolveDumpClasses(pandaFile, queries, source);
    const result = PandaPatchFile.load(data).dumpClasses(names);
    const outPath = path.resolve(output);
    writeBytesEnsured(outPath, result.data);
    const extra = result.dependencies.length > 0 ? `, ${result.dependencies.length} referenced classes` : "";
    console.log(`written: ${displayPath(outPath)} (${result.classes.length} classes${extra})`);
}

/** Dump selected classes from a hap: one output abc per .abc entry that contains matches. */
function dumpHapData(data: Uint8Array, queries: string[], output: string): void {
    const hap = new HapFile(data);
    const entries = hap.getAbcEntries();
    if (entries.length === 0) fail("dump: no .abc entry found in hap", "dump");
    const fileOutput = output.toLowerCase().endsWith(".abc");
    const found = new Set<string>();
    const pending: Array<{ entryIndex: number; names: string[] }> = [];
    for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
        const entry = entries[entryIndex];
        const pandaFile = new PandaFile(entry.read());
        const names: string[] = [];
        for (const query of queries) {
            const matches = matchDumpClasses(pandaFile, query);
            if (matches.length === 0) continue;
            if (matches.length > 1) {
                const candidates = matches.slice(0, 10).map((clazz) => clazz.name.content).join(", ");
                fail(`dump: ambiguous class ${query} in ${entry.name}: ${candidates}`, "dump");
            }
            found.add(query);
            if (!names.includes(matches[0].name.content)) names.push(matches[0].name.content);
        }
        if (names.length > 0) pending.push({ entryIndex, names });
    }
    const missing = queries.filter((query) => !found.has(query));
    if (missing.length > 0) fail(`dump: class not found in hap: ${missing.join(", ")}`, "dump");
    if (fileOutput && pending.length > 1) {
        fail("dump: multiple hap .abc entries contain matching classes; pass a directory for -o", "dump");
    }
    for (const item of pending) {
        const entry = entries[item.entryIndex];
        const outPath = fileOutput
            ? path.resolve(output)
            : path.resolve(output, entry.name.replace(/\.abc$/i, "") + ".dump.abc");
        const result = PandaPatchFile.load(entry.read()).dumpClasses(item.names);
        if (!fileOutput) {
            const root = path.resolve(output) + path.sep;
            if (!outPath.startsWith(root)) fail(`dump: unsafe hap entry name: ${entry.name}`, "dump");
        }
        writeBytesEnsured(outPath, result.data);
        const extra = result.dependencies.length > 0 ? `, ${result.dependencies.length} referenced classes` : "";
        console.log(`written: ${displayPath(outPath)} (${result.classes.length} classes${extra})`);
    }
}

export function runDump(args: string[]): void {
    if (args.length < 1) fail("dump: missing <file.abc|file.hap> file argument", "dump");
    const input = args[0];
    let output: string | null = null;
    const queries: string[] = [];
    const pushQuery = (value: string): void => {
        for (const part of value.split(",")) {
            const trimmed = part.trim();
            if (trimmed.length > 0) queries.push(trimmed);
        }
    };
    for (let i = 1; i < args.length; i++) {
        const arg = args[i];
        if (arg === "-o" || arg === "--output") {
            const parsed = takeValue(args, i, arg, "dump");
            output = parsed.value;
            i = parsed.index;
        } else if (matchLongOption(arg, "--output") !== null) {
            output = matchLongOption(arg, "--output");
        } else if (arg === "-c" || arg === "--class") {
            const parsed = takeValue(args, i, arg, "dump");
            pushQuery(parsed.value);
            i = parsed.index;
        } else if (matchLongOption(arg, "--class") !== null) {
            pushQuery(matchLongOption(arg, "--class")!);
        } else if (arg.startsWith("-")) {
            fail(`unknown argument: ${arg}`, "dump");
        } else {
            // Positional class names are accepted as a convenience.
            pushQuery(arg);
        }
    }
    if (queries.length === 0) fail("dump: at least one -c/--class is required", "dump");

    const data = readInputBytes(input);
    const hapInput = isHapInput(input, data);
    const resolvedOutput = output ?? (hapInput ? "out" : "dump.abc");
    if (hapInput) {
        dumpHapData(data, queries, resolvedOutput);
        return;
    }
    let outFile = resolvedOutput;
    try {
        if (fs.statSync(outFile).isDirectory()) outFile = path.join(outFile, "dump.abc");
    } catch {
        // Not an existing path; treat it as a file name.
    }
    if (outFile.endsWith("/") || outFile.endsWith(path.sep)) outFile = path.join(outFile, "dump.abc");
    dumpAbcData(data, queries, outFile, input);
}
