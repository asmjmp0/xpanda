/**
 * Shared types, constants and errors for the append-only .abc patcher.
 * @Author: jmp0
 */
import type { MethodCodeInput, TryBlockInput } from "../MethodCode";

export const HEADER_CHECKSUM_OFF = 8;
export const HEADER_VERSION_OFF = 12;
export const HEADER_FILE_SIZE_OFF = 16;
export const HEADER_NUM_CLASSES_OFF = 28;
export const HEADER_CLASS_IDX_OFF = 32;
export const INDEX_HEADER_SIZE = 40;
export const INDEX_HEADER_CLASS_IDX_SIZE_OFF = 8;
export const INDEX_HEADER_CLASS_IDX_OFF_OFF = 12;
export const INDEX_HEADER_METHOD_IDX_SIZE_OFF = 16;
export const INDEX_HEADER_METHOD_IDX_OFF_OFF = 20;

export const METHOD_TAG_CODE = 0x01;
export const METHOD_TAG_DEBUG_INFO = 0x05;

/** 字段实体 tag(与 Panda FieldTag 一致) */
export const FIELD_TAG_NOTHING = 0x00;
export const FIELD_TAG_INT_VALUE = 0x01;
export const FIELD_TAG_VALUE = 0x02;

/** 方法实体 tag 的载荷长度(所有 tag 载荷均为定长) */
export const METHOD_TAG_PAYLOAD_SIZE: Record<number, number> = {
    0x01: 4, // CODE
    0x02: 1, // SOURCE_LANG
    0x03: 4, // RUNTIME_ANNOTATION
    0x04: 4, // RUNTIME_PARAM_ANNOTATION
    0x05: 4, // DEBUG_INFO
    0x06: 4, // ANNOTATION
    0x07: 4, // PARAM_ANNOTATION
    0x08: 4, // TYPE_ANNOTATION
    0x09: 4, // RUNTIME_TYPE_ANNOTATION
};

export class PandaPatchError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "PandaPatchError";
    }
}

/**
 * 生成随机 hook 全局名(默认 "__xpanda_hook_<12 位小写字母/数字>")。
 * 用于 AOP 注入时避免固定名字冲突/被识别。
 */
