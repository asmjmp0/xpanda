/**
 * xpanda 公共 API —— 浏览器入口(无 Node 依赖)。
 * 与 Node 入口(./index)的差异:
 *   - 不含 parallel(worker_threads / os / process.env,按类并行 simplify 仅 Node 可用)。
 * core 不做磁盘 IO;读写文件由 xpanda-cli / xpanda-mcp 各自实现。
 * 经 package.json exports 的 "browser" 条件解析:浏览器打包器(Vite / webpack / esbuild)
 * 以 browser 目标导入 "xpanda-core" 时自动命中本文件,Node 环境仍走 ./index。
 * @Author: jmp0
 */
export { PandaFile, ENTRY_FUNCTION_MAIN } from "./file/PandaFile";
export { PandaClass } from "./file/clazz/PandaClass";
export { PandaMethod } from "./file/method/PandaMethod";
export { PandaDecompiler } from "./PandaDecompiler";
export { PandaLexical } from "./disasm/PandaLexical";
export { PandaDisAssembler } from "./disasm/PandaDisAssembler";
export { PandaIRCFG, PandaIRBasicBlock } from "./disasm/ir";
export { OPCODES, OPCODE_BY_CODE, OPCODE_FLAG, BYTECODE_VERSION } from "./disasm/opcodes";
export { NodeFactory, NodeUtils } from "./ast";
export { SimplifyExport } from "./simplify/SimplifyExport";
export { ResourceIndexFile } from "./res/ResourceIndexFile";
export { ResourceItem } from "./res/ResourceItem";
export { ResourceUtils } from "./res/ResourceUtils";
export { HapFile } from "./hap/HapFile";
export { ZipFile, ZipEntry } from "./hap/ZipFile";
export { Adler32 } from "./codec/Adler32";
export { PandaRawType, rawTypeString } from "./file/desc/enums";
export {
    ResourceKeyType,
    ResourceResType,
} from "./res/ResourceEnums";
export { PandaParseException, PandaDecompileException } from "./PandaParseException";
