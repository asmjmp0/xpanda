/**
 * esbuild build & dev server (full replacement for Vite).
 *
 * This package used to build with Vite (Rollup underneath). On the 2 GiB
 * deploy box the Rollup JS pipeline (parsing all of xpanda-core plus the
 * CommonJS @babel packages for two entries) ran against a 768 MiB V8 old-space
 * cap and still pushed the kernel into direct reclaim until sshd stopped
 * responding — deploys appeared frozen. esbuild is a single Go binary: the
 * same inputs finish in seconds at a few hundred MiB RSS, so Vite is dropped
 * entirely: `yarn build` produces the production dist, `yarn dev` runs a
 * watch + static-serve dev loop with live reload (esbuild has no HMR — a
 * saved file reloads the whole page), and `yarn preview` serves the built
 * dist without building.
 * @Author: jmp0
 */
import { build, context } from "esbuild";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const coreDir = path.resolve(pkgDir, "..", "xpanda-core");
const outDir = path.join(pkgDir, "dist");
const DEV_PORT = 5173;
const serve = process.argv.includes("--serve");

/** The worker URL literal esbuild leaves untouched in the emitted main bundle. */
const workerSourceUrl = "./simplify-worker.ts";

/**
 * Rewrite the worker's new URL(...) literal to the bundled worker entry so the
 * Worker pool resolves at runtime. The relative URL inside a bundle resolves
 * against the bundle's own directory, and the main entry and the worker both
 * live in dist/assets/.
 */
function patchWorkerUrl(mainJsPath, workerFileName) {
    const file = path.join(pkgDir, mainJsPath);
    const source = readFileSync(file, "utf8");
    if (!source.includes(workerSourceUrl)) return;
    writeFileSync(file, source.split(workerSourceUrl).join("./" + workerFileName));
}

/** Shared esbuild options; per-mode flags (minify / define / names) differ. */
function esbuildOptions() {
    return {
        absWorkingDir: pkgDir,
        // Two explicit entries. The worker is referenced in source as
        // new Worker(new URL("./simplify-worker.ts", import.meta.url)),
        // which esbuild does NOT bundle (unlike Vite) — it leaves the URL
        // literal untouched. Listing the worker here bundles it (and lets the
        // two entries share the @babel chunks instead of duplicating them).
        entryPoints: [
            path.join(pkgDir, "src", "main.tsx"),
            path.join(pkgDir, "src", "parallel", "simplify-worker.ts"),
        ],
        bundle: true,
        // shiki's lazy grammar import relies on dynamic-import splitting.
        splitting: true,
        format: "esm",
        target: "es2020",
        jsx: "automatic",
        outdir: outDir,
        // Same alias contract as before: resolve the sibling workspace core by
        // path so the build depends only on the checked-out sources, never on
        // node_modules link state. esbuild picks the longest matching alias,
        // so the "/package.json" subpath (version.ts reads the core version
        // from it) wins over the bare prefix.
        alias: {
            "@asm-xpanda/core/package.json": path.join(coreDir, "package.json"),
            "@asm-xpanda/core": path.join(coreDir, "src/index.ts"),
        },
        logLevel: "info",
    };
}

/**
 * index.html is kept as the template: swap the source script tag for the
 * bundle and inject the extracted stylesheet (plus dev extras) before
 * </head>. `extraHead` carries the dev-only live-reload snippet.
 */
function renderIndexHtml(mainSrc, cssHrefs, extraHead = "") {
    const devTag = '<script type="module" src="/src/main.tsx"></script>';
    let html = readFileSync(path.join(pkgDir, "index.html"), "utf8");
    if (!html.includes(devTag)) {
        console.error('error: index.html no longer contains the expected "' + devTag + '" tag');
        process.exit(1);
    }
    html = html.replace(devTag, `<script type="module" src="${mainSrc}"></script>`);
    const links = cssHrefs
        .map((href) => `    <link rel="stylesheet" href="${href}" />`)
        .join("\n");
    return html.replace("</head>", `${links}\n${extraHead}  </head>`);
}

