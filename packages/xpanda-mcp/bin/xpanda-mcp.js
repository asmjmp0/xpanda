#!/usr/bin/env node
/**
 * Global bin for @asm-xpanda/mcp. Loads the TypeScript stdio server through tsx.
 * Writes nothing to stdout; MCP framing owns that stream.
 * @Author: jmp0
 */
"use strict";

const { spawnSync } = require("child_process");
const path = require("path");
const { createRequire } = require("module");

const entry = path.join(__dirname, "..", "src", "server.ts");

let tsxCli;
try {
    tsxCli = createRequire(__filename).resolve("tsx/cli");
} catch (e) {
    process.stderr.write("xpanda-mcp: cannot resolve tsx. Run `yarn install` in the xpanda checkout, then `yarn install:global` again.\n");
    process.exit(1);
}

const child = spawnSync(process.execPath, [tsxCli, entry, ...process.argv.slice(2)], {
    stdio: "inherit",
});
if (child.error) {
    process.stderr.write(child.error.message + "\n");
    process.exit(1);
}
if (child.signal) process.kill(process.pid, child.signal);
process.exit(child.status == null ? 1 : child.status);
