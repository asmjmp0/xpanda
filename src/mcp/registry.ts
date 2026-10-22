import { PandaFile } from "../file/PandaFile";
import { PandaDecompiler } from "../PandaDecompiler";

/**
 * MCP 会话注册表:fileId → 已加载的 PandaFile + PandaDecompiler
 * 大文件解析成本高,加载一次后供所有工具按 fileId 复用;
 * 超过上限时按最久未使用淘汰,避免常驻内存无限增长。
 * @Author: jmp0
 */

const MAX_SESSIONS = 8;

export interface AbcSession {
    fileId: string;
    /** 绝对路径 */
    path: string;
    pandaFile: PandaFile;
    decompiler: PandaDecompiler;
    loadedAt: number;
}

export class Registry {
    private readonly sessions = new Map<string, AbcSession>();

    /** 加载(或复用已加载的).abc 文件 */
    load(path: string): { session: AbcSession; cached: boolean } {
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

        const pandaFile = PandaFile.from(absPath);
        const decompiler = new PandaDecompiler();
        const fileId = Registry.makeFileId(absPath, pandaFile.header.checksum);

        const session: AbcSession = {
            fileId,
            path: absPath,
            pandaFile,
            decompiler,
            loadedAt: Date.now(),
        };
        this.sessions.set(fileId, session);

        // 淘汰最旧会话
        while (this.sessions.size > MAX_SESSIONS) {
            const oldest = this.sessions.keys().next().value as string;
            this.sessions.delete(oldest);
        }
        return { session, cached: false };
    }

    /** 取会话,不存在时抛出带指引的错误 */
    get(fileId: string): AbcSession {
        const session = this.sessions.get(fileId);
        if (!session) {
            throw new Error("fileId 不存在: " + fileId + ",请先调用 abc_load 加载 .abc 文件");
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
