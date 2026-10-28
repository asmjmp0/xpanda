/**
 * Ground-truth fixture: multiple exits with an await finally.
 *
 * The cleanup is not duplicated per return: the exits that need it jump to one
 * shared normal-path copy, and the exception handler carries a second copy behind
 * the `if (<resumeFlag> == undefined)` guard. This is the shape that makes
 * `locateInlinedCleanupStart` search forward across several blocks (an inlined
 * copy may start in a tiny `v0 = undefined` block before the real cleanup).
 *
 * `multiExitCatch` is the same body with `catch + await cleanup + throw` instead:
 * one entry, no hole guard.
 */
async function step(): Promise<number> {
    return 1;
}
async function settle(): Promise<void> {}

export async function multiExit(flag: boolean): Promise<number> {
    try {
        if (flag) {
            return 1;
        }
        await step();
        return 2;
    } finally {
        await settle();
    }
}

export async function multiExitCatch(flag: boolean): Promise<number> {
    try {
        if (flag) {
            return 1;
        }
        await step();
        return 2;
    } catch (e) {
        await settle();
        throw e;
    }
}
