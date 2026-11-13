#!/usr/bin/env node
/**
 * Build the workspace library packages as standalone CommonJS packages under
 * `<package>/dist` (JavaScript + `.d.ts`), so other projects on this machine
 * can link and import them from plain Node.
 *
 * In-repo development is untouched: the workspace package.json files keep
 * `main` pointing at `src/index.ts`, which tsx and Vite consume directly.
 * `yarn install:global` links the library packages from these `dist` copies;
 * `xpanda-cli` / `xpanda-mcp` stay source-linked because their bins run
 * through tsx.
 *
 *   yarn build:local
 * @Author: jmp0
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TSC = path.join(REPO_ROOT, "node_modules", "typescript", "bin", "tsc");

/** Importable libraries. `xpanda-cli` / `xpanda-mcp` are commands, not libraries. */
const PACKAGES = [
    { dir: "packages/xpanda-core", entry: "index.js" },
    { dir: "packages/xpanda-asm", entry: "index.js" },
    { dir: "packages/xpanda-gadget", entry: "index.js" },
];

function fail(message) {
    process.stderr.write(`build-local-packages: ${message}\n`);
    process.exit(1);
}

function run(command, commandArgs, cwd) {
    const result = spawnSync(command, commandArgs, { cwd, stdio: "inherit", env: process.env });
    if (result.error) throw new Error(`${command} failed to start: ${result.error.message}`);
    if (result.status !== 0) throw new Error(`${command} ${commandArgs.join(" ")} exited with ${result.status}`);
}

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, "utf8"));
}

function loadPackages() {
    if (!fs.existsSync(TSC)) fail("typescript is not installed; run `yarn install` first");
    return PACKAGES.map(({ dir, entry }) => {
        const packageDir = path.join(REPO_ROOT, dir);
        const json = readJson(path.join(packageDir, "package.json"));
        return {
            name: json.name,
            version: json.version,
            packageDir,
            distDir: path.join(packageDir, "dist"),
            entry,
            packageJson: json,
        };
    });
}

function buildPackage(pkg) {
    process.stdout.write(`building ${pkg.name}@${pkg.version} ...\n`);
    fs.rmSync(pkg.distDir, { recursive: true, force: true });
    run(process.execPath, [TSC, "-p", "tsconfig.build.json"], pkg.packageDir);

    const entryPath = path.join(pkg.distDir, pkg.entry);
    if (!fs.existsSync(entryPath)) fail(`${pkg.name} build did not produce ${pkg.entry}`);
    const typesEntry = pkg.entry.replace(/\.js$/, ".d.ts");
    if (!fs.existsSync(path.join(pkg.distDir, typesEntry))) fail(`${pkg.name} build did not produce ${typesEntry}`);
    return { entry: `./${pkg.entry}`, types: `./${typesEntry}` };
}

function writeManifest(pkg, entries, allPackages) {
    const json = pkg.packageJson;
    const dependencyTargets = new Map(allPackages.map((dep) => [dep.name, dep]));
    const dependencies = {};
    for (const [name, spec] of Object.entries(json.dependencies ?? {})) {
        const target = dependencyTargets.get(name);
        if (target) {
            // Publishable semver range; the local node_modules symlink below
            // handles sibling resolution for linked consumers.
            dependencies[name] = `^${target.packageJson.version}`;
        } else {
            dependencies[name] = spec;
        }
    }

    const manifest = {
        name: json.name,
        version: json.version,
        description: json.description ?? "",
        main: entries.entry,
        types: entries.types,
        exports: {
            ".": {
                types: entries.types,
                default: entries.entry,
            },
            "./package.json": "./package.json",
        },
    };
    if (Object.keys(dependencies).length > 0) manifest.dependencies = dependencies;
    if (json.peerDependencies) manifest.peerDependencies = json.peerDependencies;
    if (json.engines) manifest.engines = json.engines;
    if (json.license) manifest.license = json.license;

    fs.writeFileSync(path.join(pkg.distDir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);

    // Node resolves a linked package's own dependencies from its real path.
    // Point sibling imports at the built dist instead of the workspace root,
    // whose `main` is still the TypeScript source.
    const nodeModules = path.join(pkg.distDir, "node_modules");
    fs.mkdirSync(nodeModules, { recursive: true });
    for (const name of Object.keys(dependencies)) {
        const target = dependencyTargets.get(name);
        if (!target) continue;
        const linkPath = path.join(nodeModules, ...name.split("/"));
        fs.rmSync(linkPath, { recursive: true, force: true });
        fs.mkdirSync(path.dirname(linkPath), { recursive: true });
        fs.symlinkSync(path.relative(path.dirname(linkPath), target.distDir), linkPath, "dir");
    }
}

function main() {
    const packages = loadPackages();
    for (const pkg of packages) {
        const entries = buildPackage(pkg);
        writeManifest(pkg, entries, packages);
    }
    process.stdout.write(`\nlocal packages:\n`);
    for (const pkg of packages) {
        process.stdout.write(`  ${pkg.name}@${pkg.version} -> ${path.relative(REPO_ROOT, pkg.distDir)}\n`);
    }
    process.stdout.write(`\nRun \`yarn install:global\` to register them, then in another project:\n`);
    process.stdout.write(`  npm link ${packages.map((pkg) => pkg.name).join(" ")}\n`);
    process.stdout.write(`  # or: yarn link ${packages.map((pkg) => pkg.name).join(" ")}\n`);
}

main();
