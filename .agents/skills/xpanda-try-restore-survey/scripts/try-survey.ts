/**
 * try-survey: whole-sample audit of try/catch/finally restoration coverage.
 *
 * Cross-checks what the bytecode try table promises against what the decompiled
 * output delivers, in one pass:
 *   - bytecode side: raw try entries, classifyTryEntries kinds (keep/drop),
 *     buildFinallyPlans shapes
 *   - output side: per-class residue scan (try/finally notes, hole, goto,
 *     reserved identifiers, SimpleAnalysis) and strict catch/finally counts
 *   - class-level consistency: kept catch-ish/finally entries vs output counts
 *
 * Exit code 1 = findings (residue, SimpleAnalysis fallback, or count mismatch).
 * Dropped kinds (pureRethrow / asyncReject / forOfClose / forInAcquire /
 * noProtectedRange / for-of-body unknown / empty classicFinally) are design drops
 * and are reported as census, not findings - see SKILL.md for the taxonomy.
 *
 * Usage (from the repo root):
 *   yarn tsx .agents/skills/xpanda-try-restore-survey/scripts/try-survey.ts \
 *     <file.abc|file.hap> [--abc <entry>]
 * @Author: jmp0
 */
import * as fs from "fs";
import { HapFile, PandaDecompiler, PandaFile } from "../../../../packages/xpanda-core/src/index";
import { classifyTryEntries } from "../../../../packages/xpanda-core/src/decompiler/ExceptionTable";
import { buildFinallyPlans } from "../../../../packages/xpanda-core/src/decompiler/TryFinally";

/** kinds that are dropped by design and must NOT count as losses */
const DESIGN_DROP_KINDS = new Set([
    "pureRethrow", "asyncReject", "forOfClose", "forInAcquire",
    "noProtectedRange", "forInRelease",
]);
/** kept kinds that materialize as a `catch` block in the output */
const CATCH_KINDS = new Set(["userCatch", "ignoredCatch"]);
/** kept kinds that materialize as a `finally` block in the output */
const FINALLY_KINDS = new Set(["finallyEpilogue"]);

interface Options { abcEntry: string | null }

function parseArgs(argv: string[]): Options {
    const options: Options = { abcEntry: null };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--abc") options.abcEntry = argv[++i] ?? null;
        else if (argv[i] === "-h" || argv[i] === "--help") {
            console.log(fs.readFileSync(process.argv[1], "utf-8").split("*/")[0]);
            process.exit(0);
        }
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
    console.log(`# hap entry: ${entry.name}`);
    return new PandaFile(hap.readEntry(entry.name)!);
}

interface MethodRow {
    clsShort: string;
    method: string;
    codeSize: number;
    rawTries: number;
    kinds: string;      // "userCatch,pureRethrow(drop)!" style summary
    plans: string;      // "#0c,#1e" style summary
}

interface ClassReport {
    cls: string;
    out: string;
    keptCatches: number;
    keptFinallys: number;
    emptyFinallyCandidates: number; // classicFinal dropped with no plan (see SKILL.md)
    plans: number;
}

function shortClassName(name: string): string {
    return name.split("/").slice(-2).join("/");
}

