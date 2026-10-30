/**
 * abc-inspect: structure forensics for a HarmonyOS .abc / .hap method.
 *
 * Prints the evidence needed before designing a rule that restores a missing
 * try/catch/finally or loop shape:
 *   - the raw try table (start / end / handler)
 *   - how each entry is classified (keep / kind / usesException / exits)
 *   - the finally plans buildFinallyPlans derived (and which shape they took)
 *   - the CFG blocks in a pc window, with successors/predecessors and the
 *     hole-sentinel / guard instructions marked
 *
 * Usage (from the repo root):
 *   yarn tsx .agents/skills/xpanda-structure-forensics/scripts/abc-inspect.ts \
 *     <file.abc|file.hap> <className> [methodName] [options]
 *
 *   --list                 list the class's methods and try-block counts
 *   --entries              classified try entries
 *   --plans                finally plans
 *   --cfg <from> [to]      dump blocks whose start pc is in [from, to]
 *   --writes <reg>         reaching definitions of a register and their readers
 *   --find <text>          find methods containing a string literal (maps a
 *                          decompiled function to its bytecode method)
 *   --decompile            print the decompiled class
 *   --abc <entry>          .hap: pick the .abc entry (default: the only one)
 *
 * Class names are accepted as `Lpkg/Name;`, `pkg/Name`, or a unique substring.
 * Method names are accepted as `#*#q776`, `q776`, or a unique substring.
 * @Author: jmp0
 */
import * as fs from "fs";
import { HapFile, PandaDecompiler, PandaFile } from "../../../../packages/xpanda-core/src/index";
import { classifyTryEntries } from "../../../../packages/xpanda-core/src/decompiler/ExceptionTable";
import { buildFinallyPlans } from "../../../../packages/xpanda-core/src/decompiler/TryFinally";
import { ValueAnalysis } from "../../../../packages/xpanda-core/src/decompiler/ValueAnalysis";

interface Options {
    list: boolean;
    entries: boolean;
    plans: boolean;
    decompile: boolean;
    cfg: { from: number; to: number } | null;
    writes: string | null;
    find: string | null;
    abcEntry: string | null;
    positional: string[];
}

function parseArgs(argv: string[]): Options {
    const options: Options = {
        list: false, entries: false, plans: false, decompile: false,
        cfg: null, writes: null, find: null, abcEntry: null, positional: [],
    };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--list") options.list = true;
        else if (arg === "--entries") options.entries = true;
        else if (arg === "--plans") options.plans = true;
        else if (arg === "--decompile") options.decompile = true;
        else if (arg === "--cfg") {
            const from = Number(argv[++i]);
            const next = argv[i + 1];
            const to = next !== undefined && !next.startsWith("--") && !Number.isNaN(Number(next))
                ? Number(argv[++i])
                : from + 0x10000;
            options.cfg = { from, to };
        } else if (arg === "--writes") options.writes = argv[++i] ?? null;
        else if (arg === "--find") options.find = argv[++i] ?? null;
        else if (arg === "--abc") options.abcEntry = argv[++i] ?? null;
        else if (arg === "-h" || arg === "--help") {
            console.log(fs.readFileSync(process.argv[1], "utf-8").split("*/")[0]);
            process.exit(0);
        } else options.positional.push(arg);
    }
    return options;
}

function loadPandaFile(path: string, abcEntry: string | null): PandaFile {
    const data = new Uint8Array(fs.readFileSync(path));
    if (!path.toLowerCase().endsWith(".hap")) return new PandaFile(data);
    const hap = new HapFile(data);
    const entries = hap.getAbcEntries();
    if (entries.length === 0) throw new Error("no .abc entry in " + path);
    const entry = abcEntry
        ? entries.find((candidate) => candidate.name === abcEntry || candidate.name.endsWith("/" + abcEntry))
        : entries.length === 1 ? entries[0] : null;
    if (!entry) {
        throw new Error("pick an .abc entry with --abc <entry>: "
            + entries.map((candidate) => candidate.name).join(", "));
    }
    console.error(`# hap entry: ${entry.name}`);
    return new PandaFile(hap.readEntry(entry.name)!);
}

function pad(value: number | string, width: number): string {
    return String(value).padStart(width);
}

function resolveClass(pandaFile: PandaFile, query: string): any {
    const classes = pandaFile.getAllClasses();
    const norm = query.replace(/^L/, "").replace(/;$/, "");
    const exact = classes.filter((cls) => {
        const name = String(cls.name.content).replace(/^L/, "").replace(/;$/, "");
        return name === norm || String(cls.name.content) === query;
    });
    if (exact.length === 1) return exact[0];
    const partial = classes.filter((cls) => String(cls.name.content).includes(norm));
    if (partial.length === 1) return partial[0];
    if (partial.length === 0) throw new Error(`class not found: ${query}`);
    throw new Error(`ambiguous class ${query}:\n  `
        + partial.slice(0, 20).map((cls) => String(cls.name.content)).join("\n  "));
}

