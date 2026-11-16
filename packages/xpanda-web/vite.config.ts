import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * xpanda-web build config.
 * xpanda-core enters dev / build as TS sources (no pre-compile step needed);
 * the CommonJS @babel/* packages are handled by Vite's built-in interop.
 * @Author: jmp0
 */

/**
 * Resolve the sibling workspace core by path instead of relying on the
 * node_modules workspace link: a `git pull` refreshes the working tree but not
 * node_modules, so after the package set changed (e.g. the @asm-xpanda scope
 * move) a stale link made Rollup fail to resolve the bare specifier on the
 * deploy box. Aliasing to the checked-out source makes the build depend only
 * on the repository contents.
 */
const pkgDir = path.dirname(fileURLToPath(import.meta.url));
const coreDir = path.resolve(pkgDir, "..", "xpanda-core");

export default defineConfig({
    // 部署在 https://tencent.jmp0.top/xpanda/ 子路径下
    base: "/xpanda/",
    plugins: [react()],
    resolve: {
        alias: [
            // The bare-specifier alias also prefix-matches subpath imports, so
            // the more specific "/package.json" entry must come first
            // (version.ts reads the core version from it); otherwise it would
            // be rewritten to "<src/index.ts>/package.json".
            {
                find: "@asm-xpanda/core/package.json",
                replacement: path.join(coreDir, "package.json"),
            },
            { find: "@asm-xpanda/core", replacement: path.join(coreDir, "src/index.ts") },
        ],
    },
    // simplify worker 使用 ES module:与主 bundle 相同的模块语义,
    // 避免 IIFE worker 在打包 @babel/* 的 CJS 互操作时出问题
    worker: {
        format: "es",
    },
    build: {
        // babel 全家桶 + core 体积可观,放宽 chunk 警告
        chunkSizeWarningLimit: 4096,
    },
});
