/**
 * Minimal ZIP archive writer used to rebuild injected HAP packages.
 * Only what HAP repacking needs: per-entry store/deflate(local header) + central directory + EOCD.
 * 32-bit ZIP only (no ZIP64, no encryption, no data descriptor), matching what
 * xpanda-core's read-only ZipFile accepts on the read side.
 * @Author: jmp0
 */
import { deflateRawSync } from "node:zlib";
import { crc32 } from "./crc32";

const LOC_SIGNATURE = 0x04034b50;
const CEN_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;
const LOC_MIN_LENGTH = 30;
const CEN_MIN_LENGTH = 46;
const EOCD_MIN_LENGTH = 22;
/** General purpose bit flag: UTF-8 entry names. */
const FLAG_UTF8 = 0x0800;
/** version needed to extract: 2.0 (deflate). */
const VERSION_NEEDED = 20;
/** version made by: upper byte 3 (unix) | 2.0. */
const VERSION_MADE_BY = (3 << 8) | 20;
/** Regular file unix mode 0100644 / directory mode 040755 shifted into the high 16 bits of external attributes. */
const FILE_EXTERNAL_ATTRS = (0o100644 << 16) >>> 0;
const DIR_EXTERNAL_ATTRS = (0o040755 << 16) >>> 0;

export interface ZipEntryInput {
    name: string;
    data: Uint8Array;
    /** Store without compression; defaults to false (deflate). */
    store?: boolean;
}

/** Fixed DOS timestamp (1980-01-01 00:00:00); HAP entries do not rely on timestamps. */
const DOS_TIME = 0;
const DOS_DATE = (1 << 5) | 1;

/** Serialize entries into a complete ZIP byte stream. */
export function writeZip(entries: readonly ZipEntryInput[]): Uint8Array {
    const chunks: Uint8Array[] = [];
    const central: Uint8Array[] = [];
    let offset = 0;
    let count = 0;

    for (const entry of entries) {
        const nameBytes = new TextEncoder().encode(entry.name);
        const crc = crc32(entry.data);
        const store = entry.store === true;
        const payload = store ? entry.data : deflateRawSync(entry.data, { level: 6 });
        const method = store ? 0 : 8;

        const local = new Uint8Array(LOC_MIN_LENGTH + nameBytes.length);
        const localView = new DataView(local.buffer);
        localView.setUint32(0, LOC_SIGNATURE, true);
        localView.setUint16(4, VERSION_NEEDED, true);
        localView.setUint16(6, FLAG_UTF8, true);
        localView.setUint16(8, method, true);
        localView.setUint16(10, DOS_TIME, true);
        localView.setUint16(12, DOS_DATE, true);
        localView.setUint32(14, crc, true);
        localView.setUint32(18, payload.length, true);
        localView.setUint32(22, entry.data.length, true);
        localView.setUint16(26, nameBytes.length, true);
        localView.setUint16(28, 0, true);
        local.set(nameBytes, LOC_MIN_LENGTH);

        const centralEntry = new Uint8Array(CEN_MIN_LENGTH + nameBytes.length);
        const centralView = new DataView(centralEntry.buffer);
        centralView.setUint32(0, CEN_SIGNATURE, true);
        centralView.setUint16(4, VERSION_MADE_BY, true);
        centralView.setUint16(6, VERSION_NEEDED, true);
        centralView.setUint16(8, FLAG_UTF8, true);
        centralView.setUint16(10, method, true);
        centralView.setUint16(12, DOS_TIME, true);
        centralView.setUint16(14, DOS_DATE, true);
        centralView.setUint32(16, crc, true);
        centralView.setUint32(20, payload.length, true);
        centralView.setUint32(24, entry.data.length, true);
        centralView.setUint16(28, nameBytes.length, true);
        centralView.setUint16(30, 0, true); // extra field length
        centralView.setUint16(32, 0, true); // file comment length
        centralView.setUint16(34, 0, true); // disk number start
        centralView.setUint16(36, 0, true); // internal file attributes
        centralView.setUint32(38, entry.name.endsWith("/") ? DIR_EXTERNAL_ATTRS : FILE_EXTERNAL_ATTRS, true);
        centralView.setUint32(42, offset, true);
        centralEntry.set(nameBytes, CEN_MIN_LENGTH);

        chunks.push(local, payload);
        central.push(centralEntry);
        offset += local.length + payload.length;
        count++;
    }

    const centralSize = central.reduce((sum, bytes) => sum + bytes.length, 0);
    const eocd = new Uint8Array(EOCD_MIN_LENGTH);
    const eocdView = new DataView(eocd.buffer);
    eocdView.setUint32(0, EOCD_SIGNATURE, true);
    eocdView.setUint16(8, count, true);
    eocdView.setUint16(10, count, true);
    eocdView.setUint32(12, centralSize, true);
    eocdView.setUint32(16, offset, true);

    const total = offset + centralSize + EOCD_MIN_LENGTH;
    const out = new Uint8Array(total);
    let cursor = 0;
    for (const bytes of [...chunks, ...central, eocd]) {
        out.set(bytes, cursor);
        cursor += bytes.length;
    }
    return out;
}
