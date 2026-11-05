/**
 * Source-level class names for `defineclasswithbuffer` record names.
 *
 * ArkTS records the class in the instruction's constructor method name. Modern
 * toolchains use the source class name directly (`WebChromeClientImpl`) or a
 * mangled record name whose last `#` segment is the source name
 * (`#~@0=#GamePage`). Older toolchains may leave a generated/empty record name;
 * those have no usable source name and the caller falls back to a reserved
 * placeholder.
 *
 * @Author: jmp0
 */

/** Keep in sync with `isTempName` in `simplify/AstUtils.ts`. */
function isGeneratedTempName(name: string): boolean {
    return name === "acc" || /^v\d+$/.test(name)
        || /^local_\d+_\d+(_\d+)?$/.test(name)
        || /^sendable_\d+_\d+(_\d+)?$/.test(name)
        || /^catchAcc\d*$/.test(name);
}

/**
 * Return the source class name encoded in a class record name, or `null` when
 * the record name does not identify a source-level class.
 */
export function resolveSourceClassName(recordName: string): string | null {
    const sharp = recordName.lastIndexOf("#");
    const sourceName = sharp >= 0 ? recordName.slice(sharp + 1) : "";
    if (sourceName.length > 0 && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(sourceName)
        && !isGeneratedTempName(sourceName)) {
        return sourceName;
    }
    if (sharp < 0 && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(recordName)
        && !isGeneratedTempName(recordName)) {
        return recordName;
    }
    return null;
}
