import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * xpanda-web 构建配置。
 * xpanda-core 以 TS 源码形式(workspace link,main 指向 src/index.ts)直接进入
 * dev / build 流水线,无需预先编译;@babel/* 由 Vite 内置的 commonjs 处理。
 * @Author: jmp0
 */
export default defineConfig({
    // 部署在 https://tencent.jmp0.top/xpanda/ 子路径下
    base: "/xpanda/",
    plugins: [react()],
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
