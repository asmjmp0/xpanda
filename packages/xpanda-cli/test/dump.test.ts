/**
 * CLI `dump` integration test: dump one/two classes from a .abc and confirm the output is a
 * valid abc that exposes only the requested classes.
 * @Author: jmp0
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
import { PandaFile } from "xpanda-core";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error("ASSERT FAILED: " + message);
}

function runDump(args: string[]): string {
    const tsx = path.resolve(__dirname, "..", "..", "..", "node_modules", ".bin",
        process.platform === "win32" ? "tsx.cmd" : "tsx");
    const result = execFileSync(tsx, ["src/cli.ts", "dump", ...args], {
        cwd: path.resolve(__dirname, ".."),
        encoding: "utf8",
    });
    return result;
}

function realClasses(pandaFile: PandaFile): string[] {
    return pandaFile.getAllClasses()
        .filter((clazz) => !clazz.classExternal && clazz.name.content)
        .map((clazz) => clazz.name.content);
}

function main(): void {
    const sample = path.resolve(__dirname, "..", "..", "xpanda-core", "test", "resources", "class.abc");
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "xpanda-cli-dump-"));
    try {
        const single = path.join(tempDir, "single.abc");
        const output = runDump([sample, "-c", "L_GLOBAL;", "-o", single]);
        assert(output.includes("written:"), `dump must report the output file, got ${output}`);
        assert(fs.existsSync(single), "dump must write the output abc");
        const parsed = new PandaFile(new Uint8Array(fs.readFileSync(single)));
        assert(realClasses(parsed).join(",") === "L_GLOBAL;",
            `single dump must contain only L_GLOBAL;, got ${realClasses(parsed)}`);

        // positional class names + multiple classes in one output
        const multi = path.join(tempDir, "multi.abc");
        runDump([sample, "L_GLOBAL", "L_ESSlotNumberAnnotation", "-o", multi]);
        const parsedMulti = new PandaFile(new Uint8Array(fs.readFileSync(multi)));
        assert(realClasses(parsedMulti).length === 2,
            `multi dump must contain two classes, got ${realClasses(parsedMulti)}`);

        // missing class must fail
        let failed = false;
        try {
            runDump([sample, "-c", "NoSuchClass", "-o", path.join(tempDir, "missing.abc")]);
        } catch {
            failed = true;
        }
        assert(failed, "dump must exit non-zero for an unknown class");
        console.log("xpanda-cli dump: all tests passed");
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

main();
