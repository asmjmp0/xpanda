/**
 * xpanda-web 反编译结果持久化缓存:已反编译类的输出写入 IndexedDB,
 * 刷新页面 / 重新载入同一个文件后直接显示,无需再次反编译。
 * 缓存键由文件内容哈希 + .abc 条目名 + 模式 + 类名组成,文件内容变化即自然失效;
 * 数据库名带 xpanda-core 版本号,反编译器升级后旧结果整体作废。
 * IndexedDB 不可用(隐私模式 / 配额不足 / 浏览器不支持)时静默降级为纯内存缓存。
 * @Author: jmp0
 */
import { CORE_VERSION } from "./version";

/** IndexedDB 数据库名:xapanda-core 版本变化即切换到新库,旧库尝试清理 */
const DB_NAME = "xpanda-web-cache-" + CORE_VERSION;
const DB_PREFIX = "xpanda-web-cache-";
const DB_VERSION = 1;
const STORE = "classes";
/** 攒批写入的间隔(毫秒),避免全量反编译时每类一个事务 */
const FLUSH_DELAY_MS = 200;
/** 攒够多少条立即写入 */
const FLUSH_BATCH = 64;

/** 一条已缓存的反编译结果 */
export interface CachedClass {
    /** `${sourceKey}\u0000${mode}\u0000${className}` */
    key: string;
    /** 来源标识:文件内容哈希 + .abc 条目名 */
    sourceKey: string;
    code: string;
    /** 首次反编译耗时(毫秒) */
    elapsedMs: number;
    savedAt: number;
}

function requestDone<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
    });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
        tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
    });
}

/**
 * 文件内容哈希:安全上下文下用 SHA-256,否则回退到双路 FNV-1a。
 * 只用于缓存键,不参与任何校验;哈希失败时退化为长度 + 抽样字节。
 */
export async function hashBytes(data: Uint8Array): Promise<string> {
    const subtle = globalThis.crypto?.subtle;
    if (subtle !== undefined) {
        try {
            const digest = await subtle.digest("SHA-256", data as unknown as BufferSource);
            return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
        } catch {
            // 非安全上下文 / 实现限制:走下面的回退哈希
        }
    }
    let h1 = 0x811c9dc5;
    let h2 = 0xc9dc5118;
    for (let i = 0; i < data.length; i++) {
        h1 = Math.imul(h1 ^ data[i], 0x01000193);
        h2 = Math.imul(h2 ^ data[data.length - 1 - i], 0x01000193);
    }
    return (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16) + "-" + data.length.toString(16);
}

/**
 * IndexedDB 缓存(按来源批量读取、攒批写入)。
 * 所有方法都不会抛异常:任何失败都会把缓存标记为禁用,调用方无感知。
 */
export class DecompileCache {
    private dbPromise: Promise<IDBDatabase | null> | null = null;
    private disabled = false;
    private failed = false;
    private readonly pendingPuts: CachedClass[] = [];
    private readonly pendingDeletes: string[] = [];
    private timer: number | null = null;

    /** 记录一条结果(内存中先入队,稍后批量落盘) */
    save(record: CachedClass): void {
        if (this.disabled) return;
        this.pendingPuts.push(record);
        this.schedule();
    }

    /** 删除一条结果(「重反编译」时让旧结果失效) */
    remove(key: string): void {
        if (this.disabled) return;
        this.pendingDeletes.push(key);
        this.schedule();
    }

    /** 读取某个来源已缓存的全部类(含两种模式) */
    async loadSource(sourceKey: string): Promise<CachedClass[]> {
        const db = await this.open();
        if (db === null) return [];
        try {
            const tx = db.transaction(STORE, "readonly");
            const done = transactionDone(tx);
            const records = await requestDone(tx.objectStore(STORE).index("sourceKey").getAll(sourceKey));
            await done;
            return records as CachedClass[];
        } catch (e) {
            this.disable(e);
            return [];
        }
    }

