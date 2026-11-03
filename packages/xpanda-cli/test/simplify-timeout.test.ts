/**
 * --timeout: a simplify that runs past the limit is killed, the raw output is kept,
 * and the CLI reports every such class once after the run.
 * @Author: jmp0
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";
import { ENTRY_FUNCTION_MAIN, PandaDecompiler, PandaFile } from "xpanda-core";
import type { PandaClass } from "xpanda-core";
import { decompileClassesParallel } from "../src/parallel/ParallelDecompiler";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error("ASSERT FAILED: " + message);
}

function loadClass(): PandaClass {
    const sample = path.resolve(__dirname, "..", "..", "xpanda-core", "test", "resources", "class.abc");
    const pandaFile = new PandaFile(new Uint8Array(fs.readFileSync(sample)));
    const clazz = pandaFile.getAllClasses().find((item) => item.pandaMethods.has(ENTRY_FUNCTION_MAIN));
    assert(clazz, "class.abc must contain a class with func_main_0");
    return clazz;
}

async function main(): Promise<void> {
    const clazz = loadClass();
    const decompiler = new PandaDecompiler();
    const raw = decompiler.decompileClassRaw(clazz);
    const simplified = decompiler.decompileClass(clazz);
    assert(raw.length > 0, "raw output must not be empty");

    const fastTimeouts: string[] = [];
    const fast = await decompileClassesParallel(decompiler, [clazz], {
        jobs: 1,
        simplifyTimeoutMs: 5000,
        onSimplifyTimeout: (name) => fastTimeouts.push(name),
    });
    assert(fastTimeouts.length === 0, "a fast simplify must not time out");
    assert(fast[0] === simplified, "without a timeout the simplified output is kept");

    const previous = process.env.XPANDA_TEST_SIMPLIFY_SPIN_MS;
    process.env.XPANDA_TEST_SIMPLIFY_SPIN_MS = "8000";
    try {
        const started = Date.now();
        const timedOut: string[] = [];
        const serial = await decompileClassesParallel(decompiler, [clazz], {
            jobs: 1,
            simplifyTimeoutMs: 400,
            onSimplifyTimeout: (name) => timedOut.push(name),
        });
        const elapsed = Date.now() - started;
        assert(elapsed < 4000, `serial timeout took ${elapsed}ms, the spin was not aborted`);
        assert(timedOut.join(",") === clazz.name.content, `serial timeout classes: ${timedOut.join(",")}`);
        assert(serial[0] === raw, "serial timeout must keep the raw output");

        const parallelNames: string[] = [];
        const parallelStarted = Date.now();
        const parallel = await decompileClassesParallel(decompiler, [clazz, clazz], {
            jobs: 2,
            simplifyTimeoutMs: 400,
            onSimplifyTimeout: (name) => parallelNames.push(name),
        });
        const parallelElapsed = Date.now() - parallelStarted;
        assert(parallelElapsed < 4000, `parallel timeout took ${parallelElapsed}ms`);
        assert(parallelNames.length === 2, `expected two timeouts, got ${parallelNames.length}`);
        assert(parallel[0] === raw && parallel[1] === raw, "parallel timeout must keep raw for every class");
    } finally {
        if (previous === undefined) delete process.env.XPANDA_TEST_SIMPLIFY_SPIN_MS;
        else process.env.XPANDA_TEST_SIMPLIFY_SPIN_MS = previous;
    }

    const tsx = path.resolve(__dirname, "..", "..", "..", "node_modules", ".bin",
        process.platform === "win32" ? "tsx.cmd" : "tsx");
    const sample = path.resolve(__dirname, "..", "..", "xpanda-core", "test", "resources", "class.abc");
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "xpanda-timeout-"));
    try {
        const missing = spawnSync(tsx, ["src/cli.ts", "decompile", sample, "--timeout"], {
            cwd: path.resolve(__dirname, ".."),
            encoding: "utf8",
        });
        assert(missing.status !== 0, "--timeout without a value must fail");

        const run = spawnSync(tsx, [
            "src/cli.ts", "decompile", sample, "-o", outDir, "--timeout", "0.4", "--quiet",
        ], {
            cwd: path.resolve(__dirname, ".."),
            encoding: "utf8",
            env: { ...process.env, XPANDA_TEST_SIMPLIFY_SPIN_MS: "8000" },
        });
        assert(run.status === 0, `decompile failed: ${run.stderr}`);
        assert(run.stderr.includes("warn: simplify timed out after 0.4s, kept raw (1):"),
            `missing final warn:\n${run.stderr}`);
        assert(run.stderr.includes("class.abc  L_GLOBAL;"), `warn must name the class:\n${run.stderr}`);
        assert(!run.stderr.includes("warn: simplify timed out after 0.4s, kept raw (1):\nwarn:"),
            "the warning is printed once, at the end");
        const written = fs.readFileSync(path.join(outDir, "_GLOBAL.js"), "utf8");
        assert(written === raw, "the written file must be the raw decompilation");
        if (simplified !== raw) assert(written !== simplified, "timeout must not keep the simplified output");
    } finally {
        fs.rmSync(outDir, { recursive: true, force: true });
    }

    console.log("xpanda-cli simplify timeout: all tests passed");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
