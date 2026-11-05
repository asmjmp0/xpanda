/**
 * resources.index → serializable summary (shared by `unpack-index` and hap mode).
 * @Author: jmp0
 */
import { ResourceIndexFile } from "xpanda-core";

export function resourcesIndexToJson(data: Uint8Array): { indexFile: ResourceIndexFile; json: any } {
    const indexFile = new ResourceIndexFile(data);
    const json = {
        version: indexFile.version,
        isNewModule: indexFile.isNewModule,
        count: indexFile.items.length,
        items: indexFile.items.map((item) => ({
            id: "0x" + item.id.toString(16).padStart(8, "0"),
            name: item.name,
            type: item.typeName,
            limitKey: item.limitKey,
            value: item.value,
        })),
    };
    return { indexFile, json };
}
