/**
 * xpanda-asm:加载 .abc(Panda 字节码)文件,修改/新增实体后重新写回。
 *
 * 实现策略(append-only patcher):
 *   - 原始文件字节保持不变;新增实体追加到文件末尾(4 字节对齐);
 *   - 只能"重定位 + 改指针"的实体(如类实体)整体复制到末尾,再改引用它的索引表;
 *   - 定长指针字段(如方法的 CODE tag、类索引表项)原位改写;
 *   - 写回前更新 file_size 与 Adler32 checksum。
 *
 * 与 xpanda-core 的只读解析器配合:实体定位复用 `PandaFile`,序列化由本库完成。
 *
 * 能力分层(按依赖方向继承,每个文件只负责一层):
 *   PandaPatchFileBase       缓冲区 / region 索引表 / 类与方法查找 / 字符串
 *   PandaPatchFileEntities   类与方法实体重建 / 重定位 / literal 修正
 *   PandaPatchFileCode       指令插入 / 扩帧
 *   PandaPatchFileModules    module record / import 表 / moduleRecordIdx
 *   PandaPatchFileHookSlots  GlobalPatch 槽 / 方法头前导 / setup 字节码
 *   PandaPatchFileHookImport hook class / module record / 字符串 / literal 搬运
 *   PandaPatchFileHookPatch  prepareMethodHead / patchMethodHead(s) 编排
 *   PandaPatchFile           公共外观(load / loadFile)
 *
 * @Author: jmp0
 */
import * as fs from "fs";
import { PandaPatchFileModuleLoad } from "./PandaPatchFileModuleLoad";

export class PandaPatchFile extends PandaPatchFileModuleLoad {
    private constructor(data: Uint8Array) {
        super(data);
    }

    /** 载入 .abc 字节(会校验 magic/checksum) */
    static load(data: Uint8Array): PandaPatchFile {
        return new PandaPatchFile(data);
    }

    /** 从磁盘载入 .abc 文件 */
    static loadFile(filePath: string): PandaPatchFile {
        return new PandaPatchFile(new Uint8Array(fs.readFileSync(filePath)));
    }
}

export type { CatchBlockInput, MethodCodeInput, TryBlockInput } from "../MethodCode";
export {
    PandaPatchError,
    generateHookName,
    PATCH_SLOT_BASE,
    patchSetterGlobalName,
} from "./PatchTypes";
export type {
    MethodCode,
    AddMethodOptions,
    AddMethodResult,
    AddStringIdResult,
    InsertInstructionsResult,
    PatchMethodHeadSourceOptions,
    PatchInitOptions,
    PatchInitResult,
    PatchModuleLoadOptions,
    PatchModuleLoadResult,
    PatchedModuleLoad,
    SkippedModuleLoad,
    PrepareMethodHeadOptions,
    InsertInstructionsOptions,
} from "./PatchTypes";
