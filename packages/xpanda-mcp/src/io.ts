/**
 * MCP Server 专用磁盘 IO:读取 .abc 与按类名落盘。
 * core 只保留纯反编译能力,磁盘 IO 由本包负责。
 * @Author: jmp0
 */
import * as fs from "fs";
import * as path from "path";
import { isStaticAbcVersion, PandaClass, PandaFile, StaticPandaFile } from "@asm-xpanda/core";

/** 动态(Panda)或 ArkTS-Sta(static runtime)的 .abc 文件上下文 */
export type AbcDataFile = PandaFile | StaticPandaFile;

/** 按头部版本号判断是否为 ArkTS-Sta 字节码(与 CLI 相同的判定) */
export function isStaticAbcData(data: Uint8Array): boolean {
    return data.length >= 16 && isStaticAbcVersion(data.subarray(12, 16));
}

/** 从字节数据解析 .abc,自动选择动态/静态解析器 */
export function loadAbcData(data: Uint8Array): AbcDataFile {
    return isStaticAbcData(data) ? new StaticPandaFile(data) : new PandaFile(data);
}

/** 从磁盘读取 .abc 文件并解析(自动识别 ArkTS-Sta) */
export function loadAbcFile(filePath: string): AbcDataFile {
    return loadAbcData(new Uint8Array(fs.readFileSync(filePath)));
}

/** 按类名落盘(demangle 规则:Lpkg/Name; → outDir/pkg/Name.js,中间段成为目录) */
export function saveClassFile(outDir: string, pandaClass: PandaClass, content: string): void {
    try {
        const clsPath = pandaClass.name.content;
        if (clsPath.length === 0) return;
        const parts = clsPath.substring(1, clsPath.length - 1).split("/");
        let outFile: string;
        if (parts.length === 1) {
            outFile = path.join(outDir, parts[0] + ".js");
        } else {
            const name = parts[parts.length - 1];
            const dir = path.join(outDir, ...parts.slice(0, -1));
            fs.mkdirSync(dir, { recursive: true });
            outFile = path.join(dir, name + ".js");
        }
        fs.writeFileSync(outFile, content);
    } catch (e) {
        console.error(e);
    }
}
