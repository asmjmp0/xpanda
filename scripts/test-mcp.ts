import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/**
 * MCP Server 端到端测试:
 *   以子进程启动 src/mcp/server.ts,按 newline-delimited JSON-RPC 通信,
 *   依次调用全部 7 个工具并校验结果。
 *   同时隐式校验 stdout 纯净性:任何混入 stdout 的非 JSON 行都会导致解析失败。
 *
 * 运行:npm run test:mcp
 */

const PROTOCOL_VERSION = "2025-06-18";

let nextId = 1;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
let buffer = "";

const child = spawn(
    path.join(__dirname, "..", "node_modules", ".bin", "tsx"),
    [path.join(__dirname, "..", "src", "mcp", "server.ts")],
    { stdio: ["pipe", "pipe", "pipe"] },
);

child.stderr.on("data", (d) => process.stderr.write("[server] " + d));
child.on("exit", (code) => {
    if (failures.length === 0 && nextId > 2) return; // 正常结束由 main 收尾
    console.error("server exited unexpectedly, code=" + code);
});

child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    let idx: number;
    while ((idx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.substring(0, idx).trim();
        buffer = buffer.substring(idx + 1);
        if (line.length === 0) continue;
        let msg: any;
        try {
            msg = JSON.parse(line);
        } catch (e) {
            fail("stdout 混入了非 JSON 行(stdio 被污染): " + line.substring(0, 200));
            continue;
        }
        if (msg.id !== undefined && pending.has(msg.id)) {
            const p = pending.get(msg.id)!;
            pending.delete(msg.id);
            if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
            else p.resolve(msg.result);
        }
    }
});

function request(method: string, params: any, timeoutMs = 180_000): Promise<any> {
    const id = nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error("请求超时: " + method));
        }, timeoutMs);
        pending.set(id, {
            resolve: (v) => { clearTimeout(timer); resolve(v); },
            reject: (e) => { clearTimeout(timer); reject(e); },
        });
        child.stdin.write(payload);
    });
}

