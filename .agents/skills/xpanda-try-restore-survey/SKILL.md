---
name: xpanda-try-restore-survey
description: Use when auditing a whole HarmonyOS .abc/.hap sample for how many try/catch/finally structures are restored vs lost - e.g. "how many finallys are not restored in this abc", a release-quality check of a new sample, or deciding whether a restoration bug report is sample-wide or isolated. Cross-checks the bytecode try table (classifyTryEntries kinds + buildFinallyPlans) against the decompiled output (residue markers, catch/finally counts) and drills into the delta with abc-inspect. Not for fixing one specific missing structure - for that use xpanda-structure-forensics.
---

# Xpanda try-restore survey

A whole-sample audit answers one question: **of everything the bytecode try table
promises, how much did the decompiled output actually deliver?** The output text
alone cannot answer it - a finally that is lost at `classifyTryEntries` leaves no
trace in the output, and the `try/finally not restored` note itself can be pruned by
`removeUnreachableStatements`. The evidence is the delta between the bytecode side
and the output side.

For fixing one specific broken structure, use `xpanda-structure-forensics` instead.
This skill is the census that tells you whether there is anything to fix at all.

## 1. Run the survey

One pass, from the repo root (serial decompile of every class that has try entries;
a 1MB sample takes a couple of minutes):

```bash
npx tsx .agents/skills/xpanda-try-restore-survey/scripts/try-survey.ts \
  packages/xpanda-core/test/resources/<sample>.abc
# .hap: add --abc <entry> when the package holds several .abc entries
```

Exit code 1 means findings (residue markers, SimpleAnalysis fallback, or a class
whose kept catch/finally entry count does not match its output counts).

The report has four sections:

1. **Census** - version, methods with try entries, raw try entries, kept/dropped,
   per-kind histogram, finally plans by shape, SimpleAnalysis count.
2. **Residue scan** - `try/finally not restored` notes, `\bhole\b`, `xpanda_goto`,
   `panda_jmp0_reserved`, `created by SimpleAnalysis`, per class.
3. **Per-method detail** - one line per method with try entries: kinds with
   `(drop)` markers (`!` = usesException), plan ids/shapes, class-level output
   `try/catch/finally` counts.
4. **Class-level mismatch report** - classes where kept entries and output counts
   disagree. This is the primary "something was lost" detector.

## 2. Read the verdict against the design-drop taxonomy

Dropped entries are by-design drops, not losses. Map every dropped kind before
counting anything as "not restored":

| Kind | Bytecode shape | Why dropping is correct |
| --- | --- | --- |
| `pureRethrow` | `sta vX; lda vX; throw` handler | module-init `catch(e) { throw e }` wrapper; `removeRedundantRethrowCatches` unwraps the try later |
| `asyncReject` | handler dispatches the await rejection | the reject dispatch is deleted from the region graph by design |
| `forOfClose` | `it.return()` call inside a try | for-of close is compiler-generated; `for (x of xs)` has the semantics built in |
| `forInAcquire` / `noProtectedRange` | iterable-acquisition TDZ try | same for-of/for-in family |
| `unknown` (in a trio with the two above) | the for-of **body** try: `try { body } catch { close iterator; throw }` | compiler-generated loop protection, restored by the for-of pass |
| `classicFinally` with **no plan** | handler directly followed by the guard | **empty-finally candidate**: the cleanup body was compiled away, `try {} finally {}` ≡ no try. Verify, then count as no-op, not as a loss |

Everything kept must materialize: `userCatch` / `userCatch!` / `ignoredCatch`
produce a `catch` block, `finallyEpilogue` (and a classicFinally **with** a plan)
produce a `finally` block.

## 3. Drill into findings

The survey only locates the delta; confirm ground truth per method with
`abc-inspect` (see the forensics skill for the full recipe set):

```bash
# is the handler really followed by the guard with no cleanup between?
npx tsx .agents/skills/xpanda-structure-forensics/scripts/abc-inspect.ts \
  <sample>.abc <Class> <method> --entries --plans --cfg <handlerPC> <guardEndPC>
# map a decompiled function to its bytecode method by a string literal
npx tsx .agents/skills/xpanda-structure-forensics/scripts/abc-inspect.ts \
  <sample>.abc --find "some literal in the method"
```

Decision rules drilled by hand:

- **classicFinally, keep=false, no plan** → dump the cfg from the handler pc.
  Cleanup exists: handler block has instructions between `sta` and the hole-guard
  block (compare `DartExecutor.executeDartCallback`: handler @220, cleanup @222,
  guard @256). Cleanup gone: handler is a bare `sta` and the next block is already
  the guard, often with a **dead compare** (`ldundefined; eq vX` whose result the
  following `ldhole` overwrites) - that vestige is the proof the cleanup was empty.
  Empty cleanup ≡ source-level `try { } finally { }`: record as no-op.
- **finallyEpilogue kept but the class output has no `finally`** → plan built but
  layout failed; the note may have been pruned. Trace with the forensics skill §3.
- **mismatch where output < kept** → a catch/finally body was lost; forensics.
- **mismatch where output > kept** → usually benign (region copies), check what
  the extra catch protects before dismissing.

Then read the restored `finally` bodies in the output - a `finally {` keyword with
a swallowed body is not a restoration. Compare against the cleanup block you saw in
the bytecode.

## 4. Pitfalls

- **Count real catch clauses, not the substring**: `acc.catch(function (p0) {…})`
  is a Promise API call and real source code. The output-side regex is
  `/\}\s*catch\s*\(/g`, never plain `catch (`.
- **Absence of the note is not proof of restoration** - `removeUnreachableStatements`
  prunes the `try/finally not restored` comment when the method tail exits. The
  kept-vs-output count cross-check is the actual evidence.
- **Class-level counts are the detector, not the verdict**: they attribute output
  to the whole class while entries belong to methods. A mismatch tells you which
  class to open, not which method is broken.
- **Older bytecode versions (12.x) are outside the AGENTS.md notes**: the samples
  documented there are 13.0.1.0 / 24.0.0.0. A 12.0.2.0 sample may show shapes the
  notes call impossible (e.g. an empty finally whose TDZ-guard compare survived as
  dead code). Trust the cfg dump over the notes.
- **`hole` residue scanning needs `\b`**: identifiers or strings containing "hole"
  false-positive without word boundaries; every hit still needs eyes.
- The survey decompiles each try-bearing class a second time (it must, to count
  output). Do not point it at a `--no-simplify` output and expect the counts to
  match the optimized pipeline.

## 5. Record the result

A clean audit (0 residue, 0 SimpleAnalysis, 0 mismatch, every dropped kind mapped)
is itself a result worth writing down: sample name, bytecode version, census
numbers, and the empty-finally candidates with their cfg evidence. If the sample
becomes a regression target, add the key classes to `packages/xpanda-core/test/decompile.test.ts`
(assertions on `finally {` presence and absence of residue markers), following the
existing `verifyAmcl*` pattern.
