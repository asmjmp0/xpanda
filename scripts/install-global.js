#!/usr/bin/env node
/**
 * Symlink this repo's @asm-xpanda/* packages into the global package folders
 * and put `xpanda` / `xpanda-mcp` on PATH.
 *
 *   yarn install:global
 *   yarn install:global -- --remove
 *   node scripts/install-global.js [--dry-run] [--remove]
 *
 * Libraries (@asm-xpanda/core, @asm-xpanda/asm, @asm-xpanda/gadget) are linked from their
 * built `dist` directories, so another project can require/import them from
 * plain Node without tsx. The build runs automatically before linking; after
 * changing source, rerun `yarn build:local` (no re-link needed). Commands
 * (@asm-xpanda/cli, @asm-xpanda/mcp) stay source-linked because their bins run through
 * tsx. @asm-xpanda/web is a browser app without a Node entry and is skipped.
 *
 * The links point at this checkout, so nothing is published or copied. A
 * destination that is not already a symlink into an xpanda checkout is left
 * untouched, and the command exits before changing anything.
 * @Author: jmp0
 */
"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

/**
 * `linkFromDist` packages are importable libraries: their workspace `main`
 * is still the TypeScript source, so the global link must target the built
 * JavaScript package instead. CLI/MCP are commands and keep the source link.
 */
const PACKAGE_ENTRIES = [
    { dir: "packages/xpanda-core", linkFromDist: true },
    { dir: "packages/xpanda-asm", linkFromDist: true },
    { dir: "packages/xpanda-gadget", linkFromDist: true },
    { dir: "packages/xpanda-cli", linkFromDist: false },
    { dir: "packages/xpanda-mcp", linkFromDist: false },
];


function fail(message) {
    process.stderr.write(`install-global: ${message}\n`);
    process.exit(1);
}

function lastLine(text) {
    const lines = String(text || "").split("\n").map((line) => line.trim()).filter(Boolean);
    return lines.length === 0 ? "" : lines[lines.length - 1];
}

function run(cmd, args) {
    const result = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8" });
    if (result.error) fail(`cannot run ${cmd}: ${result.error.message}`);
    if (result.status !== 0) {
        fail((result.stderr || result.stdout || `${cmd} ${args.join(" ")} failed`).trim());
    }
    return result.stdout || "";
}

function yarnLinkFolder() {
    const result = spawnSync("yarn", ["config", "get", "link-folder"], { cwd: ROOT, encoding: "utf8" });
    const configured = result.status === 0 ? lastLine(result.stdout) : "";
    if (configured && configured !== "undefined" && configured !== "null") return path.resolve(configured);
    if (process.platform === "win32" && process.env.LOCALAPPDATA) {
        return path.join(process.env.LOCALAPPDATA, "Yarn", "Data", "link");
    }
    if (process.platform !== "win32" && process.env.XDG_DATA_HOME) {
        return path.join(process.env.XDG_DATA_HOME, "yarn", "link");
    }
    return path.join(os.homedir(), ".config", "yarn", "link");
}

function npmRootGlobal() {
    return lastLine(run("npm", ["root", "-g"]));
}

function binDirs() {
    const dirs = [];
    const yarnBin = lastLine(run("yarn", ["global", "bin"]));
    if (yarnBin) dirs.push(yarnBin);
    const prefix = lastLine(run("npm", ["prefix", "-g"]));
    if (prefix) dirs.push(process.platform === "win32" ? prefix : path.join(prefix, "bin"));
    const unique = [];
    for (const dir of dirs) {
        const resolved = path.resolve(dir);
        if (!unique.includes(resolved)) unique.push(resolved);
    }
    return unique;
}

function loadPackages() {
    return PACKAGE_ENTRIES.map(({ dir: relDir, linkFromDist }) => {
        const dir = path.join(ROOT, relDir);
        const manifest = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
        if (typeof manifest.name !== "string" || !manifest.name.startsWith("@asm-xpanda/")) {
            fail(`${relDir} must be named @asm-xpanda/* (found ${manifest.name || "nothing"})`);
        }
        if (manifest.private) return null;
        const bins = [];
        const binField = manifest.bin;
        const entries = binField == null ? [] : typeof binField === "string" ? [[path.basename(manifest.name), binField]] : Object.entries(binField);
        for (const [name, rel] of entries) {
            if (typeof rel !== "string" || !name || name.includes("/") || name.includes("\\")) {
                fail(`invalid bin name "${name}" in ${manifest.name}`);
            }
            const file = path.resolve(dir, rel);
            if (!fs.existsSync(file)) fail(`bin ${name} of ${manifest.name} is missing: ${file}`);
            bins.push({ name, file });
        }
        return { name: manifest.name, dir, linkDir: linkFromDist ? path.join(dir, "dist") : dir, linkFromDist, bins };
    }).filter(Boolean);
}

