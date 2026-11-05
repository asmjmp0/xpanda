/**
 * Input/output helpers shared by the CLI commands.
 * @Author: jmp0
 */
import * as fs from "fs";
import * as path from "path";
import { ZipFile } from "xpanda-core";

/** Read the input file as bytes (path resolved against cwd). */
export function readInputBytes(input: string): Uint8Array {
    return new Uint8Array(fs.readFileSync(path.resolve(input)));
}

/** `.hap` extension or any ZIP container goes through the application-package flow. */
export function isHapInput(input: string, data: Uint8Array): boolean {
    return path.extname(input).toLowerCase() === ".hap" || ZipFile.isZip(data);
}

/** Prefer a repository-relative path for logs, but keep an absolute path when it is outside cwd. */
export function displayPath(outPath: string): string {
    const relative = path.relative(process.cwd(), outPath);
    return relative.length > 0 && !relative.startsWith("..") ? relative : outPath;
}

/** Write bytes, creating the parent directory when needed. */
export function writeBytesEnsured(outPath: string, data: Uint8Array): void {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, data);
}
