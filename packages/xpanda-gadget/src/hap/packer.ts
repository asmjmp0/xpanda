/**
 * HAP-level gadget injection: patch the bytecode entries via {@link injectAbcBytes},
 * embed the gadget .so under `libs/<abi>/` and rebuild the ZIP container.
 *
 * The rebuild re-emits every original entry from its decompressed content (deflate,
 * content-identical) plus the injected .so. Note: a repacked HAP is no longer signed;
 * it must be re-signed (DevEco / hap-signer) before it installs on a device — the same
 * requirement as any repack-based injection workflow.
 * @Author: jmp0
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { HapFile, ZipEntry } from "xpanda-core";
import { GADGET_SO_NAME, injectAbcBytes } from "../inject";
import type { InjectAbcOptions, InjectAbcResult } from "../inject";
import { writeZip, ZipEntryInput } from "./zip-writer";

/** Default directory holding prebuilt gadget libraries, relative to the package root. */
export const PREBUILT_SO_DIR = "assets";
/** Legacy build output directory (still accepted as a fallback when assets/ is missing). */
const LEGACY_BUILD_DIR = "native/build";

export interface InjectHapOptions extends InjectAbcOptions {
    /**
     * Gadget .so bytes to embed. Default: read `soPath`, which defaults to
     * `<packageRoot>/assets/<abi>/libxpanda_gadget.so`.
     */
    soData?: Uint8Array;
    /** Explicit .so path. Default resolved from {@link PREBUILT_SO_DIR}. */
    soPath?: string;
    /** ABI directory under libs/ for the embedded .so. Default arm64-v8a. */
    abi?: string;
    /** Explicit abc entry name to patch (e.g. `ets/modules.abc`). Default: see resolveAbcEntries. */
    abcEntry?: string;
    /** Patch every .abc entry in the HAP (each gets its own entry class). */
    patchAllAbc?: boolean;
    /** Skip embedding the .so (patch bytecode only). */
    noSo?: boolean;
    /**
     * Deflate entries in the rebuilt zip. Default false: DevEco/hvigor packages HAPs
     * fully STORED, and the installer's .so extraction was observed to skip
     * compressed libs entries, so store is the compatible default.
     */
    compress?: boolean;
}

export interface PatchedAbcReport {
    entryName: string;
    entryClass: string;
    moduleName: string;
    initName: string;
    importIndex: number;
    candidates: string[];
}

export interface InjectHapResult {
    data: Uint8Array;
    /** abc entries that received the bootstrap. */
    patched: PatchedAbcReport[];
    /** Zip entry name the gadget .so was embedded under; null when not embedded. */
    soEntryName: string | null;
    /** Why the .so was not embedded, when applicable. */
    soSkippedReason?: string;
    /** Original HAP size. */
    inputSize: number;
    /** Repacked HAP size. */
    outputSize: number;
}

/**
 * Default .so path: assets/<abi>/<soName> under this package. Falls back to the
 * legacy native/build/<abi> output when the committed asset is missing.
 */
export function defaultSoPath(packageRoot: string, abi = "arm64-v8a", soName = GADGET_SO_NAME): string {
    const prebuilt = path.join(packageRoot, PREBUILT_SO_DIR, abi, soName);
    if (fs.existsSync(prebuilt)) return prebuilt;
    return path.join(packageRoot, LEGACY_BUILD_DIR, abi, soName);
}

/**
 * Candidate entry classes derived from module.json (mainElement / srcEntry),
 * used before falling back to `findEntryClassCandidates` inside the abc.
 */
