/**
 * CLI usage text and the shared parse-failure path.
 * @Author: jmp0
 */

export function printDecompileUsage(): void {
    console.log("Usage: xpanda decompile <file.abc|file.hap> [-o outDir] [--no-simplify] [--stdout] [--quiet] [-j N] [--timeout SEC]");
    console.log("  file.hap         HarmonyOS app package: decompiles every .abc entry and unpacks resources.index plus resources/ files");
    console.log("  -o outDir        Writes .js files named by class (default out/; in hap mode abc entries go to outDir/<entry path>/)");
    console.log("  --no-simplify    Disables the optimizer (skips the simplify stage, same as --raw)");
    console.log("  --stdout         Concatenates the result to standard output");
    console.log("  --quiet          Hides the progress view (class total, current class, simplify workers)");
    console.log("  -j, --jobs N     Worker count for per-class parallel simplify; 0 = auto (CPU-1, capped at 4)");
    console.log("  --timeout SEC    Stop simplify after SEC seconds and keep that class's raw output. Warns at the end. 0 disables");
}

export function printUnpackIndexUsage(): void {
    console.log("Usage: xpanda unpack-index <resources.index> [-o outDir] [--stdout]");
    console.log("  Unpacks a HarmonyOS resources.index (supports both Restool and RestoolV2 formats)");
    console.log("  -o outDir        Writes resources.json (default out/)");
    console.log("  --stdout         Prints the JSON to standard output");
}

export function printDumpAsmUsage(): void {
    console.log("Usage: xpanda dump-asm <file.abc|file.hap> [-o outDir] [--stdout]");
    console.log("  Disassembles every class to bytecode assembly (.asm files, same per-class layout as decompile)");
    console.log("  file.hap         HarmonyOS app package: dumps every .abc entry (to outDir/<entry path>/)");
    console.log("  -o outDir        Writes .asm files named by class (default out/)");
    console.log("  --stdout         Concatenates the result to standard output");
}

export function printDumpUsage(): void {
    console.log("Usage: xpanda dump <file.abc|file.hap> -c <class> [-c <class> ...] [-o out.abc|outDir]");
    console.log("  Copies one or more classes (plus the classes/methods they reference) into a new .abc file");
    console.log("  -c, --class NAME  Class to dump: Lpkg/Name;, pkg/Name, or a unique name suffix; repeatable or comma-separated");
    console.log("  -o PATH           .abc input: output file (default dump.abc); .hap input: output directory (default out/)");
    console.log("                    A hap writes one <entry>.dump.abc per .abc entry that contains matching classes");
}

export function printGadgetUsage(): void {
    console.log("Usage: xpanda gadget <file.abc|file.hap> [options]        (also: xpanda gadget inject <file>)");
    console.log("       xpanda gadget shell [options]                      (interactive JS overlay)");
    console.log("       xpanda gadget file <script.js> [options]           (run on start + every save)");
    console.log("  Injects the xpanda-gadget bootstrap into the entry func_main_0 and, for a hap, embeds");
    console.log("  libxpanda_gadget.so under libs/<abi>/ before rebuilding the ZIP (re-sign before installing).");
    console.log("  -o, --output DIR  Output directory (default: alongside the input)");
    console.log("  --stdout          Write the patched bytes to standard output");
    console.log("  --port N          Gadget socket port baked into the bootstrap (default 27041)");
    console.log("  --entry CLASS     Entry class whose func_main_0 starts the gadget");
    console.log("  --abc NAME        HAP: abc entry to patch (e.g. ets/modules.abc)");
    console.log("  --all             HAP: patch every abc entry");
    console.log("  --abi ABI         HAP: libs/<abi> for the embedded .so (default arm64-v8a)");
    console.log("  --so PATH         HAP: explicit gadget .so to embed");
    console.log("  --so-name NAME    Module request name for the .so (default libxpanda_gadget.so)");
    console.log("  --no-so           HAP: patch bytecode only, do not embed a .so");
    console.log("  --keep-temp       Keep es2abc temp files (debug)");
    console.log("  -q, --quiet       Suppress the summary output");
}

export function printGadgetShellUsage(): void {
    console.log("Usage: xpanda gadget shell [options]");
    console.log("  Forwards the gadget socket over hdc (`hdc fport tcp:<port> localabstract:xpanda_gadget_<port>`)");
    console.log("  and opens an interactive REPL that evaluates JavaScript in the app's gadget VM.");
    console.log("  -p, --port N      Gadget socket port (default 27041)");
    console.log("  -t, --serial S    hdc device serial (passed as `hdc -t S`; default: the only connected device)");
    console.log("  --hdc PATH        hdc binary (default: $HDC / $XPANDA_HDC / PATH / ~/command-line-tools)");
    console.log("  --host HOST       TCP host for the forwarded port (default 127.0.0.1)");
    console.log("  --no-forward      Skip the hdc fport step (connect to an existing forward)");
    console.log("  --keep-forward    Leave the fport rule in place on exit");
    console.log("");
    console.log("  REPL commands: <js> | .info | .ping | .probe | .reset | .msg <json> | .help | .exit");
    console.log("  console.log/info/warn/error/... called by evaluated JS is streamed back and printed here");
    console.log("  ArkTS.hostGlobal  host globalThis snapshot; functions/objects call through; ArkTS.napi.loadModule(path)");
}

export function printGadgetFileUsage(): void {
    console.log("Usage: xpanda gadget file <script.js> [options]");
    console.log("  Runs the script in the gadget VM immediately and again on every save (watch mode).");
    console.log("  Each run keeps the VM alive, so `globalThis` state persists between reloads (use .reset in the shell to clear).");
    console.log("  console.* output from the script is printed with a timestamp; watch mode does not print the script's return value (--once does).");
    console.log("  --once            Execute once and exit (no watch)");
    console.log("  -p, --port N      Gadget socket port (default 27041)");
    console.log("  -t, --serial S    hdc device serial (passed as `hdc -t S`)");
    console.log("  --hdc PATH        hdc binary (default: $HDC / $XPANDA_HDC / PATH / ~/command-line-tools)");
    console.log("  --host HOST       TCP host for the forwarded port (default 127.0.0.1)");
    console.log("  --no-forward      Skip the hdc fport step (connect to an existing forward)");
    console.log("  --keep-forward    Leave the fport rule in place on exit");
}

/** Print usage for one command, or all commands when no (known) topic given. */
export function printUsage(command?: string): void {
    if (command === "decompile") return printDecompileUsage();
    if (command === "unpack-index") return printUnpackIndexUsage();
    if (command === "dump-asm") return printDumpAsmUsage();
    if (command === "dump") return printDumpUsage();
    if (command === "gadget") return printGadgetUsage();
    if (command === "gadget-shell") return printGadgetShellUsage();
    if (command === "gadget-file") return printGadgetFileUsage();
    if (command !== undefined) {
        console.error(`Unknown help topic: ${command} (available: decompile | unpack-index | dump-asm | dump | gadget)`)
    }
    printDecompileUsage();
    printUnpackIndexUsage();
    printDumpAsmUsage();
    printDumpUsage();
    printGadgetUsage();
}

/** Command parse failure: print the reason plus usage, then exit non-zero. */
export function fail(message: string, command?: string): never {
    console.error(message);
    printUsage(command);
    process.exit(1);
}
