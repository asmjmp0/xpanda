/**
 * es2abc discovery and invocation for compiling hook source modules.
 * @Author: jmp0
 */
import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import { PandaPatchError } from "./PatchTypes";

/** 已知 bytecode 版本 → es2abc --target-api-version(保证 hook 与目标同版本) */
const TARGET_API_BY_BC_VERSION: Record<string, number> = {
    "12.0.2.0": 12,
    "12.0.6.0": 13,
    "13.0.1.0": 18,
    "24.0.0.0": 24,
};

/** 目标 abc 的 bytecode 版本 → es2abc target-api-version(未知版本时探测) */
export function resolveTargetApiVersion(es2abc: string, bcVersion: string, explicit?: number): number {
    if (explicit !== undefined) return explicit;
    const known = TARGET_API_BY_BC_VERSION[bcVersion];
    if (known !== undefined) return known;
    for (let api = 12; api <= 40; api++) {
        try {
            const output = execFileSync(es2abc, ["--target-bc-version", "--target-api-version", String(api)], {
                encoding: "utf8",
                stdio: ["ignore", "pipe", "ignore"],
            }).trim();
            if (output === bcVersion) return api;
        } catch {
            // 该 API 版本不可用,继续尝试
        }
    }
    throw new PandaPatchError(
        `target bytecode version '${bcVersion}' is not supported by es2abc; pass targetApiVersion explicitly`);
}

/** 仓库内置 es2abc 的路径(按操作系统选择 macos / windows / linux) */
function bundledEs2abcPath(): string | null {
    let platformDir: string;
    switch (process.platform) {
        case "darwin":
            platformDir = "macos";
            break;
        case "win32":
            platformDir = "windows";
            break;
        case "linux":
            platformDir = "linux";
            break;
        default:
            return null;
    }
    const executable = process.platform === "win32" ? "es2abc.exe" : "es2abc";
    // __dirname is <repo>/packages/xpanda-asm/src/patch — four levels down from the repo root.
    return path.resolve(__dirname, "..", "..", "..", "..", "assets", "bin", platformDir, executable);
}

/** 定位 es2abc:显式路径 > XPANDA_ES2ABC > 仓库 assets/bin/<os>/es2abc[.exe] > PATH */
export function resolveEs2abc(explicit?: string): string {
    const candidates: string[] = [];
    if (explicit) candidates.push(explicit);
    if (process.env.XPANDA_ES2ABC) candidates.push(process.env.XPANDA_ES2ABC);
    const bundled = bundledEs2abcPath();
    if (bundled) candidates.push(bundled);
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
    }
    return process.platform === "win32" ? "es2abc.exe" : "es2abc"; // 交给 PATH
}

export function runEs2abc(binary: string, args: string[]): void {
    try {
        execFileSync(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
        const failure = error as { stderr?: Buffer; message?: string };
        const stderr = failure.stderr ? failure.stderr.toString().trim() : "";
        throw new PandaPatchError(
            `es2abc failed: ${binary} ${args.join(" ")}\n${failure.message ?? ""}${stderr ? `\n${stderr}` : ""}`);
    }
}