function packageDest(folder, packageName) {
    return path.join(folder, ...packageName.split("/"));
}

function realOrNull(target) {
    try {
        return fs.realpathSync(target);
    } catch {
        return null;
    }
}

function isInside(parent, child) {
    const rel = path.relative(parent, child);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** Another checkout of the same package, recognized by its repo-relative suffix. */
function samePackageElsewhere(absTarget, repoSuffix) {
    const normalized = absTarget.split(path.sep).join("/");
    return normalized.endsWith("/" + repoSuffix);
}

function repoSuffix(absPath) {
    const rel = path.relative(ROOT, absPath);
    if (rel.startsWith("..") || path.isAbsolute(rel)) fail(`path is outside the repo: ${absPath}`);
    return rel.split(path.sep).join("/");
}

/**
 * create   — dest is absent
 * keep     — already points at the expected target
 * replace  — points at this repo, or at another xpanda checkout of the same package
 * conflict — anything else; do not touch it
 */
function classify(dest, expected) {
    let st;
    try {
        st = fs.lstatSync(dest);
    } catch (err) {
        if (err.code === "ENOENT") return { action: "create" };
        throw err;
    }
    if (!st.isSymbolicLink()) return { action: "conflict", reason: "exists and is not a symlink" };
    const raw = fs.readlinkSync(dest);
    const abs = path.resolve(path.dirname(dest), raw);
    const real = realOrNull(dest);
    if (real && path.resolve(real) === path.resolve(expected)) return { action: "keep" };
    const root = fs.realpathSync(ROOT);
    const insideThis = real != null && isInside(root, real);
    const suffix = repoSuffix(expected);
    if (insideThis || samePackageElsewhere(abs, suffix)) return { action: "replace", from: raw };
    return { action: "conflict", reason: `points at ${raw}` };
}

function ownedLink(dest, expected) {
    let st;
    try {
        st = fs.lstatSync(dest);
    } catch (err) {
        if (err.code === "ENOENT") return false;
        throw err;
    }
    if (!st.isSymbolicLink()) return { ok: false, reason: "not a symlink" };
    const abs = path.resolve(path.dirname(dest), fs.readlinkSync(dest));
    const real = realOrNull(dest);
    const root = fs.realpathSync(ROOT);
    if (real && isInside(root, real)) return { ok: true };
    if (samePackageElsewhere(abs, repoSuffix(expected))) return { ok: true };
    return { ok: false, reason: `points at ${fs.readlinkSync(dest)}` };
}

function ensureParent(dest) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
}

function assertWritable(dir) {
    try {
        fs.mkdirSync(dir, { recursive: true });
        fs.accessSync(dir, fs.constants.W_OK);
    } catch (err) {
        if (err.code === "EACCES" || err.code === "EPERM") {
            fail(
                `${dir} is not writable. This command does not use sudo.\n` +
                "Point npm at a user-owned prefix and retry, for example:\n" +
                "  npm config set prefix ~/.local\n" +
                "and add ~/.local/bin to PATH.",
            );
        }
        throw err;
    }
}

function placeSymlink(target, dest, kind) {
    try {
        if (fs.lstatSync(dest).isSymbolicLink()) fs.unlinkSync(dest);
    } catch (err) {
        if (err.code !== "ENOENT") throw err;
    }
    ensureParent(dest);
    fs.symlinkSync(target, dest, kind);
}

function destinations(pkg, linkFolder, modulesDir, bins) {
    const found = [
        { label: pkg.name, dest: packageDest(linkFolder, pkg.name), target: pkg.linkDir, kind: "dir" },
        { label: pkg.name, dest: packageDest(modulesDir, pkg.name), target: pkg.linkDir, kind: "dir" },
    ];
    for (const binDir of bins) {
        for (const bin of pkg.bins) {
            found.push({ label: `bin ${bin.name}`, dest: path.join(binDir, bin.name), target: bin.file, kind: "file" });
        }
    }
    return found;
}

