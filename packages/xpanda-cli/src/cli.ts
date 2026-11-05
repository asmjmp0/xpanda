/**
 * CLI entry / command dispatch.
 *
 *   yarn xpanda help [decompile|unpack-index|dump-asm|dump|gadget]
 *   yarn xpanda decompile <file.abc|file.hap> [-o outDir] [--no-simplify] [--raw] [--stdout] [--quiet] [-j N] [--timeout SEC]
 *   yarn xpanda unpack-index <resources.index> [-o outDir] [--stdout]
 *   yarn xpanda dump-asm <file.abc|file.hap> [-o outDir] [--stdout]
 *   yarn xpanda dump <file.abc|file.hap> -c <class> [-c ...] [-o out.abc|outDir]
 *   yarn xpanda gadget <file.abc|file.hap> [-o outDir] [--port N] [--entry CLASS] ...
 *   yarn xpanda gadget shell [-p N] [-t serial]
 *   yarn xpanda gadget file <script.js> [--once]
 * @Author: jmp0
 */
import { runDecompile } from "./cli/commands/decompile";
import { runDump } from "./cli/commands/dump";
import { runDumpAsm } from "./cli/commands/dumpAsm";
import { runGadget } from "./cli/commands/gadget";
import { runGadgetFile } from "./cli/commands/gadgetFile";
import { runGadgetShell } from "./cli/commands/gadgetShell";
import { runUnpackIndex } from "./cli/commands/unpackIndex";
import { fail, printUsage } from "./cli/help";
import { ensureCliHeap } from "./cli/heap";

ensureCliHeap();

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    // help command (no arguments is equivalent to help): print usage and exit
    if (args.length === 0 || args[0] === "help" || args[0] === "-h" || args[0] === "--help") {
        printUsage(args[1]);
        return;
    }
    const [command, ...rest] = args;
    switch (command) {
        case "decompile": return runDecompile(rest);
        case "unpack-index": return runUnpackIndex(rest);
        case "dump-asm": return runDumpAsm(rest);
        case "dump": return runDump(rest);
        case "gadget":
            if (rest[0] === "shell") return runGadgetShell(rest.slice(1));
            if (rest[0] === "file") return runGadgetFile(rest.slice(1));
            return runGadget(rest);
        default: fail(`unknown command: ${command}`);
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
