/**
 * xpanda 公共 API —— 唯一入口(Node 与浏览器共用)。
 * core 只保留纯反编译能力:无 Node 内建模块、无磁盘 IO、无 worker。
 * Node 专属能力不在本包:并行 simplify 在 xpanda-cli(src/parallel),磁盘 IO 在 cli / mcp 各自的 src/io.ts。
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
