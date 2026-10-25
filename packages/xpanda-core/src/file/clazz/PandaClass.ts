import { PandaParseException } from "../../PandaParseException";
import type { IPandaFile } from "../IPandaFile";
import { PandaFileUtils } from "../PandaFileUtils";
import { Offset } from "../desc/Offset";
import { PandaString } from "../desc/PandaString";
import { PandaClassTag } from "../desc/enums";
import { PandaField } from "../field/PandaField";
import { PandaMethod } from "../method/PandaMethod";
import type { IndexHeader } from "../desc/IndexHeader";
import type { PandaIRCFG } from "../../disasm/PandaIRCFG";

/**
 * 模块路径(移植自 PandaClassModulePath):@bundle:/@module:/@package: 等前缀
 */
export class PandaClassModulePath extends PandaString {
    readonly type: string;
    readonly realPath: string;

    private static readonly PREFIXES: [string, string][] = [
        ["@bundle:", "BUNDLE"],
        ["@module:", "MODULE"],
        ["@package:", "PACKAGE"],
        ["@native:", "NATIVE_MODULE"],
        ["@ohos:", "NAPI_OHOS"],
        ["@hms:", "NAPI_HMS"],
        ["@app:", "NAPI_APP"],
        ["@normalized:", "NORMALIZED"],
    ];

    constructor(pandaFile: IPandaFile, offset: number) {
        super(pandaFile, offset);
        let found: [string, string] | null = null;
        for (const [prefix, type] of PandaClassModulePath.PREFIXES) {
            if (this.content.startsWith(prefix)) {
                found = [prefix, type];
                break;
            }
        }
        if (found) {
            this.type = found[1];
            this.realPath = this.content.substring(found[0].length);
        } else {
            this.type = "UNKNOWN";
            this.realPath = this.content;
        }
    }

    static createModulePath(pandaFile: IPandaFile, offset: number): PandaClassModulePath {
        const cached = pandaFile.resolveOffset(offset);
        if (cached instanceof PandaClassModulePath) return cached;
        const p = new PandaClassModulePath(pandaFile, offset);
        pandaFile.addOffset(offset, p);
        return p;
    }

    /** 覆写 PandaString 的带引号形式,模块路径需要纯内容(与 Java 一致) */
    toString(): string {
        return this.content;
    }
}

export enum ImportType {
    NAMESPACE,
    DEFAULT,
    SPECIFIER,
    SAME_SPECIFIER,
}

/** import 语句描述 */
export class PandaClassImportModule {
    readonly path: string;
    readonly localName: string;
    readonly importName: string | null;
    readonly type: ImportType;

    constructor(path: string, localName: string, importName: string | null) {
        this.path = path;
        this.localName = localName;
        this.importName = importName;
        if (importName === null) {
            this.type = ImportType.NAMESPACE;
        } else if (importName === "default") {
            this.type = ImportType.DEFAULT;
        } else if (importName === localName) {
            this.type = ImportType.SAME_SPECIFIER;
        } else {
            this.type = ImportType.SPECIFIER;
        }
    }

    toString(): string {
        switch (this.type) {
            case ImportType.NAMESPACE: return `import * as ${this.localName} from "${this.path}"`;
            case ImportType.DEFAULT: return `import ${this.localName} from "${this.path}"`;
            case ImportType.SAME_SPECIFIER: return `import {${this.importName}} from "${this.path}"`;
            case ImportType.SPECIFIER: return `import {${this.importName} as ${this.localName}} from "${this.path}"`;
        }
        return "";
    }
}

export enum ExportType {
    LOCAL,
    INDIRECT,
    ALL,
}

/** export 语句描述 */
export class PandaClassExportModule {
    readonly path: string | null;
    localName: string | null;
    readonly exportName: string | null;
    readonly type: ExportType;

    constructor(path: string | null, localName: string | null, exportName: string | null, type: ExportType) {
        this.path = path;
        this.localName = localName;
        if (localName !== null && localName === "*default*") {
            this.localName = "panda_jmp0_reserved_export_default";
        }
        this.exportName = exportName;
        this.type = type;
    }

