/**
 * `xpanda unpack-index`: unpack a HarmonyOS resources.index into resources.json.
 * @Author: jmp0
 */
import * as fs from "fs";
import * as path from "path";
import { takeValue } from "../args";
import { fail } from "../help";
import { readInputBytes } from "../input";
import { resourcesIndexToJson } from "../resources";

export function runUnpackIndex(args: string[]): void {
    if (args.length < 1) fail("unpack-index: missing <resources.index> file argument", "unpack-index");
    const input = args[0];
    let outDir = "out";
    let stdout = false;
    for (let i = 1; i < args.length; i++) {
        const arg = args[i];
        if (arg === "-o") {
            const parsed = takeValue(args, i, arg, "unpack-index");
            outDir = parsed.value;
            i = parsed.index;
        } else if (arg === "--stdout") {
            stdout = true;
        } else {
            fail(`unknown argument: ${arg}`, "unpack-index");
        }
    }
    const data = readInputBytes(input);
    const { indexFile, json } = resourcesIndexToJson(data);
    const text = JSON.stringify(json, null, 2);
    if (stdout) {
        console.log(text);
        return;
    }
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, "resources.json");
    fs.writeFileSync(outPath, text);
    console.error(`version: ${indexFile.version} (${indexFile.isNewModule ? "RestoolV2" : "Restool"} format)`);
    console.error(`items: ${indexFile.items.length}`);
    const byLimit = new Map<string, number>();
    for (const item of indexFile.items) byLimit.set(item.limitKey, (byLimit.get(item.limitKey) ?? 0) + 1);
    for (const [limitKey, count] of byLimit) console.error(`  ${limitKey}: ${count}`);
    console.log("written: " + outPath);
}
