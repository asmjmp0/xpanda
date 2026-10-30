/**
 * CLI 专用落盘:按类名写输出文件。
 * demangle 规则:Lpkg/Name; → outDir/pkg/Name.js(中间段成为目录)。
 * core 只保留纯反编译能力,磁盘 IO 由本包负责。
 * @Author: jmp0
 */
import * as fs from "fs";
import * as path from "path";
import { PandaClass } from "xpanda-core";

/** 按类名落盘(原 PandaDecompiler.saveFile);ext 指定输出扩展名(decompile 为 .js,dump-asm 为 .asm) */
export function saveClassFile(outDir: string, pandaClass: PandaClass, content: string, ext = ".js"): void {
    try {
        const clsPath = pandaClass.name.content;
        if (clsPath.length === 0) return;
        const parts = clsPath.substring(1, clsPath.length - 1).split("/");
        let outFile: string;
        if (parts.length === 1) {
            outFile = path.join(outDir, parts[0] + ext);
        } else {
            const name = parts[parts.length - 1];
            const dir = path.join(outDir, ...parts.slice(0, -1));
            fs.mkdirSync(dir, { recursive: true });
            outFile = path.join(dir, name + ext);
        }
        fs.writeFileSync(outFile, content);
    } catch (e) {
        console.error(e);
    }
}
