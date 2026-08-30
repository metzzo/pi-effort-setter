# Plan: pi-model-thinking-levels — fixes worth doing

**Basis:** maintainer policy trusts only reviews by gpt-5.6-sol (high) or K3 (high).
Integrated: the v1 correctness review (sol high), five independent v2 reviews (sol high:
overengineering, software engineering, AI/ML, agentic, Pi domain), and main-thread
verification (K3 high). All other v1 reviews are discarded. This plan was then cut to
only what is clearly justified — anything speculative, hypothetical-future, or heavier
than its payoff is in the "not doing" list.

## Verified findings

| # | Finding | Verified by |
|---|---|---|
| F1 | Scoped pin is persisted raw before clamping; if that write throws, `pi.setThinkingLevel()` is skipped and the pin never applies live | correctness v1, sweng v2, pidomain v2; code-traced by main |
| F2 | `lastReportedError` is cleared even when `recordChange` returns false, defeating notification dedup under persistent failure | correctness v1, agentic v2; code-traced by main |
| F3 | Hex path encoding collides on unpaired surrogates (`\uD800`/`\uD801`/`\uFFFD` → `efbfbd`); the stated "reversible" invariant is false over the accepted input domain | executed by main |
| F4 | `src/` — where most invariants live — is excluded from static checking (`checkJs: false`, include only `extensions/**`) | main (tsconfig); sweng v2 major |
| F5 | The stated same-model concurrent-writer contract has no test | main; sweng v2 major, agentic v2 |
| F6 | A corrupt entry disables restore for that model on every future start; no self-repair, error re-reported each time | agentic v2; code-traced by main |
| F7 | If cleanup `rmSync` fails while handling a failed write, it masks the primary error | sweng v2 |
| F8 | CHANGELOG dates 0.1.0 as released with a release link and README says "install the published package", but there is no git tag and npm returns 404 — the package has never been published | main: `git tag -l` empty, `git ls-remote --tags` empty, `npm view` → E404 |
| F9 | Same-model last-writer-wins means a concurrent process's automatic restore can overwrite another process's explicit change; semantic not publicly documented | agentic v2 |
| F10 | The compatibility gate is structural, not semantic; "0.84.2 or newer" is broader than the evidence (only 0.84.2 verified) | pidomain v2 |

## Work items

One coherent commit each, test-first per `AGENTS.md`, in this order.

### 1. Fix release-state documentation (F8)
Move the 0.1.0 changelog content under `[Unreleased]` and drop the dangling release link
until the first real publish; mark README install instructions as applying once published.
Since 0.1.0 was never published, all fixes below fold into the initial 0.1.0 release.

### 2. Pin path: apply before persist (F1)
In `activateModel`: if a pin differs from `pi.getThinkingLevel()`, call
`pi.setThinkingLevel(pinnedLevel)` first, then `activate(model, pi.getThinkingLevel(),
{ restore: false })`. Only effective values reach disk, and a persistence failure no longer
blocks the live pin. Validate via the existing RPC scoped-pin cases.

### 3. Fix error dedup (F2)
Clear `lastReportedError` only when `recordChange` returns `true`, and gate `console.error`
with the same dedup so persistent failures don't spam stderr in print/JSON modes.
Two one-line changes in `extensions/model-thinking-levels.ts`.

### 4. Reject lone surrogates in model identity (F3)
Two-line guard in `assertModel`; tests for Unicode/emoji round-trip and lone-surrogate
rejection. Makes the stated reversibility invariant true.

### 5. Quarantine corrupt entries (F6)
On JSON/validation failure in `readEntry`: rename the entry aside to a unique `.corrupt-*`
name (bytes preserved, reported once), treat the model as unremembered, re-learn the
current effective level. I/O errors (EACCES/EROFS/ENOTDIR) still propagate — never repair
access problems. Tests: quarantine + re-learn, original bytes preserved, I/O errors throw.
README behavior section + CHANGELOG. The one discretionary behavior change here; justified
because unattended agents otherwise lose restore permanently on a single bad byte.

### 6. Same-model multi-process race test (F5)
Reuse `runWriter`: N processes write the same model; assert the final entry is valid,
equals exactly one writer's value, no temp residue. Closes the gap between the stated
invariant and its evidence.

### 7. Static checking for `src/` (F4)
`checkJs: true`, add `src/**/*.js` to tsconfig `include`, minimal JSDoc typedefs. No TS
conversion, tarball unchanged. Gate: `npm run check` green.

### 8. Preserve primary write error (F7)
Wrap the cleanup `rmSync` so its failure can't replace the original write/rename error.

### 9. CI offline smoke
Add `PI_OFFLINE=1 npm run smoke` to CI with `PI_CODING_AGENT_DIR` pointed at a runner temp
dir. Verify locally first that smoke passes with an empty agent dir; if it needs auth,
document the blocker and skip.

### 10. Documentation (F9, F10)
README: same-model semantics (last completed write wins; a concurrent process's restore can
overwrite an explicit change — use scoped pins for hard guarantees); atomic-rename is not
power-loss durability; compatibility worded as "verified against 0.84.2, minimum 0.84.2".
RELEASING.md: on Pi dev-dependency bump, diff the `ThinkingLevel` union and event order,
re-run RPC integration (this is the control for future-level/event drift — no code needed).

## Not doing (overengineering)

- Graceful handling of hypothetical future Pi thinking levels (current fail-closed
  behavior is loud and safe; the RELEASING checklist in item 10 covers it).
- Timeouts in the dev-only RPC harness; expanded failure-path test matrices.
- fsync durability, stale-temp GC, pruning/forget commands, alias fingerprinting,
  structured reasoning-budget storage, cross-process locking/CAS for same-model conflicts.
- Restructuring package-smoke off Pi internals (sanctioned by `AGENTS.md`; no public
  equivalent), relaxing 100% coverage, moving README research, slimming the tarball's
  doc files, full TS conversion of `src/`, AGENTS.md restructuring.
- Worker-thread temp-name collision: unverified hypothesis, Pi loads extensions on the
  main thread; no action.

## Gates

After all items, with complete logs under `.test-workspaces/`:
`npm run release:check`; `npm run test:integration` (credentials permitting, else reported
not run); `PI_OFFLINE=1 npm run smoke`. No publish, tag, or push without explicit
instruction.