export function generateHookName(prefix = "__xpanda_hook"): string {
    const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
    let suffix = "";
    for (let i = 0; i < 12; i++) {
        suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return `${prefix}_${suffix}`;
}

/**
 * First GlobalPatch index used by dynamic hooks.
 * The assembly interpreter passes this immediate through `Int16ToTaggedInt`, so values
 * above 0x7fff become huge unsigned lengths and `stpatchvar` OOMs the process.
 * Slots below the base are left for the system hotfix compiler.
 */
export const PATCH_SLOT_BASE = 0x1000;
export const PATCH_SLOT_MAX = 0x7fff;

/** `globalThis[patchSetterGlobalName(hook)](fn)` replaces the function stored in that hook's slot. */
export function patchSetterGlobalName(hookGlobalName: string): string {
    return `xpanda_set_${hookGlobalName}`;
}

/** Default init function name used by patchInit when initName is omitted. */
export const DEFAULT_INIT_FUNCTION = "init";

export interface MethodCode {
    numVregs: number;
    numArgs: number;
    instructions: Uint8Array;
    tries: TryBlockInput[];
}

export interface AddMethodOptions {
    /** 新方法名 */
    name: string;
    /** 克隆哪个已有方法的方法实体(复用其 proto/access flags/tags);缺省取类的第一个带代码方法 */
    template?: string;
    /** 可选:同时写入新代码;缺省则沿用 template 的代码 */
    code?: MethodCodeInput;
}

export interface AddMethodResult {
    className: string;
    methodName: string;
    /** 新方法实体在文件中的绝对偏移 */
    methodOffset: number;
    /** 类索引表中的方法 id(可用于 call.* 指令) */
    methodId: number;
    /** 新代码项偏移(写入 code 时) */
    codeOffset?: number;
}

export interface AddStringIdResult {
    /** 类索引表中的实体 id(可用于 lda.str 等指令) */
    id: number;
    /** String 实体在文件中的绝对偏移 */
    offset: number;
}

export interface InsertInstructionsResult {
    className: string;
    methodName: string;
    /** 插入位置(原指令流的 PC) */
    atPC: number;
    /** 插入的字节数 */
    insertedLength: number;
    /** 新代码项偏移 */
    codeOffset: number;
    /** 插入后的完整指令流 */
    instructions: Uint8Array;
    /** patchMethodHead 使用的 hook 全局名(未显式指定时为随机生成) */
    hookGlobalName?: string;
    /** dynamic 模式:方法头 `wide.ldpatchvar` 读取的 GlobalPatch 下标 */
    patchSlot?: number;
    /** dynamic 模式:运行时替换 hook 的全局属性名,`globalThis[setterGlobalName](fn)` */
    setterGlobalName?: string;
    /** dynamic 模式:hook class 上执行 `wide.stpatchvar` 的方法名 */
    setterMethodName?: string;
}

export interface PatchMethodHeadSourceOptions {
    /** es2abc 可执行文件路径;缺省读 XPANDA_ES2ABC,再回退到仓库 assets/bin/<os>/es2abc[.exe] / PATH */
    es2abc?: string;
    /**
     * 目标 bytecode 版本对应的 es2abc `--target-api-version`。
     * 缺省按目标 abc 的版本自动映射(12.0.2.0→12、12.0.6.0→13、13.0.1.0→18、24.0.0.0→24),
     * 未知版本会探测 es2abc 的版本映射。
     */
    targetApiVersion?: number;
    /** 保留临时目录(调试用) */
    keepTemp?: boolean;
    /**
     * hook 源码里的模块请求重写:源码 specifier → 目标 abc 中可直接解析的请求串。
     * 例如 `{ ohop: "@normalized:N&&&entry/src/main/ets/common/ohop&" }`。
     * 缺省按目标 abc 的记录名做唯一后缀匹配(见 resolveModuleRequests)。
     */
    moduleRequests?: Record<string, string>;
    /**
     * 未显式给出映射时,是否按目标 abc 里的记录名后缀自动解析 hook 的 import
     * (例如 `ohop` → `@normalized:N&&&<recordName>`)。默认 true。
     */
    resolveModuleRequests?: boolean;
    /** 追加到 import 宿主(缺省目标类,或 setupClassName)module 表里的 local 名;缺省用 hook 名 */
    localName?: string;
    /**
     * 动态 hook:方法头用 `wide.ldpatchvar` 从 GlobalPatch 取函数,而不是写死
     * `ldexternalmodulevar`。hook 模块末尾的 `xpanda_reserved_setup` 用 `wide.stpatchvar`
     * 装上初始 hook,并把 setter 挂到 `globalThis[xpanda_set_<hook>]`。
     * 之后 `globalThis[xpanda_set_<hook>](fn)` 换实现,传入 falsy 则关闭。
     */
    dynamic?: boolean;
    /**
     * dynamic 模式下使用的 GlobalPatch 下标。缺省从 {@link PATCH_SLOT_BASE} 起分配,
     * 同一个 hook 名复用同一个槽。一次注入多个 hook 时不能指定(每个 hook 各需一个槽)。
     */
    patchSlot?: number;
    /**
     * dynamic 模式下负责触发 hook 模块求值(setup)的类,通常是 hap 入口(如
     * `L&entry/src/main/ets/entryability/EntryAbility&;`)。指定后只给这个类的 module
     * record 追加 hook import,hook class 也搬进它所在的 index region;目标方法所在类
     * 不再追加 import,可以分散在其它 region。
     * 缺省仍在每个目标方法所属类上追加 import(保证 setup 先于目标方法执行)。
     * 指定 init 时必须给出这个入口类(静态 hook 也允许,仅用于挂 init)。
     */
    setupClassName?: string;
    /**
     * 初始化函数名。函数必须和 hook 函数一样写在 `hookSource` 里
     * (`function <init>(...) { ... }`);指定后它会被导出,并由 `setupClassName` 的
     * `func_main_0` 调用:
     *   - dynamic:入口 module 先 import hook 模块(setup 写槽),再在 func_main_0 调用 init;
     *   - static :入口 module 直接 import hook 模块并在 func_main_0 调用 init。
     * 不指定则不注入 init。指定时必须同时给出 `setupClassName`。
     */
    init?: string;
    /**
     * Additional top-level functions declared in the hook/init source that must be
     * exported from the moved module. Used by module-load instrumentation: other
     * module records import these functions and call them from `func_main_0`.
     */
    exportFunctions?: string[];
}

export interface PatchInitOptions {
    /**
     * 入口类:负责 import 初始化模块,并在自己的 `func_main_0` 里调用 init 函数。必填。
     */
    setupClassName: string;
    /** init 函数名,必须出现在 initSource 里;缺省 "init" */
    initName?: string;
    /** es2abc 可执行文件路径;缺省读 XPANDA_ES2ABC,再回退到仓库 assets/bin/<os>/es2abc[.exe] / PATH */
    es2abc?: string;
    /** 目标 bytecode 版本对应的 es2abc `--target-api-version`;缺省按目标 abc 版本自动映射 */
    targetApiVersion?: number;
    /** 保留临时目录(调试用) */
    keepTemp?: boolean;
    /** 初始化模块里 import 请求的重写(同 PatchMethodHeadSourceOptions.moduleRequests) */
    moduleRequests?: Record<string, string>;
    /** 未显式映射时是否按目标 abc 的记录名后缀自动解析 import;默认 true */
    resolveModuleRequests?: boolean;
    /**
     * Additional top-level functions declared in the init source that must be
     * exported from the moved module (see
     * {@link PatchMethodHeadSourceOptions.exportFunctions}).
     */
    exportFunctions?: string[];
}

export interface PatchInitResult {
    /** 入口类 */
    className: string;
    /** 固定为 func_main_0 */
    methodName: string;
    /** 生成的初始化 module 名(记录名为 `&xpanda/hook/<moduleName>&`) */
    moduleName: string;
    /** 被导出的 init 函数名 */
    initName: string;
    /** 初始化函数的类名(`L<record>;`) */
    moduleClassName: string;
    /** 初始化模块的记录名(可传给 `patchModuleLoadCallbacks`) */
    moduleRecordName: string;
    /** 初始化函数在入口 module import 表里的下标 */
    importIndex: number;
    /** 插入位置(固定 0) */
    atPC: number;
    /** 插入的字节数 */
    insertedLength: number;
    /** 新代码项偏移 */
    codeOffset: number;
}

/** Options for {@link PandaPatchFileModuleLoad.patchModuleLoadCallbacks}. */
export interface PatchModuleLoadOptions {
    /**
     * Module record name of the listener module (returned as
     * `PatchInitResult.moduleRecordName`). Instrumented modules import
     * `listenerName` from this record.
     */
    listenerRecordName: string;
    /** Exported function to call before each module's final `returnundefined`. */
    listenerName: string;
    /**
     * Restrict instrumentation to these module records (class names `L...;` or
     * bare record names are accepted). Default: every module record in the abc.
     */
    records?: string[];
    /** Local import name written into each module record; defaults to `listenerName`. */
    localName?: string;
    /** Throw on the first module that cannot be instrumented instead of skipping it. */
    strict?: boolean;
}

/** One module whose `func_main_0` received the module-load callback. */
export interface PatchedModuleLoad {
    className: string;
    /** Record name without the `L...;` wrapper (e.g. `&entry/src/main/ets/Index&`). */
    record: string;
    /** Listener import index in this module record (for `ldexternalmodulevar`). */
    importIndex: number;
    /** String id used by the injected `lda.str`. */
    stringId: number;
    /** Original PC of the final `returnundefined`. */
    atPC: number;
    /** Number of inserted bytes. */
    insertedLength: number;
}

/** A module record that was intentionally left uninstrumented. */
export interface SkippedModuleLoad {
    className: string;
    record?: string;
    reason: string;
}

export interface PatchModuleLoadResult {
    patched: PatchedModuleLoad[];
    skipped: SkippedModuleLoad[];
}

export interface PrepareMethodHeadOptions {
    /** 指定 hook 全局名;缺省随机生成 */
    hookGlobalName?: string;
}

export interface MethodTags {
    codeValueOffset: number | null;
    debugInfoTagOffset: number | null;
    end: number;
}

export interface ClassOverride {
    /** 当前类实体在文件中的偏移 */
    offset: number;
    /** 当前类实体字节 */
    bytes: Uint8Array;
    numMethods: number;
    /** 方法名 → 方法实体在类实体内的相对偏移 */
    methodRelativeOffsets: Map<string, number>;
}

export interface PreparedTarget {
    className: string;
    methodName: string;
    /** async 方法:async 上下文寄存器(用于早退时 asyncfunctionresolve) */
    asyncContextRegister?: number;
    /** async 方法:前导插入 PC(在 asyncfunctionenter; sta vCtx 之后) */
    insertionPC?: number;
}

/** 已搬进目标 abc 的 hook 函数:目标 module import 下标 + hook 名 */
export interface HookLoader {
    importIndex: number;
    name: string;
}

/** 一个 hook 模块的 xpanda_reserved_setup 要写入的槽和 setter。 */
export interface DynamicSetupEntry {
    slot: number;
    /** hook 函数在本模块 export 表里的下标,对应 ldlocalmodulevar */
    hookExportIndex: number;
    setterExportIndex: number;
    /** hook class 所在 region 里 `xpanda_set_<hook>` 的 string id */
    globalNameId: number;
}

export interface DynamicSetup {
    methodName: string;
    entries: DynamicSetupEntry[];
}

/** hook class 搬运时,源实体偏移 → 目标实体偏移/id 的缓存 */
export interface ClassImportCaches {
    stringEntities: Map<number, number>;
    stringIds: Map<number, number>;
    literalEntities: Map<number, number>;
    literalIds: Map<number, number>;
    /** hook 源 module record 偏移 → 目标 module record 偏移 */
    moduleRecords: Map<number, number>;
}

export interface InsertInstructionsOptions {
    /**
     * atPC 恰好等于 try 起点时,插入的代码是否归入 try:
     *   - "outside"(默认):try 起点后移,注入代码不在 try 内
     *   - "inside":try 起点不变、length 增加(注入代码在 try 内)
     */
    tryInclusion?: "outside" | "inside";
}
