import { ZipEntry, ZipFile } from "./ZipFile";

/**
 * 鸿蒙 HAP 应用包(HarmonyOS Ability Package)适配层。
 * HAP 是 ZIP 容器,与反编译相关的关键条目:
 *   - ets/modules.abc        ArkTS 字节码(可能存在多个 .abc 条目)
 *   - resources.index        资源索引(可用 ResourceIndexFile 解析)
 *   - module.json            模块信息(bundleName、版本、virtualMachine 等)
 * @Author: jmp0
 */
export class HapFile {
    readonly zip: ZipFile;

    constructor(data: Uint8Array) {
        this.zip = new ZipFile(data);
    }

    /** 全部 .abc 字节码条目(保持归档内顺序) */
    getAbcEntries(): ZipEntry[] {
        return this.zip.entries.filter((e) => !e.isDirectory() && e.name.endsWith(".abc"));
    }

    hasEntry(name: string): boolean {
        return this.zip.hasEntry(name);
    }

    /** 读取任意条目内容 */
    readEntry(name: string): Uint8Array | null {
        return this.zip.readEntryByName(name);
    }

    /** 解析 module.json,条目缺失或非法 JSON 时返回 null */
    getModuleJson(): any | null {
        const bytes = this.readEntry("module.json");
        if (!bytes) return null;
        try {
            return JSON.parse(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("utf8"));
        } catch (e) {
            return null;
        }
    }

    /** resources.index 原始字节(ResourceIndexFile 的输入),不存在时返回 null */
    getResourcesIndexData(): Uint8Array | null {
        return this.readEntry("resources.index");
    }

    /** resources/ 目录下的全部资源条目(media、rawfile、profile 等,不含目录条目,保持归档内顺序) */
    getResourceEntries(): ZipEntry[] {
        return this.zip.entries.filter((e) => !e.isDirectory() && e.name.startsWith("resources/"));
    }
}
