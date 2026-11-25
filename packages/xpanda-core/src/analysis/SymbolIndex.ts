import type { PandaClass } from "../file/clazz/PandaClass";
import type { PandaField } from "../file/field/PandaField";
import type { PandaMethod } from "../file/method/PandaMethod";
import { PandaFile } from "../file/PandaFile";
import { rawTypeString } from "../file/desc/enums";
import { StaticPandaFile } from "../static/StaticPandaFile";

/**
 * Metadata symbol index for dynamic Panda and ArkTS-Sta abc files.
 *
 * The index is built from the class table only (no disassembly), so it is
 * cheap enough to build per session and can answer class/method/field name
 * searches without decompiling anything.
 *
 * @Author: jmp0
 */

export type SymbolKind = "class" | "method" | "field";
export type SymbolQueryKind = SymbolKind | "all";

export interface SymbolQuery {
    query: string;
    kind?: SymbolQueryKind;
    /** Treat the query as a regular expression (case-insensitive unless caseSensitive). */
    regex?: boolean;
    caseSensitive?: boolean;
    /** Substring filter on the owner class name (mangled or demangled). */
    classFilter?: string;
    /** Include external classes/methods/fields (default true). */
    includeExternal?: boolean;
    offset?: number;
    limit?: number;
}

export interface SymbolMatch {
    kind: SymbolKind;
    /** Raw bytecode name (e.g. `Lpkg/Name;`). */
    rawName: string;
    /** Readable name (L...; wrapper removed for classes). */
    name: string;
    /** Owner class raw name for methods/fields. */
    ownerClass?: string;
    ownerClassName?: string;
    /** Field type, when available. */
    type?: string;
    methodCount?: number;
    fieldCount?: number;
    external?: boolean;
    hasCode?: boolean;
}

export interface SymbolSearchResult {
    total: number;
    offset: number;
    limit: number;
    matches: SymbolMatch[];
}

interface ClassSymbol {
    kind: "class";
    rawName: string;
    name: string;
    clazz: PandaClass;
    external: boolean;
}

interface MethodSymbol {
    kind: "method";
    rawName: string;
    name: string;
    ownerClass: string;
    ownerClassName: string;
    method: PandaMethod;
    external: boolean;
    hasCode: boolean;
}

interface FieldSymbol {
    kind: "field";
    rawName: string;
    name: string;
    ownerClass: string;
    ownerClassName: string;
    field: PandaField;
    external: boolean;
    type?: string;
}

type AnySymbol = ClassSymbol | MethodSymbol | FieldSymbol;

/** Readable class name: strip the single `L ... ;` wrapper, leave other forms intact. */
export function readableClassName(rawName: string): string {
    if (rawName.length >= 2 && rawName.startsWith("L") && rawName.endsWith(";")) {
        return rawName.substring(1, rawName.length - 1);
    }
    return rawName;
}

function hasCode(clazz: PandaClass): boolean {
    for (const method of clazz.pandaMethods.values()) {
        if (method.methodCode) return true;
    }
    return false;
}

export class SymbolIndex {
    private readonly classes: ClassSymbol[] = [];
    private readonly methods: MethodSymbol[] = [];
    private readonly fields: FieldSymbol[] = [];
    private readonly symbols: AnySymbol[] = [];
    private readonly methodByKey = new Map<string, MethodSymbol>();

    private constructor(file: PandaFile | StaticPandaFile) {
        const allClasses = file.getAllClasses();
        for (const clazz of allClasses) {
            const rawName = clazz.getClassName();
            if (!rawName) continue;
            const classSymbol: ClassSymbol = {
                kind: "class",
                rawName,
                name: readableClassName(rawName),
                clazz,
                external: clazz.classExternal,
            };
            this.classes.push(classSymbol);
            this.symbols.push(classSymbol);

            for (const method of clazz.pandaMethods.values()) {
                const name = method.getName().content;
                const methodSymbol: MethodSymbol = {
                    kind: "method",
                    rawName: name,
                    name,
                    ownerClass: rawName,
                    ownerClassName: classSymbol.name,
                    method,
                    external: method.methodExternal,
                    hasCode: method.methodCode != null,
                };
                this.methods.push(methodSymbol);
                this.symbols.push(methodSymbol);
                this.methodByKey.set(rawName + "\u0000" + name, methodSymbol);
            }

            for (const field of clazz.pandaFields ?? []) {
                const name = field.getName();
                let type: string | undefined;
                try {
                    type = field.pandaType ? rawTypeString(field.pandaType.rawType, true) : undefined;
                } catch {
                    type = undefined;
                }
                const fieldSymbol: FieldSymbol = {
                    kind: "field",
                    rawName: name,
                    name,
                    ownerClass: rawName,
                    ownerClassName: classSymbol.name,
                    field,
                    external: field.fieldExternal,
                    type,
                };
                this.fields.push(fieldSymbol);
                this.symbols.push(fieldSymbol);
            }
        }

        // Foreign class records are only referenced by the file; expose them as
        // external classes so a name search can still find the owner of an
        // external method/field.
        for (const clazz of file.foreignPandaClasses) {
            const rawName = clazz.getClassName();
            if (!rawName || this.classes.some((c) => c.rawName === rawName)) continue;
            const classSymbol: ClassSymbol = {
                kind: "class",
                rawName,
                name: readableClassName(rawName),
                clazz,
                external: true,
            };
            this.classes.push(classSymbol);
            this.symbols.push(classSymbol);
        }
    }

