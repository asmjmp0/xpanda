# Pseudo-goto break restoration — remaining sites and fix plans

Working note for the compiler marker

```js
break; //from goto label_x
```

emitted by `StructureAnalysis.virtualizeIrregularExits` when a conditional edge leaves a loop to a
region that is neither the loop follow nor a dead `Tail`. JavaScript has no forward goto into a
sibling, so the reducer can only emit the marker + an empty `label_x: ;`; the AST-level restorations
must remove it. `AGENTS.md` ("Pitfalls and Notes", pseudo-goto bullet) is the contract for the
marker; this note records the sites that are **still open** in `yourpipe0.7.0.abc` and the intended
fix for each.

Samples/manuals used below:

- `packages/xpanda-core/test/resources/amcl1.0.6.abc` — all markers are gone after this change.
- `packages/xpanda-core/test/resources/yourpipe0.7.0.abc` — two classes still contain markers.
- Ground truth: `reference/source/amcl-main` (amcl); no source tree for yourpipe (behaviour is
  derived from the bytecode + existing class snapshots).

---

## 1. State after the landed fixes

| Shape | Classes restored | What was added |
| --- | --- | --- |
| Forward break form, label after the close | amcl r2/t4 `refresh`, mods/g17 `roundRobinInterleave` | `CopyPropagation.applyPseudoGotoBarrier` (no propagation across the skipped statements) + `checkAndTransformDoWhileToForOfStatement` accepts the no-break-prefix form. |
| Shared continuation duplicated into an `else` branch | amcl launch/i15 `validateInputs`, yourpipe `HlsManifestParser` | `rehydrateSharedContinuationIf` + `findAlternateContinuation`; `RETURN E` moves into the loop exit, the alternate block (CONT) is hoisted after the `if`. |
| `while (COND)` lowered to `do { if (!COND) goto END; BODY } while (breakCond); POST` | amcl mods/e17 `roundRobinInterleave` | `checkAndTransformDoWhileConditionSplit`: exits swapped back into `while (COND) { BODY; if (FOUND) { POST; break } }`. |
| Search-loop rotation (`do { label: r = it.next(); … } while (!FOUND); REST`) | yourpipe `SabrResponseDecoder.local_0_5`, `WebClientVersionResolver.matchFromServiceTracking`, `CookieJar.getCookie`, `YoutubeSabrInfo.findFormatByItagAndTrack`, `YouTubeExtractor.extractLikeCount`; amcl entry/r2/p5 `mouseEntryVisible_`, mods/n17 `t1613` | `checkAndTransformSearchLoop`: `label: for (v of ITER) { …; if (TEST) continue; REST } DONE`, with outer close stripping (simple, hole-wrapped, aliased `alias = it` + `flag = false`), inlined early-return closes removed, and unpack-reusing-`next()`-temp handled separately from "no unpack". |
| Backward pseudo-goto break (label before the loop) | amcl feature_core/r5/m12, gamecontrol/a13 | `GotoLoopRestore` treats pseudo-breaks like `xpanda_goto`: wraps the label span in `label: while (true)` and emits labeled `continue` (nested loops need the label). |
| Real `break` whose tail is `close; return E` | amcl mods/a18 (side effect of the search break rewrite), yourpipe SearchService (partially) | The for-of transform rewrites a real loop `break` to the same `return E` as the found path when the post-loop tail is a single return/throw. |
| Stale binding paths / duplicate region-copy labels | amcl commons/h1/p1 (`label_2939` x2) | `liveNodes` filter in the do-while transform; same-name labels are rejected only when the current loop still contains another jump to that name. |

Verification of the landed work:

```bash
npm test
npm run test:mcp
npm run typecheck
npx tsx packages/xpanda-cli/src/cli.ts decompile packages/xpanda-core/test/resources/amcl1.0.6.abc -o test_out -j 6 --quiet
grep -rn "//from goto" test_out        # 0
```