    private isStarExport(): boolean { return this.path !== null && this.localName === null && this.exportName === null; }
    private isIndirectExport(): boolean { return this.path !== null && this.localName !== null && this.exportName !== null; }
    private isLocalExport(): boolean { return this.path === null && this.localName !== null && this.exportName !== null; }

    toString(): string {
        if (this.isLocalExport()) {
            if (this.exportName === "default") return "export default " + this.localName;
            if (this.exportName === this.localName) return `export {${this.exportName}}`;
            return `export {${this.localName} as ${this.exportName}}`;
        } else if (this.isIndirectExport()) {
            if (this.exportName === this.localName) return `export {${this.exportName}} from "${this.path}"`;
            return `export {${this.localName} as ${this.exportName}} from "${this.path}"`;
        } else if (this.isStarExport()) {
            return `export * from "${this.path}"`;
        }
        throw new PandaParseException("PandaClassExportModule unknown export type!");
    }
}

/**
 * 类的模块(import/export)元数据(移植自 PandaClassModuleData)
 * @Author: jmp0
 */
export class PandaClassModuleData extends Offset {
    private readonly pandaClass: PandaClass;
    private index = 4;
    requestedModules: PandaClassModulePath[] | null = null;
    readonly imports: PandaClassImportModule[];
    readonly exports: PandaClassExportModule[];

    private constructor(pandaFile: IPandaFile, offset: number, pandaClass: PandaClass) {
        super(pandaFile, offset);
        this.pandaClass = pandaClass;
        this.imports = this.parseImport(pandaFile);
        this.exports = this.parseExport(pandaFile);
    }

    static create(pandaFile: IPandaFile, offset: number, pandaClass: PandaClass): PandaClassModuleData {
        const cached = pandaFile.resolveOffset(offset);
        if (cached instanceof PandaClassModuleData) return cached;
        const m = new PandaClassModuleData(pandaFile, offset, pandaClass);
        pandaFile.addOffset(offset, m);
        return m;
    }

    private parseImport(pandaFile: IPandaFile): PandaClassImportModule[] {
        const data = pandaFile.data;
        const size = PandaFileUtils.bytes2UnsignedInteger(data, this.offsetValue + this.index); this.index += 4;
        const modules: PandaClassModulePath[] = [];
        for (let i = 0; i < size; i++) {
            modules.push(PandaClassModulePath.createModulePath(pandaFile, PandaFileUtils.bytes2UnsignedInteger(data, this.offsetValue + this.index)));
            this.index += 4;
        }
        this.requestedModules = modules;
        const importEntrySize = PandaFileUtils.bytes2UnsignedInteger(data, this.offsetValue + this.index); this.index += 4;
        const imports: PandaClassImportModule[] = [];
        for (let i = 0; i < importEntrySize; i++) {
            const localName = PandaString.create(pandaFile, PandaFileUtils.bytes2UnsignedInteger(data, this.offsetValue + this.index)); this.index += 4;
            const importName = PandaString.create(pandaFile, PandaFileUtils.bytes2UnsignedInteger(data, this.offsetValue + this.index)); this.index += 4;
            const off = PandaFileUtils.bytes2Uint16(data, this.offsetValue + this.index); this.index += 2;
            imports.push(new PandaClassImportModule(modules[off].toString(), localName.content, importName.content));
        }
        const namespaceImportNum = PandaFileUtils.bytes2UnsignedInteger(data, this.offsetValue + this.index); this.index += 4;
        const totalSize = importEntrySize + namespaceImportNum;
        for (let i = importEntrySize; i < totalSize; i++) {
            const localName = PandaString.create(pandaFile, PandaFileUtils.bytes2UnsignedInteger(data, this.offsetValue + this.index)); this.index += 4;
            const off = PandaFileUtils.bytes2Uint16(data, this.offsetValue + this.index); this.index += 2;
            imports.push(new PandaClassImportModule(modules[off].toString(), localName.content, null));
        }
        return imports;
    }