async function buildProduction() {
    rmSync(outDir, { recursive: true, force: true });

    const result = await build({
        ...esbuildOptions(),
        minify: true,
        sourcemap: false,
        // Vite defined this for React's production code path; without it
        // React ships its slower dev build. Other process.env reads stay
        // runtime references served by the `window.process` shim in
        // index.html (and the worker's process-shim.ts import).
        define: { "process.env.NODE_ENV": '"production"' },
        entryNames: "assets/[name]-[hash]",
        chunkNames: "assets/[name]-[hash]",
        assetNames: "assets/[name]-[hash]",
        metafile: true,
    });

    const meta = result.metafile;
    const outputs = Object.keys(meta.outputs);
    const workerJs = outputs.find((out) => path.resolve(meta.outputs[out].entryPoint ?? "") === path.join(pkgDir, "src", "parallel", "simplify-worker.ts"));
    const mainJs = outputs.find((out) => path.resolve(meta.outputs[out].entryPoint ?? "") === path.join(pkgDir, "src", "main.tsx"));
    const cssFiles = outputs.filter((out) => out.endsWith(".css"));
    if (mainJs === undefined || workerJs === undefined || cssFiles.length === 0) {
        console.error("error: build produced no main/worker JS or CSS output");
        process.exit(1);
    }

    for (const jsOutput of outputs.filter((out) => out.endsWith(".js"))) {
        patchWorkerUrl(jsOutput, path.basename(workerJs));
    }

    /** Relative URL for an output path, so the site also works under /xpanda/. */
    const relUrl = (outputPath) => {
        return "./" + path.relative(outDir, path.join(pkgDir, outputPath)).split(path.sep).join("/");
    };
    const html = renderIndexHtml(
        relUrl(mainJs),
        cssFiles.map(relUrl),
    );
    writeFileSync(path.join(outDir, "index.html"), html);
}

async function runDevServer() {
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });

    // Entry names stay unhashed in dev, so the template is written once and
    // watch rebuilds overwrite the same files without regenerating it.
    writeFileSync(
        path.join(outDir, "index.html"),
        renderIndexHtml(
            "./assets/main.js",
            ["./assets/main.css"],
            // esbuild's serve mode exposes an EventSource stream of rebuild
            // events at /esbuild — the poor man's HMR: reload the whole page.
            `    <script type="module">\n` +
            `      new EventSource("/esbuild").addEventListener("change", () => location.reload());\n` +
            `    </script>\n`,
        ),
    );

    const ctx = await context({
        ...esbuildOptions(),
        minify: false,
        sourcemap: "inline",
        define: { "process.env.NODE_ENV": '"development"' },
        // Entry names stay unhashed in dev, so the worker URL is rewritten to
        // its final name while loading — the emitted bundle is correct by
        // construction and every rebuild stays correct too (serve mode serves
        // the build products from memory, so post-build patches of the output
        // bytes would never be visible to the served files).
        entryNames: "assets/[name]",
        chunkNames: "assets/[name]-[hash]",
        assetNames: "assets/[name]",
        plugins: [{
            name: "dev-worker-url",
            setup(b) {
                b.onLoad({ filter: /SimplifyWorker\.ts$/ }, async (args) => {
                    const source = await fsPromises.readFile(args.path, "utf8");
                    return {
                        contents: source.split(workerSourceUrl).join("./simplify-worker.js"),
                        loader: "ts",
                    };
                });
            },
        }],
    });

    await ctx.watch();
    const { host, port } = await ctx.serve({ servedir: outDir, port: DEV_PORT });
    console.log(`xpanda-web dev server: http://${host ?? "localhost"}:${port} (live reload, no HMR)`);
}

serve ? await runDevServer() : await buildProduction();