function main(): void {
    const options = parseArgs(process.argv.slice(2));
    const path = process.argv[2];
    if (!path) {
        console.error("usage: try-survey.ts <file.abc|file.hap> [--abc <entry>]");
        process.exit(2);
    }
    const pandaFile = loadPandaFile(path, options.abcEntry);
    const decompiler = new PandaDecompiler();

    const kindCount = new Map<string, number>();
    const rows: MethodRow[] = [];
    const findings: string[] = [];

    let rawTries = 0, keptEntries = 0, droppedEntries = 0, planTotal = 0;
    let simpleAnalysisClasses = 0, emptyFinallyCandidates = 0;

    for (const cls of pandaFile.getAllClasses()) {
        const clsName = String(cls.name.content);
        const methods = Array.from(cls.pandaMethods as Map<string, any>)
            .filter(([, m]) => !m.methodExternal);
        if (!methods.some(([, m]) => (m.methodCode?.pandaMethodTryBlocks ?? []).length > 0)) continue;

        // one decompile per try-bearing class feeds both the residue scan and counts
        let out = "";
        try { out = decompiler.decompileClass(cls); } catch { out = "<DECOMPILE FAILED>"; }
        const classReport: ClassReport = {
            cls: clsName, out, keptCatches: 0, keptFinallys: 0,
            emptyFinallyCandidates: 0, plans: 0,
        };

        // residue scan (strict patterns; every hit needs eyes, see SKILL.md)
        const residues: string[] = [];
        if (/try\/finally not restored/.test(out)) residues.push("try/finally-note");
        if (/\bhole\b/.test(out)) residues.push("hole");
        if (/xpanda_goto/.test(out)) residues.push("xpanda_goto");
        if (/panda_jmp0_reserved/.test(out)) residues.push("reserved-id");
        if (/created by SimpleAnalysis/.test(out)) residues.push("SimpleAnalysis");
        if (out === "<DECOMPILE FAILED>") residues.push("decompile-failed");
        if (residues.length > 0) {
            findings.push(`residue [${residues.join(",")}]  ${clsName}`);
        }
        if (residues.includes("SimpleAnalysis")) simpleAnalysisClasses++;

        for (const [name, method] of methods) {
            const tryBlocks = method.methodCode?.pandaMethodTryBlocks ?? [];
            if (tryBlocks.length === 0) continue;
            rawTries += tryBlocks.length;

            let cfg: any = null;
            try { cfg = method.disAssemble(); } catch { /* classify below skips */ }
            const kinds: string[] = [];
            let methodPlans = 0;
            if (cfg) {
                try {
                    for (const e of classifyTryEntries(cfg).entries) {
                        const kind = String(e.kind);
                        kindCount.set(kind, (kindCount.get(kind) ?? 0) + 1);
                        kinds.push(`${kind}${e.keep ? "" : "(drop)"}${e.usesException ? "!" : ""}`);
                        if (e.keep) {
                            keptEntries++;
                            if (CATCH_KINDS.has(kind)) classReport.keptCatches++;
                            else if (FINALLY_KINDS.has(kind)) classReport.keptFinallys++;
                        } else {
                            droppedEntries++;
                            if (kind === "classicFinally") classReport.emptyFinallyCandidates++;
                        }
                    }
                } catch { kinds.push("classify-failed"); }
                try {
                    methodPlans = buildFinallyPlans(cfg).length;
                    classReport.plans += methodPlans;
                } catch { /* plan census skips this method */ }
            }
            rows.push({
                clsShort: shortClassName(clsName), method: String(name),
                codeSize: method.methodCode?.codeSize ?? 0,
                rawTries: tryBlocks.length, kinds: kinds.join(",") || "disasm-failed",
                plans: String(methodPlans),
            });
        }

        emptyFinallyCandidates += classReport.emptyFinallyCandidates;
        planTotal += classReport.plans;

        // class-level consistency: strict regexes (SKILL.md pitfalls)
        const outCatches = (out.match(/\}\s*catch\s*\(/g) ?? []).length;
        const outFinally = (out.match(/\bfinally\s*\{/g) ?? []).length;
        if (outCatches !== classReport.keptCatches || outFinally !== classReport.keptFinallys) {
            findings.push(`count-mismatch  ${shortClassName(clsName)}`
                + `  kept catch=${classReport.keptCatches} finally=${classReport.keptFinallys}`
                + `  out catch=${outCatches} finally=${outFinally}`);
        }
    }

    // ---- census ----
    console.log(`# version ${pandaFile.header.versionString()}`);
    console.log(`# methods with try entries: ${rows.length}`);
    console.log(`# raw try entries: ${rawTries}  kept=${keptEntries} dropped=${droppedEntries}`);
    for (const [k, n] of [...kindCount.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`#   kind=${k}: ${n}`);
    }
    console.log(`# finally plans: ${planTotal}`);
    console.log(`# classes with SimpleAnalysis residue: ${simpleAnalysisClasses}`);
    console.log(`# empty-finally candidates (classicFinally dropped, no plan):`
        + ` ${emptyFinallyCandidates}  (verify with abc-inspect --cfg, see SKILL.md)`);

    // ---- per-method detail ----
    console.log("\n# per-method detail:");
    for (const r of rows) {
        console.log(`  ${r.clsShort}  ${r.method}  code=${r.codeSize} raw=${r.rawTries}`
            + `  plans=[${r.plans}]  [${r.kinds}]`);
    }

    // ---- verdict ----
    console.log(`\n# findings: ${findings.length}`);
    for (const f of findings) console.log(`  ! ${f}`);
    if (findings.length > 0) {
        console.log("# RESULT: findings present - drill down with abc-inspect (SKILL.md §3)");
        process.exit(1);
    }
    console.log("# RESULT: clean - no residue, no SimpleAnalysis, all kept catch/finally"
        + " entries materialized in the output");
}

main();