`amcl` full `-j 6` diff vs the pre-change build: 12 changed classes (r2/t4, mods/g17, launch/c15,
launch/i15, mods/e17, commons/h1/p1, entry/r2/p5, feature_core/r5/m12, gamecontrol/a13,
feature_core/k10/v10, mods/n17, mods/a18), every hunk reviewed; 0 markers remain.
`yourpipe` full `-j 6`: 7 changed classes (SabrResponseDecoder, WebClientVersionResolver,
HlsManifestParser, YouTubeExtractor, YoutubeSabrInfo, CookieJar, SearchService); 2 classes still
contain the marker (below).

---

## 2. Open site A — `SearchService.hasLiveBadge`, `label_652`

Class: `L&entry/src/main/ets/features/home/SearchService&;`
Method: `hasLiveBadge(p0)`.

Current output (after the landed fixes; the marker is still present):

```js
if (p0.badges) {
  v14 = p0.badges[Symbol.iterator]();
  acc = false;
  do {
    v15 = v14.next();
    if (v15.done) {
      break; //from goto label_652       <-- done path
    }
    acc = !!v15.value.metadataBadgeRenderer;
    if (!acc) {
      continue;                          <-- source continue (next badge)
    }
    ...
    if (v20 === "BADGE_STYLE_TYPE_LIVE_NOW" || ...) {
      if (v14.return != undefined) v14.return();
      return true;
    }
    v19 = (v15.value.metadataBadgeRenderer.label || "").toLowerCase();
    if (v19 === "live" || v19 === "live now" || v19.indexOf("live") >= 0) {
      break;                             <-- source break (badge found)
    }
    acc = !((v15.value.metadataBadgeRenderer.label || "").indexOf("直播") >= 0);
  } while (acc);
  if (v14.return != undefined) v14.return();
  return true;                           <-- this must only run for the source break
}
label_652: ;                             <-- done path target: skip `return true`
if (p0.thumbnailOverlays) { ... }
```

Why it is wrong:

- The done path (`v15.done`) jumps to `label_652`, i.e. it skips `close; return true`. The emitted
  `break` exits the do-while and then executes `close; return true`, so an exhausted badge list
  returns `true`.
- `if (!acc) continue` is a **source** `continue` (next badge). In this lowering the `continue`
  evaluates the do-while test with `acc === false`, which exits the loop and returns `true` as well.
- Only the explicit `break` (live label found) is supposed to reach `return true`.

Why the current passes bail:

- `checkAndTransformDoWhileToForOfStatement` validates every `continue` with
  `continueHoldsLoopTest`: it requires the continue path to keep the loop test true. Source
  continues do the opposite here, so the loop is rejected before `findFollowingContinuation` can
  help.
- `checkAndTransformSearchLoop` matches the *rotated* shape (`do { label: r = next(); … } while
  (TEST); REST`), not this one (test materialized at the body end, label after the enclosing `if`).

Fix plan:

1. Add a source-continue search-rotation variant in `checkAndTransformDoWhileToForOfStatement`
   (or a sibling pass) for `do { BODY; X = TEST } while (X)` where:
   - `X` is written only by the final body statement and read only by the test / body guards;
   - the done branch is a single pseudo-break to a following label (after the enclosing `if`);
   - every loop-level `continue` is a genuine source continue (next element), not a test
     continuation — this must be the *assumption of the variant*, so `continueHoldsLoopTest` is
     skipped for this shape;
   - the post-loop tail is `[simple close] return E` (or throw), and the tail does not read the
     loop variable after the loop.