function resolveMethod(cls: any, query: string): [string, any] {
    const methods = Array.from(cls.pandaMethods as Map<string, any>);
    const exact = methods.find(([name]) => name === query);
    if (exact) return exact;
    const suffix = methods.find(([name]) => name.endsWith(query));
    if (suffix) return suffix;
    const partial = methods.filter(([name]) => name.includes(query));
    if (partial.length === 1) return partial[0];
    if (partial.length === 0) throw new Error(`method not found: ${query}`);
    throw new Error(`ambiguous method ${query}:\n  `
        + partial.slice(0, 20).map(([name]) => name).join("\n  "));
}

function entrySummary(entry: any): string {
    return [
        `try ${entry.startPC}..${entry.endPC}`,
        `kind=${entry.kind}`,
        `keep=${entry.keep}`,
        `usesException=${entry.usesException}`,
        `exits=${entry.exits}`,
        `protectedEnd=${entry.protectedEndPC ?? "-"}`,
        entry.loopContinue ? "loopContinue" : "",
    ].filter(Boolean).join("  ");
}

function printEntries(cfg: any): void {
    const table = classifyTryEntries(cfg);
    console.log(`# classified try entries: ${table.entries.length}`
        + `  async=${table.isAsyncFunction} generator=${table.isGeneratorFunction}`);
    for (const [index, entry] of table.entries.entries()) {
        console.log(`  [${index}] ${entrySummary(entry)}`);
    }
}

function printPlans(cfg: any): void {
    const plans = buildFinallyPlans(cfg);
    console.log(`# finally plans: ${plans.length}`);
    for (const plan of plans) {
        const shape = plan.eagerCleanup ? "eager"
            : plan.tailCleanupRange ? "loop-tail"
                : plan.sharedSentinel ? "shared-sentinel" : "classic";
        console.log(`  plan ${plan.id} ${shape}`
            + ` start=${plan.startPC} end=${plan.endPC}`
            + ` cleanup=${plan.cleanupStartPC} guard=${plan.guardStartPC} guardEnd=${plan.guardEndPC}`
            + (plan.endIsMethodTail ? " endIsMethodTail" : "")
            + (plan.restoreContinuation ? " restoreContinuation" : "")
            + (plan.inlinedCleanupStartPC !== undefined
                ? ` inlined=${plan.inlinedCleanupStartPC}..${plan.inlinedCleanupEndPC}` : "")
            + (plan.tailCleanupRange
                ? ` tailCleanup=${plan.tailCleanupRange.startPC}..${plan.tailCleanupRange.endPC}` : ""));
    }
}

function instructionText(instruction: any): string {
    const name = instruction.op || instruction.opcode?.name || instruction.kind;
    const operands = Array.isArray(instruction.params)
        ? instruction.params.filter((param: any) => param !== undefined && param !== null).map(String).join(", ")
        : "";
    return operands ? `${name} ${operands}` : name;
}

function printCfg(cfg: any, from: number, to: number): void {
    const blocks = cfg.pandaIRBasicBlocks.filter((block: any) => {
        const start = block.getStartPC();
        return start >= from && start <= to;
    });
    console.log(`# cfg blocks in [${from}, ${to}]: ${blocks.length}`);
    for (const block of blocks) {
        const successors = cfg.graph.normalSuccessors(block)
            .map((successor: any) => successor.getStartPC()).sort((a: number, b: number) => a - b);
        const predecessors = cfg.graph.normalPredecessors(block)
            .map((predecessor: any) => predecessor.getStartPC()).sort((a: number, b: number) => a - b);
        const holes = block.pandaInstructions.some((instruction: any) =>
            instruction.kind === "load" && instruction.loadType === "HOLE");
        console.log(`\n  block ${block.getStartPC()}${holes ? "  [hole]" : ""}`
            + `  -> [${successors.join(", ")}]  <- [${predecessors.join(", ")}]`);
        for (const instruction of block.pandaInstructions) {
            const tags: string[] = [];
            if (instruction.kind === "load" && instruction.loadType === "HOLE") tags.push("hole-load");
            if (instruction.isCompareOp) tags.push("compare");
            console.log(`    ${pad(instruction.pc, 6)}: ${instructionText(instruction)}`
                + (tags.length ? `    ; ${tags.join(",")}` : ""));
        }
    }
}

