/**
 * xpanda 公共 API —— Node 入口。
 * 浏览器子集见 ./browser(经 package.json exports 的 "browser" 条件解析);
 * 本入口额外提供 parallel(worker_threads)。core 不做磁盘 IO,读写文件由 cli / mcp 各自实现。
 * @Author: jmp0
 */
export * from "./browser";
export { decompileClassesParallel, resolveJobs } from "./parallel/ParallelDecompiler";
export type { ParallelDecompileOptions } from "./parallel/ParallelDecompiler";
