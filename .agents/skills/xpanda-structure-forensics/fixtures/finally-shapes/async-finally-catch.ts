/**
 * Ground-truth fixture: async try/finally vs try/catch lowering.
 *
 * Compile with `reference/es2abc` (see scripts/compile-shapes.ts) and dump the
 * normalized assembly. Expected signatures (24.0.0.0; the classic hole-guard form
 * also appears on 13.0.1.0, e.g. amcl mods/o17 `execute`):
 *
 *   executeFinally (finally):
 *     two try entries for the same start: `start..bridge` -> pure rethrow bridge,
 *     `start..cleanupHandler` -> cleanup handler. The handler starts with `sta`,
 *     may guard the cleanup copy with `if (<resumeFlag> == undefined)`, and ends
 *     with `ldhole; sta; noteq; if (pending != hole) throw pending; <resolve/return>`.
 *     The normal path carries an inlined copy of the same cleanup before its exit.
 *
 *   executeCatch (catch + cleanup + rethrow):
 *     one try entry; the handler is `sta e; <body>; lda e; throw` - no hole guard,
 *     no resume-flag wrapper around the cleanup.
 */
async function step(): Promise<number> {
    return 1;
}
async function settle(): Promise<void> {}
function reserve(): () => void {
    return () => {};
}

export async function executeFinally(): Promise<number> {
    const release = reserve();
    try {
        await step();
        return 1;
    } finally {
        await settle();
        release();
    }
}

export async function executeCatch(): Promise<number> {
    try {
        await step();
        return 1;
    } catch (e) {
        await settle();
        throw e;
    }
}

export async function executeConditionalCatch(flag: boolean): Promise<number> {
    try {
        await step();
        return 1;
    } catch (e) {
        if (flag) {
            await settle();
        }
        throw e;
    }
}