function printWrites(cfg: any, register: string): void {
    const analysis = new ValueAnalysis(cfg);
    const definitions = (analysis as any).definitions.filter((definition: any) => definition.register === register);
    console.log(`# definitions of ${register}: ${definitions.length}`);
    for (const definition of definitions) {
        const readers = analysis.readersOf(definition)
            .map((read: any) => read.instruction.pc)
            .sort((a: number, b: number) => a - b);
        console.log(`  def ${pad(definition.id, 4)} pc=${pad(definition.instruction.pc, 6)}`
            + ` block=${definition.block.getStartPC()}`
            + ` readers=${readers.length ? readers.join(",") : "-"}`);
    }
}

function findString(pandaFile: PandaFile, needle: string): void {
    const lower = needle.toLowerCase();
    let hits = 0;
    for (const cls of pandaFile.getAllClasses()) {
        for (const [name, method] of cls.pandaMethods as Map<string, any>) {
            if (method.methodExternal) continue;
            let cfg: any;
            try { cfg = method.disAssemble(); } catch { continue; }
            if (!cfg) continue;
            for (const block of cfg.pandaIRBasicBlocks) {
                for (const instruction of block.pandaInstructions) {
                    const params: any[] = Array.isArray(instruction.params) ? instruction.params : [];
                    for (const param of params) {
                        const content = param && param.type === "STRING" && param.obj
                            ? String(param.obj.content) : "";
                        if (!content || !content.toLowerCase().includes(lower)) continue;
                        console.log(`${cls.name.content}  ${name}  pc=${instruction.pc}  "${content.slice(0, 80)}"`);
                        hits++;
                    }
                }
            }
        }
    }
    console.log(`# string hits: ${hits}`);
}

function main(): void {
    const options = parseArgs(process.argv.slice(2));
    const [path, classQuery, methodQuery] = options.positional;
    if (!path || (!classQuery && !options.find)) {
        console.error("usage: abc-inspect.ts <file.abc|file.hap> <className> [methodName]"
            + " [--list] [--entries] [--plans] [--cfg from to] [--writes reg]"
            + " [--find text] [--decompile] [--abc entry]");
        process.exit(2);
    }
    const pandaFile = loadPandaFile(path, options.abcEntry);
    console.log(`# version ${pandaFile.header.versionString()}`);

    if (options.find) {
        findString(pandaFile, options.find);
        return;
    }

    const cls = resolveClass(pandaFile, classQuery!);
    console.log(`# class ${String(cls.name.content)}`);

    if (options.decompile) {
        console.log(new PandaDecompiler().decompileClass(cls));
        return;
    }

    const methods = Array.from(cls.pandaMethods as Map<string, any>)
        .filter(([, method]) => !method.methodExternal);

    if (!methodQuery || options.list) {
        console.log(`# methods: ${methods.length}`);
        for (const [name, method] of methods) {
            const tryBlocks = method.methodCode?.pandaMethodTryBlocks ?? [];
            const codeSize = method.methodCode?.codeSize ?? 0;
            console.log(`  ${pad(name, 24)} code=${pad(codeSize, 6)} try=${tryBlocks.length}`);
        }
        if (!methodQuery) return;
    }

    const [name, method] = resolveMethod(cls, methodQuery!);
    const cfg = method.disAssemble();
    if (!cfg) throw new Error("method has no code: " + name);
    const blocks = cfg.pandaIRBasicBlocks;
    const first = blocks[0]?.getStartPC() ?? 0;
    const lastBlock = blocks[blocks.length - 1];
    const last = lastBlock ? lastBlock.getStartPC() + lastBlock.getSize() : 0;
    console.log(`# method ${name}  pc ${first}..${last}  blocks=${blocks.length}`
        + `  instructions=${method.methodCode?.instructions?.length ?? 0}`);

    const tryBlocks = method.methodCode?.pandaMethodTryBlocks ?? [];
    if (tryBlocks.length === 0) console.log("# raw try table: (none)");
    else {
        console.log(`# raw try table: ${tryBlocks.length}`);
        for (const tryBlock of tryBlocks) {
            const endPC = tryBlock.startPC + tryBlock.length;
            const parts = tryBlock.pandaMethodCatchBlocks.map((catchBlock: any) =>
                `${catchBlock.typeIdx === 0 ? "catchall" : "type" + catchBlock.typeIdx}`
                + `@${catchBlock.handlerPC}+${catchBlock.codeSize}`);
            console.log(`  try ${tryBlock.startPC}..${endPC} -> ${parts.join(", ")}`);
        }
    }

    if (options.entries) printEntries(cfg);
    if (options.plans) printPlans(cfg);
    if (options.writes) printWrites(cfg, options.writes);
    if (options.cfg) printCfg(cfg, options.cfg.from, options.cfg.to);

    if (!options.entries && !options.plans && !options.writes && !options.cfg) {
        printEntries(cfg);
        printPlans(cfg);
    }
}

main();
