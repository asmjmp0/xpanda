/**
 * Progress panel layout: class total, the class being decompiled, and each simplify worker.
 * @Author: jmp0
 */
import type { WriteStream } from "tty";
import { DecompileProgress, formatElapsed, renderProgress, truncateName } from "../src/progress";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error("ASSERT FAILED: " + message);
}

function main(): void {
    assert(formatElapsed(0) === "0s", "zero");
    assert(formatElapsed(4000) === "4s", "seconds");
    assert(formatElapsed(63_000) === "1m03s", "minutes");
    assert(formatElapsed(3_661_000) === "1h01m01s", "hours");
    assert(truncateName("abcdef", 4) === "…def", "truncate keeps the tail");
    assert(truncateName("abc", 10) === "abc", "short names stay");

    const parallel = renderProgress({
        title: "modules.abc",
        total: 540,
        done: 12,
        elapsedMs: 63_000,
        decompiling: "Lentry/src/main/ets/pages/Index;",
        simplify: null,
        workers: ["Lfeature/Foo;", null],
        showSimplify: true,
        columns: 80,
        color: false,
        spinner: 0,
    });
    assert(parallel[0] === "modules.abc   540 classes", `title: ${parallel[0]}`);
    assert(parallel[1] === "█░░░░░░░░░░░░░░░░░░░   12/540   2%  1m03s", `bar: ${parallel[1]}`);
    assert(parallel[2] === "⠋ decompile            Lentry/src/main/ets/pages/Index;", `decompile: ${parallel[2]}`);
    assert(parallel[3] === "⠋ worker 1   simplify  Lfeature/Foo;", `worker 1: ${parallel[3]}`);
    assert(parallel[4] === "  worker 2             idle", `worker 2: ${parallel[4]}`);
    const nameColumn = (line: string) => Math.max(line.indexOf("Lentry"), line.indexOf("Lfeature"), line.indexOf("idle"));
    assert(nameColumn(parallel[2]) === nameColumn(parallel[3]) && nameColumn(parallel[3]) === nameColumn(parallel[4]),
        "class names share a column");
    assert(parallel.length === 5, `unexpected extra lines: ${parallel.length}`);

    const serial = renderProgress({
        title: "class.abc",
        total: 1,
        done: 0,
        elapsedMs: 1000,
        decompiling: null,
        simplify: "L_GLOBAL;",
        workers: null,
        showSimplify: true,
        columns: 40,
        color: false,
        spinner: 1,
    });
    assert(serial[0] === "class.abc   1 class", `serial title: ${serial[0]}`);
    assert(serial[2] === "  decompile  idle", `serial decompile: ${serial[2]}`);
    assert(serial[3] === "⠙ simplify   L_GLOBAL;", `serial simplify: ${serial[3]}`);

    const raw = renderProgress({
        title: "class.abc",
        total: 4,
        done: 4,
        elapsedMs: 2000,
        decompiling: null,
        simplify: null,
        workers: null,
        showSimplify: false,
        columns: 40,
        color: false,
        spinner: 0,
    });
    assert(raw.length === 3, "raw mode has no simplify row");
    assert(raw[1].startsWith("████████████████████"), `full bar: ${raw[1]}`);
    assert(raw[1].includes("4/4") && raw[1].includes("100%"), `full counts: ${raw[1]}`);

    const longName = "L" + "pkg/".repeat(30) + "Tail;";
    const clipped = renderProgress({
        title: "app.abc",
        total: 3,
        done: 1,
        elapsedMs: 0,
        decompiling: longName,
        simplify: null,
        workers: null,
        showSimplify: false,
        columns: 40,
        color: false,
        spinner: 0,
    });
    assert(clipped[2].includes("…") && clipped[2].endsWith("Tail;"), `clipped: ${clipped[2]}`);
    assert(clipped[2].length <= 40, `line wider than the terminal: ${clipped[2].length}`);

    const chunks: string[] = [];
    const stream = {
        isTTY: true,
        columns: 80,
        write(chunk: string) {
            chunks.push(chunk);
            return true;
        },
    } as unknown as WriteStream;
    const previousColor = process.env.NO_COLOR;
    const previousTerm = process.env.TERM;
    process.env.NO_COLOR = "1";
    process.env.TERM = "xterm-256color";
    try {
        const progress = new DecompileProgress(true, stream);
        progress.begin("class.abc", 2, 2, true);
        progress.setDecompiling("L_GLOBAL;");
        progress.setWorker(0, "LFoo;");
        progress.markDone();
        progress.finish("class.abc  2 classes, 2 written  →  out");
        const text = chunks.join("");
        assert(text.includes("\x1b[?25l"), "live panel hides the cursor");
        assert(text.includes("L_GLOBAL;"), "panel shows the class being decompiled");
        assert(text.includes("LFoo;"), "panel shows the worker class");
        assert(text.includes("simplify"), "worker line is marked simplify");
        assert(text.includes("1/2"), "panel advances when a class settles");
        assert(text.includes("\x1b[?25h"), "finish restores the cursor");
        assert(text.includes("class.abc  2 classes, 2 written  →  out"), "finish prints the summary");

        const quiet: string[] = [];
        const quietStream = {
            isTTY: true,
            columns: 80,
            write(chunk: string) {
                quiet.push(chunk);
                return true;
            },
        } as unknown as WriteStream;
        const hidden = new DecompileProgress(false, quietStream);
        hidden.begin("class.abc", 2, 1, true);
        hidden.markDone();
        hidden.finish("should not appear");
        assert(quiet.length === 0, "quiet mode draws nothing");
        hidden.note("decompile failed: LFoo");
        assert(quiet.join("") === "decompile failed: LFoo\n", "quiet mode still prints warnings");

        process.env.TERM = "dumb";
        const dumbChunks: string[] = [];
        const dumbStream = {
            isTTY: true,
            columns: 80,
            write(chunk: string) {
                dumbChunks.push(chunk);
                return true;
            },
        } as unknown as WriteStream;
        const dumb = new DecompileProgress(true, dumbStream);
        dumb.begin("class.abc", 1, 0, true);
        dumb.finish("class.abc  1 class");
        const dumbText = dumbChunks.join("");
        assert(!dumbText.includes("\x1b[?25l"), "a dumb terminal does not draw a live panel");
        assert(dumbText.includes("class.abc  1 class"), "a dumb terminal still prints the summary");
    } finally {
        if (previousColor === undefined) delete process.env.NO_COLOR;
        else process.env.NO_COLOR = previousColor;
        if (previousTerm === undefined) delete process.env.TERM;
        else process.env.TERM = previousTerm;
    }

    console.log("xpanda-cli progress: all tests passed");
}

main();
