#!/usr/bin/env node
/**
 * Global bin for @asm-xpanda/cli. Loads the TypeScript entry through tsx
 * resolved from this package, so the caller's working directory does not matter.
 * @Author: jmp0
 */
"use strict";

const { spawnSync } = require("child_process");
const path = require("path");
const { createRequire } = require("module");

const entry = path.join(__dirname, "..", "src", "cli.ts");

let tsxCli;
try {
    tsxCli = createRequire(__filename).resolve("tsx/cli");
} catch (e) {
    console.error("xpanda: cannot resolve tsx. Run `yarn install` in the xpanda checkout, then `yarn install:global` again.");
    process.exit(1);
}

const child = spawnSync(process.execPath, [tsxCli, entry, ...process.argv.slice(2)], {
    stdio: "inherit",
});
if (child.error) {
    console.error(child.error.message);
    process.exit(1);
}
if (child.signal) process.kill(process.pid, child.signal);
process.exit(child.status == null ? 1 : child.status);
