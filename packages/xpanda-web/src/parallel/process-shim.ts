/**
 * Web Worker 里没有 index.html 上的 `window.process` shim,而 @babel/* 在模块初始化时
 * 会读取 `process.env.BABEL_TYPES_8_BREAKING`、`process.emitWarning`,没有 process 会
 * 直接抛 ReferenceError。这里在 worker 里补一个最小全局 shim。
 *
 * 必须作为 simplify-worker 的第一个 import:ESM 依赖按声明顺序求值,
 * 保证 shim 先于 xpanda-core / @babel/* 执行。
 * @Author: jmp0
 */
interface ProcessShim {
    env: Record<string, string>;
}

const scope = globalThis as unknown as { process?: ProcessShim };
if (!scope.process) scope.process = { env: {} };