2. Emit `label: for (v of ITER) { BODY'; if (!TEST) { <tail>; break } }`:
   - keep the source `continue`s as plain `continue` (target the for-of);
   - the existing real `break` for "live" runs the same tail (`return true`), as implemented for
     a18;
   - the done path becomes the natural for-of exhaustion, which falls through to `label_652` (remove
     the empty label after the transform, or keep it as the `if`'s follow-up);
   - the close is implicit; remove `if (it.return != undefined) it.return()`.
3. Regression: add `SearchService.hasLiveBadge` to `verifyYourpipeSearchLoopRestorations` with the
   exact fragments `for (v15 of p0.badges)`, `if (!v15.value.metadataBadgeRenderer) continue;`,
   `return true;` and no `//from goto`/`label_652`.
4. Risk: the `if (!acc) continue` path currently exits the loop, so the transform changes behaviour;
   verify against the yourpipe source semantics (a badge without a renderer must be skipped, not
   treated as "no live badge"). This is the main unresolved question for the class.

---

## 3. Open site B — `YoutubeSabrSession`, `label_3142` and `label_4366` (x2)

Class: `L&youtube_core/src/main/ets/extractor/sabr/YoutubeSabrSession&1.0.0;`
Methods: the response-policy application loop (`label_3142`) and the empty-response retry loop
(`label_4366`, two region copies).

Current shape (abridged, `label_3142`):

```js
v26 = this.policy.evaluate(v12, v22)[Symbol.iterator]();
acc = false;
v24 = false;
do {
  v27 = v26.next();
  if (v27.done) {
    break; //from goto label_3142
  }
  if (v27.value.type === "fail") {
    throw new SabrProtocolException(v27.value.message, v27.value.kind);
  }
  if (v27.value.type === "apply_po_token") {
    v12 = await this.applyPoTokenForProtectedResponse();
    acc = !v12;
    if (!v12) {
      continue;                              // retry with the fresh identity
    }
    if (!v24) {
      v24 = true;
      if (v26.return != undefined) v26.return();
    }
    break;                                   // policy applied, leave the scan
  }
  ...
} while (acc);
```

The second and third sites use the same lowering with the `v13` flag and a `v3` iterator.

Why it is wrong / why it is harder:

- The done path must jump to the label after the surrounding block (the "no matching policy" path);
  a plain `break` runs the post-loop tail instead.
- The loop mixes three exits: source `continue` (retry), a flag-guarded close
  (`if (!v24) { v24 = true; close }`) followed by `break`, and the exhausted path. The flags are
  written only on the exit paths and are read after the loop, so they cannot be dropped or
  duplicated.
- Awaited statements (`await this.applyPoTokenForProtectedResponse()`) sit inside the loop; moving
  them into another branch would change the async continuation order.

Fix plan:

1. Apply the same source-continue search rotation as site A, extended with:
   - the loop test `acc` is a materialized source-continue guard, not a "found" test;
   - the found/exit tail (`[flag-guarded close] break`) becomes the `if (FOUND) { ...; break }`
     branch inside the for-of, preserving `if (!v24) { v24 = true; close }` verbatim;
   - the exhausted path becomes the natural for-of exhaustion and lands on the label;
   - `await`s stay in the place they are evaluated; only the tail statements move.
2. Do **not** generalize `stripAliasedOuterClose` to these flags: it assumes `flag = false` on both
   branches and a direct `alias.return()`, while here the flag is a "closed once" latch set to
   `true` and read later. A wrong rewrite either closes twice or drops the close.
3. Regression: add a `YoutubeSabrSession` whole-class snapshot plus a `hasNoPseudoGoto` assertion;
   bisect the two `label_4366` region copies independently (they are separate loops in the same
   method / class).
4. Risk: async control flow + region duplication. Do this in a dedicated change with the full
   yourpipe `-j 6` diff; nothing in this note should be implemented together with unrelated loop
   work.

---

## 4. How to re-audit

```bash
# all remaining markers in a sample
npx tsx packages/xpanda-cli/src/cli.ts decompile packages/xpanda-core/test/resources/yourpipe0.7.0.abc -o /tmp/yp -j 6 --quiet
grep -rn "//from goto" /tmp/yp

# bytecode view of one site
npx tsx .agents/skills/xpanda-structure-forensics/scripts/abc-inspect.ts \
  packages/xpanda-core/test/resources/yourpipe0.7.0.abc \
  "L&youtube_core/src/main/ets/extractor/sabr/YoutubeSabrSession&1.0.0;" '<method>' --cfg <from> <to>
```

The marker contract (what every pass must assume) and the implemented gates are documented in
`AGENTS.md`; this file only tracks the two open classes and their planned transformations.