function parseArgs(argv) {
    let remove = false;
    let dryRun = false;
    for (const arg of argv) {
        if (arg === "--remove" || arg === "--unlink") remove = true;
        else if (arg === "--dry-run") dryRun = true;
        else if (arg === "-h" || arg === "--help") {
            process.stdout.write("Usage: yarn install:global [-- --dry-run] [-- --remove]\n");
            process.exit(0);
        } else fail(`unknown argument: ${arg}`);
    }
    return { remove, dryRun };
}

function main() {
    const { remove, dryRun } = parseArgs(process.argv.slice(2));
    const packages = loadPackages();
    const linkFolder = yarnLinkFolder();
    const modulesDir = npmRootGlobal();
    const bins = binDirs();
    if (!remove) {
        const tsx = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
        if (!fs.existsSync(tsx)) fail("tsx was not found. Run `yarn install` in this repository first.");
        if (!dryRun) {
            const build = spawnSync(process.execPath, [path.join(ROOT, "scripts", "build-local-packages.mjs")], {
                cwd: ROOT,
                stdio: "inherit",
            });
            if (build.error) fail(build.error.message);
            if (build.status !== 0) fail("library build failed");
        }
        for (const pkg of packages) {
            if (!pkg.linkFromDist) continue;
            const manifest = path.join(pkg.linkDir, "package.json");
            if (!fs.existsSync(manifest)) {
                if (dryRun) {
                    process.stderr.write(`warning: ${pkg.name} is not built yet; \`yarn install:global\` would build it first\n`);
                } else {
                    fail(`${pkg.name} is not built: ${manifest} is missing`);
                }
            }
        }
    }

    const steps = [];
    const conflicts = [];
    for (const pkg of packages) {
        for (const item of destinations(pkg, linkFolder, modulesDir, bins)) {
            if (remove) {
                let st;
                try {
                    st = fs.lstatSync(item.dest);
                } catch (err) {
                    if (err.code === "ENOENT") continue;
                    throw err;
                }
                const owned = ownedLink(item.dest, item.target);
                if (owned.ok) steps.push({ action: "remove", ...item });
                else if (st) conflicts.push(`${item.label}: ${item.dest} ${owned.reason}`);
                continue;
            }
            const found = classify(item.dest, item.target);
            if (found.action === "conflict") conflicts.push(`${item.label}: ${item.dest} ${found.reason}`);
            else steps.push({ action: found.action, from: found.from, ...item });
        }
    }

    if (conflicts.length > 0) {
        process.stderr.write("install-global: refusing to touch destinations that are not an xpanda checkout:\n");
        for (const line of conflicts) process.stderr.write(`  ${line}\n`);
        process.stderr.write("install-global: nothing was changed.\n");
        process.exit(1);
    }

    if (!dryRun) {
        const parents = new Set();
        for (const step of steps) {
            if (step.action === "keep") continue;
            parents.add(path.dirname(step.dest));
        }
        for (const dir of parents) assertWritable(dir);
    }

    const verb = dryRun ? "would" : "did";
    for (const step of steps) {
        if (step.action === "keep") {
            process.stdout.write(`keep ${step.label} -> ${step.dest}\n`);
            continue;
        }
        if (step.action === "remove") {
            process.stdout.write(`${verb} remove ${step.label} (${step.dest})\n`);
            if (!dryRun) fs.unlinkSync(step.dest);
            continue;
        }
        const detail = step.from ? ` (was ${step.from})` : "";
        process.stdout.write(`${verb} ${step.action} ${step.label} -> ${step.dest}${detail}\n`);
        if (!dryRun) {
            if (step.kind === "file") fs.chmodSync(step.target, 0o755);
            placeSymlink(step.target, step.dest, step.kind);
        }
    }
    if (steps.length === 0) process.stdout.write(remove ? "nothing to remove\n" : "nothing to link\n");
    if (!remove && conflicts.length === 0) {
        const pathEntries = (process.env.PATH || "").split(path.delimiter);
        for (const binDir of bins) {
            if (!pathEntries.includes(binDir)) process.stderr.write(`warning: ${binDir} is not on PATH\n`);
        }
        if (!dryRun) {
            process.stdout.write("\nCommands: xpanda, xpanda-mcp\n");
            process.stdout.write("From another project: yarn link @asm-xpanda/core   or   npm link @asm-xpanda/core\n");
            process.stdout.write("Undo: yarn install:global -- --remove\n");
        }
    }
}

main();