    private parseExport(pandaFile: IPandaFile): PandaClassExportModule[] {
        const data = pandaFile.data;
        const exports: PandaClassExportModule[] = [];
        const localExportNum = PandaFileUtils.bytes2UnsignedInteger(data, this.offsetValue + this.index); this.index += 4;
        for (let i = 0; i < localExportNum; i++) {
            const localName = PandaString.create(pandaFile, PandaFileUtils.bytes2UnsignedInteger(data, this.offsetValue + this.index)); this.index += 4;
            const exportName = PandaString.create(pandaFile, PandaFileUtils.bytes2UnsignedInteger(data, this.offsetValue + this.index)); this.index += 4;
            exports.push(new PandaClassExportModule(null, localName.content, exportName.content, ExportType.LOCAL));
        }
        const indirectExportNum = PandaFileUtils.bytes2UnsignedInteger(data, this.offsetValue + this.index); this.index += 4;
        for (let i = 0; i < indirectExportNum; i++) {
            // 间接导出(export {a as b} from "path")的序列化顺序是 export_name、local_name,
            // 与本地导出(export_name 在后)相反;local_name 是目标模块里的导出名(常见为 default)。
            const exportName = PandaString.create(pandaFile, PandaFileUtils.bytes2UnsignedInteger(data, this.offsetValue + this.index)); this.index += 4;
            const localName = PandaString.create(pandaFile, PandaFileUtils.bytes2UnsignedInteger(data, this.offsetValue + this.index)); this.index += 4;
            const off = PandaFileUtils.bytes2Uint16(data, this.offsetValue + this.index); this.index += 2;
            exports.push(new PandaClassExportModule(this.requestedModules![off].toString(), localName.content, exportName.content, ExportType.INDIRECT));
        }
        const starExportNum = PandaFileUtils.bytes2UnsignedInteger(data, this.offsetValue + this.index); this.index += 4;
        for (let i = 0; i < starExportNum; i++) {
            const off = PandaFileUtils.bytes2Uint16(data, this.offsetValue + this.index); this.index += 2;
            exports.push(new PandaClassExportModule(this.requestedModules![off].toString(), null, null, ExportType.ALL));
        }
        return exports;
    }

    getPandaClassImportModuleByPath(path: string): PandaClassImportModule | null {
        for (const anImport of this.imports) {
            if (anImport.path === path) return anImport;
        }
        return null;
    }

    getParent(): PandaClass {
        return this.pandaClass;
    }
}

/**
 * Panda 类(移植自 Java jmp0.abc.file.clazz.PandaClass)
 * @Author: jmp0
 */
export class PandaClass extends Offset {
    readonly classExternal: boolean;
    readonly name: PandaString;
    readonly superClassOff: Offset;
    readonly accessFlags: number;
    readonly numFields: number;
    readonly numMethods: number;
    readonly indexHeader: IndexHeader;
    index = 0;
    numIfaces = 0;
    ifacesOffsets: Offset = Offset.nullOffset();
    sourceLang = 0;
    sourceFile: PandaString | null = null;
    pandaFields: PandaField[] | null = null;
    pandaMethods = new Map<string, PandaMethod>();
    pandaClassModuleData: PandaClassModuleData | null = null;
    private resolved = false;

    private constructor(pandaFile: IPandaFile, offset: number, indexHeader: IndexHeader) {
        super(pandaFile, offset);
        this.indexHeader = indexHeader;
        this.classExternal = this.isExternal();
        if (!this.isValid() || this.classExternal) {
            this.name = PandaString.create(pandaFile, this.offsetValue);
            this.index = this.name.getSize();
            this.superClassOff = Offset.nullOffset();
            this.accessFlags = 0;
            this.numFields = 0;
            this.numMethods = 0;
            return;
        }
        const leb128 = pandaFile.leb128;
        this.name = PandaString.create(pandaFile, this.offsetValue);
        this.index = this.name.getSize();
        this.superClassOff = new Offset(pandaFile, PandaFileUtils.bytes2UnsignedInteger(pandaFile.data, this.offsetValue + this.index));
        this.index += 4;
        leb128.decode2UnsignedInteger(this.offsetValue + this.index);
        this.accessFlags = leb128.unsignedInteger;
        this.index += leb128.size;
        leb128.decode2UnsignedInteger(this.offsetValue + this.index);
        this.numFields = leb128.unsignedInteger;
        this.index += leb128.size;
        leb128.decode2UnsignedInteger(this.offsetValue + this.index);
        this.numMethods = leb128.unsignedInteger;
        this.index += leb128.size;
    }