    /** 清空全部缓存(用户主动清理时调用) */
    async clear(): Promise<void> {
        this.pendingPuts.length = 0;
        this.pendingDeletes.length = 0;
        this.cancelTimer();
        const db = await this.open();
        if (db === null) return;
        try {
            const tx = db.transaction(STORE, "readwrite");
            const done = transactionDone(tx);
            tx.objectStore(STORE).clear();
            await done;
        } catch (e) {
            this.disable(e);
        }
    }

    /** 立即写入攒批中的记录(页面卸载前调用,避免丢失最后几条) */
    async flush(): Promise<void> {
        this.cancelTimer();
        if (this.disabled || (this.pendingPuts.length === 0 && this.pendingDeletes.length === 0)) return;
        const puts = this.pendingPuts.splice(0, this.pendingPuts.length);
        const deletes = this.pendingDeletes.splice(0, this.pendingDeletes.length);
        const db = await this.open();
        if (db === null) return;
        try {
            const tx = db.transaction(STORE, "readwrite");
            const done = transactionDone(tx);
            const store = tx.objectStore(STORE);
            for (const record of puts) store.put(record);
            for (const key of deletes) store.delete(key);
            await done;
        } catch (e) {
            this.disable(e);
        }
    }

    private schedule(): void {
        if (this.timer !== null) return;
        this.timer = window.setTimeout(() => {
            this.timer = null;
            void this.flush();
        }, FLUSH_DELAY_MS);
        if (this.pendingPuts.length >= FLUSH_BATCH) {
            this.cancelTimer();
            void this.flush();
        }
    }

    private cancelTimer(): void {
        if (this.timer === null) return;
        window.clearTimeout(this.timer);
        this.timer = null;
    }

    /** 打开数据库;不可用时返回 null(本次会话只用内存缓存) */
    private open(): Promise<IDBDatabase | null> {
        if (this.dbPromise !== null) return this.dbPromise;
        this.dbPromise = new Promise<IDBDatabase | null>((resolve) => {
            if (typeof indexedDB === "undefined") {
                this.disabled = true;
                resolve(null);
                return;
            }
            let request: IDBOpenDBRequest;
            try {
                request = indexedDB.open(DB_NAME, DB_VERSION);
            } catch (e) {
                this.disable(e);
                resolve(null);
                return;
            }
            request.onupgradeneeded = () => {
                const db = request.result;
                if (db.objectStoreNames.contains(STORE)) return;
                const store = db.createObjectStore(STORE, { keyPath: "key" });
                store.createIndex("sourceKey", "sourceKey");
            };
            request.onsuccess = () => {
                const db = request.result;
                // 其它核版本的旧库不再使用,尽力删除(不支持的浏览器忽略)
                void pruneOtherDatabases();
                resolve(db);
            };
            request.onerror = () => {
                this.disable(request.error);
                resolve(null);
            };
            request.onblocked = () => {
                // 另一个标签页仍占用旧版本连接:本次先用内存缓存
                resolve(null);
            };
        });
        return this.dbPromise;
    }

    /** 记录一次失败并禁用持久化,避免反复重试 / 反复告警 */
    private disable(error: unknown): void {
        this.disabled = true;
        this.pendingPuts.length = 0;
        this.pendingDeletes.length = 0;
        this.cancelTimer();
        if (!this.failed) {
            this.failed = true;
            console.warn("xpanda-web: persistent decompile cache disabled (" +
                (error instanceof Error ? error.message : String(error)) + ")");
        }
    }
}

/** 删除本应用其它核心版本遗留的数据库(尽力而为,不影响主流程) */
async function pruneOtherDatabases(): Promise<void> {
    const databases = indexedDB.databases;
    if (typeof databases !== "function") return;
    try {
        const list = await databases.call(indexedDB);
        for (const info of list) {
            if (info.name === undefined || info.name === DB_NAME) continue;
            if (!info.name.startsWith(DB_PREFIX)) continue;
            indexedDB.deleteDatabase(info.name);
        }
    } catch {
        // 清理失败无影响:旧库只是占空间,不与当前缓存键冲突
    }
}