export function entryClassCandidatesFromModuleJson(moduleJson: any): string[] {
    const module = moduleJson?.module ?? moduleJson;
    if (!module) return [];
    const moduleName: string | undefined = typeof module.name === "string" ? module.name : undefined;
    const mainElement: string | undefined = typeof module.mainElement === "string" ? module.mainElement : undefined;
    const abilities: any[] = Array.isArray(module.abilities) ? module.abilities : [];
    const srcEntry: string | undefined
        = abilities.find((a) => a?.name === mainElement)?.srcEntry
        ?? (typeof module.srcEntry === "string" ? module.srcEntry : undefined);
    const out: string[] = [];
    if (moduleName && srcEntry) {
        // normalize "./ets/entryability/EntryAbility.ets" -> "entryability/EntryAbility"
        const noExt = srcEntry.replace(/\.(ts|ets|js)$/i, "").replace(/^\.\//, "").replace(/^ets\//, "");
        out.push(`L&${moduleName}/src/main/ets/${noExt}&;`);
    }
    return out;
}

/**
 * Pick the abc entries to patch. Explicit abcEntry wins, then patchAllAbc, then:
 * a single abc entry is patched directly; with several entries the module.json
 * srcEntry hints at the module directory (`<module>/src/main/ets/...`) and the
 * entry whose name contains it is chosen; otherwise the call fails listing options.
 */
export function resolveAbcEntries(hap: HapFile, options: InjectHapOptions): ZipEntry[] {
    const abcEntries = hap.getAbcEntries();
    if (abcEntries.length === 0) throw new Error("HAP contains no .abc entries");
    if (options.abcEntry) {
        const picked = abcEntries.find((entry) => entry.name === options.abcEntry);
        if (!picked) {
            throw new Error(`abc entry '${options.abcEntry}' not found; available: ${abcEntries.map((e) => e.name).join(", ")}`);
        }
        return [picked];
    }
    if (options.patchAllAbc || abcEntries.length === 1) return [...abcEntries];
    const hints = entryClassCandidatesFromModuleJson(hap.getModuleJson());
    if (hints.length > 0) {
        // e.g. hint dir "entry/src/main/ets/entryability/EntryAbility" -> match "entry/"
        const dir = hints[0].slice(2, -2).split("/ets/")[0];
        const matched = abcEntries.filter((entry) => entry.name.includes(dir));
        if (matched.length === 1) return matched;
    }
    throw new Error(
        `HAP has ${abcEntries.length} abc entries (${abcEntries.map((e) => e.name).join(", ")}); `
        + "pass abcEntry or patchAllAbc",
    );
}

/** Patch a HAP byte stream: bytecode init inject + .so embedding + ZIP rebuild. */
export function injectHapBytes(data: Uint8Array, options: InjectHapOptions & { packageRoot?: string } = {}): InjectHapResult {
    const hap = new HapFile(data);
    const abcEntries = resolveAbcEntries(hap, options);

    const patchedReports: PatchedAbcReport[] = [];
    const patchedByName = new Map<string, InjectAbcResult>();
    for (const entry of abcEntries) {
        const injected = injectAbcBytes(entry.read(), options);
        patchedByName.set(entry.name, injected);
        patchedReports.push({
            entryName: entry.name,
            entryClass: injected.entryClass,
            moduleName: injected.moduleName,
            initName: injected.initName,
            importIndex: injected.importIndex,
            candidates: injected.candidates,
        });
    }

    let soEntryName: string | null = null;
    let soSkippedReason: string | undefined;
    const soName = options.soName ?? GADGET_SO_NAME;
    if (options.noSo !== true) {
        const abi = options.abi ?? "arm64-v8a";
        soEntryName = `libs/${abi}/${soName}`;
        const soData = options.soData ?? readDefaultSo(options.packageRoot, options.soPath, abi, soName);
        if (soData) {
            options.soData = soData;
        } else {
            soSkippedReason = `gadget .so not found (build it with: yarn workspace xpanda-gadget build:so; or pass soData/soPath)`;
            soEntryName = null;
        }
    }

    const outEntries: ZipEntryInput[] = [];
    const compress = options.compress === true;
    for (const entry of hap.zip.entries) {
        const injected = patchedByName.get(entry.name);
        const content = injected ? injected.data : entry.read();
        outEntries.push({ name: entry.name, data: content, store: entry.isDirectory() || !compress });
    }
    if (soEntryName && options.soData) {
        outEntries.push({ name: soEntryName, data: options.soData, store: !compress });
    }

    const out = writeZip(outEntries);
    return {
        data: out,
        patched: patchedReports,
        soEntryName,
        soSkippedReason,
        inputSize: data.length,
        outputSize: out.length,
    };
}

function readDefaultSo(packageRoot: string | undefined, soPath: string | undefined, abi: string, soName: string): Uint8Array | null {
    if (soPath) {
        return fs.existsSync(soPath) ? new Uint8Array(fs.readFileSync(soPath)) : null;
    }
    // __dirname is <repo>/packages/xpanda-gadget/src/hap; the package root is two levels up.
    const root = packageRoot ?? path.resolve(__dirname, "..", "..");
    const candidate = defaultSoPath(root, abi, soName);
    return fs.existsSync(candidate) ? new Uint8Array(fs.readFileSync(candidate)) : null;
}
