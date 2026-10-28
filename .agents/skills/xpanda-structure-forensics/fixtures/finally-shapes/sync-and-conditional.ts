/**
 * Ground-truth fixture: sync finally/catch and conditional cleanup.
 *
 * The sync forms are the cleanest way to see the two handler signatures:
 *
 *   syncFinally: `sta pending; if (<resumeFlag> == undefined) { <cleanup> };
 *                ldhole; sta; noteq; if (pending != hole) throw pending; return`.
 *   syncCatch:   `sta e; <cleanup>; lda e; throw` (no hole guard).
 *
 * `asyncFinallyConditional` mirrors amcl mods/o17 `execute`: the cleanup copy in
 * the handler is wrapped in `if (<resumeFlag> == undefined)`, and the normal path
 * runs its own inlined copy.
 */
function stepSync(): number {
    return 1;
}
function cleanupSync(): void {}

async function step(): Promise<number> {
    return 1;
}
async function settle(): Promise<void> {}
function reserve(): () => void {
    return () => {};
}

export function syncFinally(flag: boolean): number {
    try {
        return stepSync();
    } finally {
        if (flag) {
            cleanupSync();
        }
    }
}

export function syncCatch(): number {
    try {
        return stepSync();
    } catch (e) {
        cleanupSync();
        throw e;
    }
}

export async function asyncFinallyConditional(flag: boolean): Promise<number> {
    const release = reserve();
    try {
        await step();
        return 1;
    } finally {
        if (flag) {
            await settle();
        }
        release();
    }
}

export async function asyncCatchAwait(): Promise<number> {
    try {
        await step();
        return 1;
    } catch (e) {
        await settle();
        throw e;
    }
}
