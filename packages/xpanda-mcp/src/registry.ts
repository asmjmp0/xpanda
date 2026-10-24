import { Adler32, HapFile, PandaDecompiler, PandaFile, ResourceIndexFile } from "xpanda-core";

/**
 * MCP 会话注册表:fileId → 已加载的 abc/hap 会话
 * 大文件解析成本高,加载一次后供所有工具按 fileId 复用;
 * 超过上限时按最久未使用淘汰,避免常驻内存无限增长。
 * 两类会话共用同一个 LRU 池:
 *   - AbcSession:.abc(或从 hap 内解出的 .abc)→ PandaFile + PandaDecompiler
 *   - HapSession:.hap 应用包 → HapFile(条目读取 / module.json / resources.index)
 * @Author: jmp0
 */

const MAX_SESSIONS = 8;

export interface AbcSession {
    readonly kind: "abc";
    fileId: string;
    /** 绝对路径;从 hap 内解出的 abc 为 "<hap路径>!<条目名>" 形态 */
    path: string;
    pandaFile: PandaFile;
    decompiler: PandaDecompiler;
    loadedAt: number;
}

export interface HapSession {
    readonly kind: "hap";
    fileId: string;
    /** 绝对路径 */
    path: string;
    hap: HapFile;
    moduleJson: any | null;
    /** 包内全部 .abc 条目(名字 + 解压后大小) */
    abcEntries: Array<{ name: string; size: number }>;
    resourceItemCount: number;
    loadedAt: number;
}

export type Session = AbcSession | HapSession;

/** .hap 识别:扩展名或 ZIP 魔数 */
function looksLikeHap(path: string): boolean {
    const fs = require("fs");
    if (path.toLowerCase().endsWith(".hap")) return true;
    try {
        const head = fs.readFileSync(path).subarray(0, 4);
        return head[0] === 0x50 && head[1] === 0x4b && (head[2] === 0x03 || head[2] === 0x05 || head[2] === 0x07);
    } catch (e) {
        return false;
    }
}

export class Registry {
    private readonly sessions = new Map<string, Session>();

    /** 加载(或复用已加载的).abc / .hap 文件 */
    load(path: string): { session: Session; cached: boolean } {
        const absPath = require("path").resolve(path);
        // 同路径已加载则直接复用
        for (const session of this.sessions.values()) {
            if (session.path === absPath) {
                // 触达即置于 Map 末尾(插入序 = 最近使用)
                this.sessions.delete(session.fileId);
                this.sessions.set(session.fileId, session);
                return { session, cached: true };
            }
        }
        return looksLikeHap(absPath) ? this.loadHap(absPath) : this.loadAbcPath(absPath);
    }

    /** 从 hap 内解出指定 .abc 条目,注册为 abc 会话(供 abc_* 工具使用) */
    loadAbcEntry(hapSession: HapSession, entryName: string): { session: AbcSession; cached: boolean } {
        const entry = hapSession.abcEntries.find((e) => e.name === entryName);
        if (!entry) {
            throw new Error("hap 中不存在 .abc 条目: " + entryName + ",可用: " + hapSession.abcEntries.map((e) => e.name).join(", "));
        }
        // 合成路径 "<hap路径>!<条目名>" 既唯一又可读,重复加载时按它复用会话
        const syntheticPath = hapSession.path + "!" + entryName;
        for (const session of this.sessions.values()) {
            if (session.path === syntheticPath) {
                this.sessions.delete(session.fileId);
                this.sessions.set(session.fileId, session);
                return { session: session as AbcSession, cached: true };
            }
        }
        const data = hapSession.hap.readEntry(entryName);
        if (!data) throw new Error("hap 条目读取失败: " + entryName);
        const pandaFile = new PandaFile(data);
        const hapBase = require("path").basename(hapSession.path).replace(/\.hap$/i, "");
        const entryBase = entryName.replace(/\.abc$/i, "").replace(/\//g, "_");
        const fileId = "hap_" + Registry.makeFileId(hapBase + "_" + entryBase, pandaFile.header.checksum);
        const session: AbcSession = {
            kind: "abc",
            fileId,
            path: syntheticPath,
            pandaFile,
            decompiler: new PandaDecompiler(),
            loadedAt: Date.now(),
        };
        this.put(session);
        return { session, cached: false };
    }

    private loadAbcPath(absPath: string): { session: AbcSession; cached: boolean } {
        const pandaFile = PandaFile.from(absPath);
        const fileId = Registry.makeFileId(absPath, pandaFile.header.checksum);
        const session: AbcSession = {
            kind: "abc",
            fileId,
            path: absPath,
            pandaFile,
            decompiler: new PandaDecompiler(),
            loadedAt: Date.now(),
        };
        this.put(session);
        return { session, cached: false };
    }

    private loadHap(absPath: string): { session: HapSession; cached: boolean } {
        const fs = require("fs");
        const raw = fs.readFileSync(absPath);
        const hap = new HapFile(new Uint8Array(raw));
        const moduleJson = hap.getModuleJson();
        const abcEntries = hap.getAbcEntries().map((entry) => ({ name: entry.name, size: entry.uncompressedSize }));
        const indexData = hap.getResourcesIndexData();
        // 仅取条目数以保持 hap 会话轻量,完整解析推迟到 hap_resources
        const resourceItemCount = indexData ? new ResourceIndexFile(indexData).items.length : 0;
        const fileId = "hap-" + Registry.makeFileId(absPath, adler32(new Uint8Array(raw)));
        const session: HapSession = {
            kind: "hap",
            fileId,
            path: absPath,
            hap,
            moduleJson,
            abcEntries,
            resourceItemCount,
            loadedAt: Date.now(),
        };
        this.put(session);
        return { session, cached: false };
    }

    private put(session: Session): void {
        this.sessions.set(session.fileId, session);
        // 淘汰最旧会话
        while (this.sessions.size > MAX_SESSIONS) {
            const oldest = this.sessions.keys().next().value as string;
            this.sessions.delete(oldest);
        }
    }

    /** 取 abc 会话(hap 会话会被拒绝并指引),不存在时抛出带指引的错误 */
    get(fileId: string): AbcSession {
        const session = this.sessions.get(fileId);
        if (!session) {
            throw new Error("fileId 不存在: " + fileId + ",请先调用 abc_load 加载 .abc / .hap 文件");
        }
        if (session.kind !== "abc") {
            throw new Error("fileId " + fileId + " 是 hap 会话,请先调用 hap_read_abc 解出其中的 .abc");
        }
        return session;
    }

    /** 取 hap 会话;传入 abc 会话时报错并指引 */
    getHap(fileId: string): HapSession {
        const session = this.sessions.get(fileId);
        if (!session) {
            throw new Error("fileId 不存在: " + fileId + ",请先调用 abc_load 加载 .hap 文件");
        }
        if (session.kind !== "hap") {
            throw new Error("fileId " + fileId + " 是 abc 会话,资源工具需要 .hap 会话的 fileId");
        }
        return session;
    }

    close(fileId: string): boolean {
        return this.sessions.delete(fileId);
    }

    private static makeFileId(absPath: string, checksum: number): string {
        const path = require("path");
        const base = path.basename(absPath).replace(/\.abc$/i, "");
        return base + "-" + (checksum >>> 0).toString(16);
    }
}

/** Adler32(与 .abc 头校验同算法;hap 没有现成 checksum,用它区分文件版本) */
function adler32(data: Uint8Array): number {
    const adler = new Adler32();
    adler.update(data, 0, data.length);
    return adler.getValue();
}