    static build(file: PandaFile | StaticPandaFile): SymbolIndex {
        return new SymbolIndex(file);
    }

    get classCount(): number {
        return this.classes.length;
    }

    get methodCount(): number {
        return this.methods.length;
    }

    get fieldCount(): number {
        return this.fields.length;
    }

    /** Find a method by mangled/demangled owner and method name. */
    findMethod(ownerClass: string | undefined, methodName: string): MethodSymbol | null {
        const owner = ownerClass ? normalizeLookupName(ownerClass) : null;
        if (owner) {
            return this.methodByKey.get(owner + "\u0000" + methodName)
                ?? this.methods.find((method) =>
                    normalizeLookupName(method.ownerClass) === owner && method.name === methodName) ?? null;
        }
        return this.methods.find((method) => method.name === methodName) ?? null;
    }

    findClass(className: string): ClassSymbol | null {
        const target = normalizeLookupName(className);
        return this.classes.find((clazz) =>
            normalizeLookupName(clazz.rawName) === target || clazz.rawName === className) ?? null;
    }

    search(query: SymbolQuery): SymbolSearchResult {
        const kind = query.kind ?? "all";
        const includeExternal = query.includeExternal ?? true;
        const matcher = buildMatcher(query);
        const classFilter = query.classFilter?.trim();
        const classNeedle = classFilter ? classFilter.toLowerCase() : null;

        const matched: SymbolMatch[] = [];
        for (const symbol of this.symbols) {
            if (kind !== "all" && symbol.kind !== kind) continue;
            if (!includeExternal && symbol.external) continue;
            if (classNeedle && !matchesClassFilter(symbol, classNeedle)) continue;
            if (!matcher.matches(...lookupNames(symbol))) continue;
            matched.push(toMatch(symbol));
        }

        const offset = Math.max(0, query.offset ?? 0);
        const limit = Math.max(1, query.limit ?? 50);
        return {
            total: matched.length,
            offset,
            limit,
            matches: matched.slice(offset, offset + limit),
        };
    }
}

function toMatch(symbol: AnySymbol): SymbolMatch {
    switch (symbol.kind) {
        case "class":
            return {
                kind: "class",
                rawName: symbol.rawName,
                name: symbol.name,
                methodCount: symbol.clazz.pandaMethods.size,
                fieldCount: symbol.clazz.pandaFields?.length ?? 0,
                external: symbol.external,
                hasCode: hasCode(symbol.clazz),
            };
        case "method":
            return {
                kind: "method",
                rawName: symbol.rawName,
                name: symbol.name,
                ownerClass: symbol.ownerClass,
                ownerClassName: symbol.ownerClassName,
                external: symbol.external,
                hasCode: symbol.hasCode,
            };
        case "field":
            return {
                kind: "field",
                rawName: symbol.rawName,
                name: symbol.name,
                ownerClass: symbol.ownerClass,
                ownerClassName: symbol.ownerClassName,
                external: symbol.external,
                type: symbol.type,
            };
    }
}

function normalizeLookupName(name: string): string {
    return readableClassName(name.trim());
}

function lookupNames(symbol: AnySymbol): string[] {
    switch (symbol.kind) {
        case "class":
            return [symbol.rawName, symbol.name];
        case "method":
            return [symbol.name, symbol.ownerClass + "." + symbol.name, symbol.ownerClassName + "." + symbol.name];
        case "field":
            return [symbol.name, symbol.ownerClass + "." + symbol.name, symbol.ownerClassName + "." + symbol.name];
    }
}

function matchesClassFilter(symbol: AnySymbol, needle: string): boolean {
    if (symbol.kind === "class") {
        return symbol.rawName.toLowerCase().includes(needle) || symbol.name.toLowerCase().includes(needle);
    }
    return symbol.ownerClass.toLowerCase().includes(needle) || symbol.ownerClassName.toLowerCase().includes(needle);
}

function buildMatcher(query: SymbolQuery): { matches: (...values: string[]) => boolean } {
    const pattern = query.query ?? "";
    const caseSensitive = query.caseSensitive === true;
    if (query.regex) {
        const regex = new RegExp(pattern, caseSensitive ? "" : "i");
        return { matches: (...values) => values.some((value) => regex.test(value)) };
    }
    if (caseSensitive) {
        return { matches: (...values) => values.some((value) => value.includes(pattern)) };
    }
    const needle = pattern.toLowerCase();
    return { matches: (...values) => values.some((value) => value.toLowerCase().includes(needle)) };
}