function notify(method: string, params: any): void {
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

/** 调用工具并解出首个 text 内容;assertError 为 true 时期望 isError */
async function call(name: string, args: any, assertError = false): Promise<any> {
    const result = await request("tools/call", { name, arguments: args });
    const isError = result.isError === true;
    if (isError !== assertError) {
        throw new Error(`工具 ${name} 的 isError=${isError}, 期望 ${assertError}\n` + JSON.stringify(result).substring(0, 800));
    }
    const text = result.content[0]?.text ?? "";
    if (!assertError && text.startsWith("{")) return JSON.parse(text);
    return { raw: text };
}

const failures: string[] = [];
function fail(message: string): void {
    failures.push(message);
    console.error("  [FAIL] " + message);
}
function check(cond: boolean, message: string): void {
    if (!cond) fail(message);
    else console.log("  ok: " + message);
}

async function main(): Promise<void> {
    const root = path.join(__dirname, "..");

    // 1. initialize 握手
    const init = await request("initialize", {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "xpanda-mcp-test", version: "0.0.1" },
    });
    check(init.serverInfo?.name === "xpanda", "initialize 握手,serverInfo.name=" + init.serverInfo?.name);
    notify("notifications/initialized", {});

    // 2. tools/list
    const tools = await request("tools/list", {});
    const names = tools.tools.map((t: any) => t.name).sort();
    const expected = ["abc_close", "abc_decompile_class", "abc_disassemble_method",
        "abc_export", "abc_get_class", "abc_list_classes", "abc_load", "abc_search_strings",
        "hap_read_abc", "hap_resources"].sort();
    check(JSON.stringify(names) === JSON.stringify(expected), "tools/list 共 " + names.length + " 个工具且名称齐全");

    // 3. abc_load md5.abc
    const md5Path = path.join(root, "test", "resources", "md5.abc");
    const loaded = await call("abc_load", { path: md5Path });
    check(loaded.fileId && loaded.classCount > 0, "abc_load fileId=" + loaded.fileId + " classCount=" + loaded.classCount);
    check(/^\d+\.\d+\.\d+\.\d+$/.test(loaded.bytecodeVersion), "abc_load bytecodeVersion=" + loaded.bytecodeVersion);

    // 4. 重复加载复用会话
    const reloaded = await call("abc_load", { path: md5Path });
    check(reloaded.cached === true && reloaded.fileId === loaded.fileId, "abc_load 重复加载复用会话");

    const fileId = loaded.fileId;

    // 5. abc_list_classes(filter 命中),并选出含方法的主类(样本可能含 0 方法的注解类)
    const list = await call("abc_list_classes", { fileId, filter: loaded.classesPreview[0].substring(0, 4) });
    check(list.filtered >= 1 && list.classes.length >= 1, "abc_list_classes filtered=" + list.filtered);
    const fullList = await call("abc_list_classes", { fileId, limit: 500 });
    const mainClass = fullList.classes.find((c: any) => c.methods > 0);
    check(mainClass != null, "abc_list_classes 找到含方法的主类: " + mainClass?.name);
    const className: string = mainClass.name;

    // 6. abc_get_class
    const info = await call("abc_get_class", { fileId, className });
    check(info.methods.length > 0 && info.fields !== undefined, "abc_get_class methods=" + info.methods.length);
    check(info.rawName.startsWith("L") && info.rawName.endsWith(";"), "abc_get_class rawName mangled 形态");

    // 7. abc_decompile_class:与快照逐字比较(去掉 MCP 添加的头注释行)
    const decompiled = await call("abc_decompile_class", { fileId, className });
    const source = decompiled.raw.split("\n").slice(1).join("\n");
    const expectedJs = fs.readFileSync(path.join(root, "test", "expected", "md5.js"), "utf-8");
    check(source === expectedJs, "abc_decompile_class 输出与 expected/md5.js 快照逐字一致");

    // 8. abc_search_strings
    const strings = await call("abc_search_strings", { fileId, pattern: "admin" });
    check(strings.poolSize > 0 && strings.matched >= 1,
        "abc_search_strings poolSize=" + strings.poolSize + " matched(admin)=" + strings.matched);
    const stringsRegex = await call("abc_search_strings", { fileId, pattern: "^md5$", regex: true });
    check(stringsRegex.matched >= 1, "abc_search_strings 正则匹配 ^md5$ 命中 " + stringsRegex.matched);

    // 9. abc_disassemble_method(类入口)
    const disasm = await call("abc_disassemble_method", { fileId, className });
    check(disasm.raw.includes("func_main_0") && disasm.raw.includes(":"), "abc_disassemble_method 输出包含入口与指令行");
    check(/\b\d+:\w+/.test(disasm.raw), "abc_disassemble_method 含 pc:opcode 指令行");

    // 10. abc_export 落盘
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "xpanda-mcp-test-"));
    const exported = await call("abc_export", { fileId, outDir });
    check(exported.written >= 1 && exported.failed === 0, "abc_export written=" + exported.written + " failed=" + exported.failed);
    const writtenFiles: string[] = [];
    (function walk(dir: string) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(p);
            else writtenFiles.push(p);
        }
    })(outDir);
    check(writtenFiles.length === exported.written && writtenFiles[0].endsWith(".js"), "abc_export 落盘文件数与返回一致");

    // 11. class.abc 全工具链 + 快照比较
    const classLoaded = await call("abc_load", { path: path.join(root, "test", "resources", "class.abc") });
    const classList = await call("abc_list_classes", { fileId: classLoaded.fileId, limit: 500 });
    const classMain = classList.classes.find((c: any) => c.methods > 0);
    const classDecompiled = await call("abc_decompile_class", { fileId: classLoaded.fileId, className: classMain.name });
    const classExpected = fs.readFileSync(path.join(root, "test", "expected", "class.js"), "utf-8");
    const classSource = classDecompiled.raw.split("\n").slice(1).join("\n");
    check(classSource === classExpected, "class.abc 反编译输出与快照一致");

    // 12. 错误路径:不存在的 fileId / 类名 / 方法名 → isError
    await call("abc_list_classes", { fileId: "no-such-id" }, true);
    await call("abc_get_class", { fileId, className: "Lno/such/Class;" }, true);
    await call("abc_disassemble_method", { fileId, className, methodName: "no_such_method" }, true);
    console.log("  ok: 错误路径均返回 isError=true");

    // 13. abc_close
    const closed = await call("abc_close", { fileId });
    check(closed.closed === true, "abc_close 释放会话");

    // 14. HAP 应用包:加载 → 解出 abc → 反编译(含 supercallforwardallargs 还原)
    const hapPath = path.join(root, "test", "resources", "zhihupp0.59.hap");
    const hapLoaded = await call("abc_load", { path: hapPath });
    check(hapLoaded.kind === "hap", "abc_load(.hap) kind=" + hapLoaded.kind);
    check(hapLoaded.bundleName === "com.github.zhuoyi233.zhplus"
        && hapLoaded.moduleName === "entry"
        && hapLoaded.virtualMachine === "ark13.0.1.0", "abc_load(.hap) module.json 摘要正确");
    check(Array.isArray(hapLoaded.abcEntries) && hapLoaded.abcEntries.some((e: any) => e.name === "ets/modules.abc"),
        "abc_load(.hap) 列出 ets/modules.abc 条目");
    check(hapLoaded.resourceItemCount === 64, "abc_load(.hap) 资源项数 = " + hapLoaded.resourceItemCount);

    const hapReloaded = await call("abc_load", { path: hapPath });
    check(hapReloaded.cached === true && hapReloaded.fileId === hapLoaded.fileId, "abc_load(.hap) 重复加载复用会话");

    const readAbc = await call("hap_read_abc", { fileId: hapLoaded.fileId });
    check(readAbc.abcFileId && readAbc.entry === "ets/modules.abc" && readAbc.classCount === 287,
        "hap_read_abc abcFileId=" + readAbc.abcFileId + " classCount=" + readAbc.classCount);
    const readAbcCached = await call("hap_read_abc", { fileId: hapLoaded.fileId });
    check(readAbcCached.cached === true && readAbcCached.abcFileId === readAbc.abcFileId, "hap_read_abc 复用 abc 会话");

    const ability = await call("abc_decompile_class", { fileId: readAbc.abcFileId, className: "L&entry/src/main/ets/entryability/EntryAbility&;" });
    check(ability.raw.includes("super(...arguments)"), "hap 内 EntryAbility 的 supercallforwardallargs 还原为 super(...arguments)");
    const abilityList = await call("abc_list_classes", { fileId: readAbc.abcFileId, filter: "WorkSchedulerProbe" });
    check(abilityList.filtered === 1, "abc_list_classes 在 hap 解出的 abc 上可用,filtered=" + abilityList.filtered);

    // 15. hap_resources:resources.index 查询
    const allResources = await call("hap_resources", { fileId: hapLoaded.fileId, limit: 500 });
    check(allResources.total === 64 && allResources.matched === 64 && allResources.format === "RestoolV2",
        "hap_resources total=" + allResources.total + " format=" + allResources.format);
    const byName = await call("hap_resources", { fileId: hapLoaded.fileId, name: "app_name" });
    check(byName.matched >= 1 && byName.items[0].id === "0x03000000" && byName.items[0].type === "string",
        "hap_resources 按名字命中 app_name → " + byName.items[0]?.id);
    const byId = await call("hap_resources", { fileId: hapLoaded.fileId, id: "0x03000011" });
    check(byId.matched === 2 && byId.items.some((i: any) => i.limitKey === "dark" && i.value === "#000000"),
        "hap_resources 按_id 命中 start_window_background base/dark 两条件");
    const byType = await call("hap_resources", { fileId: hapLoaded.fileId, type: "color", limitKey: "dark" });
    check(byType.matched >= 1 && byType.items.every((i: any) => i.type === "color" && i.limitKey === "dark"),
        "hap_resources 按类型+限定词过滤生效,matched=" + byType.matched);
    const paged = await call("hap_resources", { fileId: hapLoaded.fileId, offset: 0, limit: 5 });
    check(paged.items.length === 5 && paged.truncated === true, "hap_resources 分页 limit=5 truncated=true");

    // 16. hap 错误路径:abc fileId 用 hap 工具 / hap fileId 用 abc 工具 / 非法条目与 id
    await call("hap_read_abc", { fileId }, true);
    await call("hap_resources", { fileId }, true);
    await call("hap_read_abc", { fileId: hapLoaded.fileId, entry: "no/such.abc" }, true);
    await call("hap_resources", { fileId: hapLoaded.fileId, id: "not-an-id" }, true);
    console.log("  ok: hap 错误路径均返回 isError=true");

    // 17. abc_close 关闭 hap 会话
    const closedHap = await call("abc_close", { fileId: hapLoaded.fileId });
    check(closedHap.closed === true, "abc_close 释放 hap 会话");

    child.kill();
    if (failures.length > 0) {
        console.error("\nMCP TEST FAILED (" + failures.length + ")");
        process.exit(1);
    }
    console.log("\nALL MCP TESTS PASSED");
    process.exit(0);
}

main().catch((e) => {
    console.error("MCP test error: " + (e instanceof Error ? e.stack : String(e)));
    child.kill();
    process.exit(1);
});
