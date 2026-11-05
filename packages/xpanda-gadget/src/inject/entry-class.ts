/**
 * Entry-class discovery for the injected bootstrap.
 * @Author: jmp0
 */
import { PandaPatchFile } from "xpanda-asm";

/**
 * Classes that own a `func_main_0` can act as the patchInit entry.
 * Entry-like names (EntryAbility / entry / pages/Index) are preferred so the
 * gadget starts as early in the app lifecycle as possible.
 */
export function findEntryClassCandidates(patchFile: PandaPatchFile): string[] {
    const withMain: string[] = [];
    for (const name of patchFile.getClassNames()) {
        if (patchFile.hasMethod(name, "func_main_0")) withMain.push(name);
    }
    const score = (name: string): number => {
        let s = 0;
        if (/EntryAbility/i.test(name)) s -= 8;
        if (/entryability/i.test(name)) s -= 4;
        if (/\/pages\/Index/i.test(name)) s -= 2;
        if (/(^|&)entry\//i.test(name)) s -= 1;
        return s;
    };
    return withMain.sort((a, b) => score(a) - score(b) || a.length - b.length);
}
