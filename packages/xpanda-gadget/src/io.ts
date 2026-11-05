/**
 * Disk IO helpers for the xpanda-gadget CLI (Node only; the library API stays Uint8Array-based).
 * @Author: jmp0
 */
import * as fs from "node:fs";
import * as path from "node:path";

export function readInputBytes(filePath: string): Uint8Array {
    return new Uint8Array(fs.readFileSync(filePath));
}

export function writeOutputBytes(filePath: string, data: Uint8Array): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, data);
}

export function isHapPath(filePath: string): boolean {
    return filePath.toLowerCase().endsWith(".hap");
}