    static create(pandaFile: IPandaFile, offset: number, indexHeader: IndexHeader): PandaClass {
        const cached = pandaFile.resolveOffset(offset);
        if (cached instanceof PandaClass) return cached;
        const clazz = new PandaClass(pandaFile, offset, indexHeader);
        pandaFile.addOffset(offset, clazz);
        return clazz;
    }

    private resolveClasses(): void {
        const pandaFile = this.pandaFile!;
        const leb128 = pandaFile.leb128;
        let tag = pandaFile.data[this.offsetValue + this.index];
        while (tag !== PandaClassTag.NOTHING) {
            this.index++;
            if (tag === PandaClassTag.INTERFACES) {
                leb128.decode2UnsignedInteger(this.offsetValue + this.index);
                this.numIfaces = leb128.unsignedInteger;
                this.index += leb128.size;
                this.ifacesOffsets = new Offset(pandaFile, this.index);
                this.index += this.numIfaces * 2;
            } else if (tag === PandaClassTag.SOURCE_LANG) {
                this.sourceLang = pandaFile.data[this.offsetValue + this.index];
                this.index += 1;
            } else if (tag === PandaClassTag.RUNTIME_ANNOTATION) {
                throw new PandaParseException("PandaClassTag.RUNTIME_ANNOTATION");
            } else if (tag === PandaClassTag.ANNOTATION) {
                throw new PandaParseException("PandaClassTag.ANNOTATION");
            } else if (tag === PandaClassTag.RUNTIME_TYPE_ANNOTATION) {
                throw new PandaParseException("PandaClassTag.RUNTIME_TYPE_ANNOTATION");
            } else if (tag === PandaClassTag.TYPE_ANNOTATION) {
                throw new PandaParseException("PandaClassTag.TYPE_ANNOTATION");
            } else if (tag === PandaClassTag.SOURCE_FILE) {
                // Bytecode 24.0.0.0 stores the source file name as a 32-bit string offset
                // (the module path, e.g. "entry|entry|1.0.0|.../ResourceTable.js").
                this.sourceFile = PandaString.create(pandaFile,
                    PandaFileUtils.bytes2UnsignedInteger(pandaFile.data, this.offsetValue + this.index));
                this.index += 4;
            }
            tag = pandaFile.data[this.offsetValue + this.index];
        }
        this.index++;
    }

    private resolveFields(): void {
        if (this.numFields === 0) return;
        let nums = this.numFields;
        this.pandaFields = [];
        while (nums !== 0) {
            const field = PandaField.create(this.pandaFile!, this.offsetValue + this.index);
            field.resolve();
            this.pandaFields.push(field);
            this.index += field.getSize();
            nums--;
        }
        for (const field of this.pandaFields) {
            if (field.getName() === "moduleRecordIdx" && field.pandaFieldValue) {
                this.pandaClassModuleData = PandaClassModuleData.create(this.pandaFile!, field.pandaFieldValue.getOffset(), this);
                break;
            }
        }
    }

    private resolveMethods(): void {
        if (this.numMethods === 0) return;
        let nums = this.numMethods;
        while (nums !== 0) {
            const method = PandaMethod.create(this.pandaFile!, this.offsetValue + this.index);
            method.resolve();
            this.pandaMethods.set(method.name.content, method);
            this.index += method.getSize();
            nums--;
        }
    }

    resolve(): void {
        if (!this.isValid()) return;
        if (this.resolved) return;
        this.resolveClasses();
        this.resolveFields();
        this.resolveMethods();
        this.resolved = true;
    }

    getParent(): IndexHeader {
        return this.indexHeader;
    }

    getClassName(): string {
        return this.name.content;
    }

    disAssembleAllMethods(): PandaIRCFG[] {
        const result: PandaIRCFG[] = [];
        for (const method of this.pandaMethods.values()) {
            const cfg = method.disAssemble();
            if (cfg) result.push(cfg);
        }
        return result;
    }
}
