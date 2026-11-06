/**
 * Patch-time enumeration of user module records.
 *
 * Every module class in the target abc (a class owning a `moduleRecordIdx` field)
 * becomes one record entry together with the object names it exports. The list is
 * baked into the bootstrap module as `getAllUserModule()`; at startup the injected
 * init binds it to `ArkTS.metadata.getAllUserModule` so both injected ArkTS scripts
 * (`globalThis.ArkTS.metadata.getAllUserModule()`) and the gadget shell
 * (`ArkTS.hostGlobal.ArkTS.metadata.getAllUserModule()`) can enumerate the app's
 * own modules without native reflection.
 * @Author: jmp0
 */
import { PandaFile } from "xpanda-core";

/** One user module record: the record name and the object names it exports. */
export interface UserModuleInfo {
    /** Record name as stored in the abc (e.g. `&entry/src/main/ets/pages/Index&`). */
    record: string;
    /** Exported object names in module metadata order (`export * from` has no name). */
    exports: string[];
}

/** Strip the `L...;` wrapper from a module class name (`L&pkg/X&;` -> `&pkg/X&`). */
function recordNameOf(className: string): string {
    return className.startsWith("L") && className.endsWith(";") ? className.slice(1, -1) : className;
}

/**
 * Enumerate every module record in the abc, in file order.
 * Duplicate record names are merged, keeping the first-seen order and the
 * first occurrence of each export name.
 */
export function collectUserModules(pandaFile: PandaFile): UserModuleInfo[] {
    const byRecord = new Map<string, UserModuleInfo>();
    for (const clazz of pandaFile.getAllClasses()) {
        if (clazz.classExternal) continue;
        const moduleData = clazz.pandaClassModuleData;
        if (!moduleData) continue;
        const record = recordNameOf(clazz.getClassName());
        let info = byRecord.get(record);
        if (!info) {
            info = { record, exports: [] };
            byRecord.set(record, info);
        }
        for (const exp of moduleData.exports) {
            if (exp.exportName !== null && !info.exports.includes(exp.exportName)) {
                info.exports.push(exp.exportName);
            }
        }
    }
    return Array.from(byRecord.values());
}

/** Render one `{record:...,exports:[...]}` line of the baked array literal. */
function userModuleEntrySource(info: UserModuleInfo): string {
    const record = JSON.stringify(info.record);
    const exports = info.exports.map((name) => JSON.stringify(name)).join(",");
    return `        {record:${record},exports:[${exports}]},`;
}

/**
 * Build the `getAllUserModule` function declaration baked into the bootstrap
 * module. The returned names are compile-time data: they describe the abc the
 * function was generated from, not the runtime's module cache.
 */
export function buildGetAllUserModuleSource(modules: UserModuleInfo[]): string {
    const entries = modules.map(userModuleEntrySource).join("\n");
    const body = entries ? `[\n${entries}\n    ]` : "[]";
    return `function getAllUserModule() {\n    return ${body};\n}`;
}
