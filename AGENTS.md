# AGENTS.md

This file is the operating guide for autonomous coding agents working in this repository. Follow it for every change unless the human gives a more specific instruction.

## Mission

Maintain `pi-model-thinking-levels`: a small Pi extension that learns and restores the effective thinking level independently for each exact provider/model pair.

Optimize for correctness, compatibility with Pi's public extension API, simple implementation, safe persistence, and a trustworthy public package. Do not add unrelated features or abstractions.

## Work independently

1. Read the relevant code, tests, documentation, and current Git state before acting. Verify assumptions against the checked-out version rather than memory.
2. Trace the complete behavior before editing. For event changes, inspect both Pi's documented contract and the installed implementation's event order.
3. Make the smallest complete change, add or update tests, run the applicable gates, update public documentation, and commit coherent work.
4. Resolve ordinary implementation details from repository evidence. Ask only when a requirement is genuinely ambiguous or an irreversible external action needs authorization.
5. Never discard, overwrite, or reformat unrelated user work. Avoid destructive Git commands.
6. Push, publish, create releases, change remotes, or alter external services only when the human explicitly requests that action.
7. Support every completion claim with a command, output artifact, inspected file, or authoritative documentation. State any test gap plainly.

## Repository map

- `extensions/model-thinking-levels.ts` — thin Pi API adapter and event wiring.
- `src/model-thinking-levels.js` — provider/model memory and filesystem persistence; keep this independent of Pi so it remains deterministic to test.
- `test/model-thinking-levels.test.js` — state-machine, validation, persistence, atomicity, and multi-process tests.
- `integration/rpc.js` — real Pi RPC integration without an LLM request, tested on 0.87.1 and 1.5.2.
- `scripts/package-smoke.js` — builds the actual npm tarball, installs it in a temporary consumer, resolves the Pi package manifest, and loads the packed extension.
- `package.json`, `package-lock.json`, `tsconfig.json` — public package contract, pinned development graph, scripts, and TypeScript boundary.
- `README.md` — user behavior, limitations, installation, and design research.
- `CHANGELOG.md` — user-visible changes.
- `CONTRIBUTING.md`, `SECURITY.md`, `RELEASING.md` — public project policy.
- `.github/workflows/ci.yml` — release checks on the configured Node versions.

Update this guide when repository structure, supported versions, product invariants, or required commands change.

## Product invariants

Treat these as contracts. Do not weaken them accidentally.

### Model identity and thinking semantics

- The key is the exact tuple `(model.provider, model.id)`. A bare model ID is not unique.
- Do not use a joined `provider/model` string as an internal identity key. At an external configuration boundary, split a Pi-style model spec only at the first slash so separators in the model ID are preserved.
- Thinking levels are Pi's ordered enum: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`.
- Store Pi's effective level after capability clamping, not merely the requested level.
- A model with `reasoning: false` supports only `off`. Persist `off` after Pi clamps any saved or pinned non-off request for that model.
- Capability maps may omit levels or contain non-contiguous mappings. Never infer support from a provider, model name, or assumed maximum; defer to Pi's metadata and clamping.
- A matching scoped-model pin, including `off`, takes precedence over learned memory as a requested level. Save only `pi.getThinkingLevel()` after Pi applies capability clamping.

### Persistence and concurrency

- State belongs under `getAgentDir()/model-thinking-levels/`; therefore `PI_CODING_AGENT_DIR` must continue to work.
- Keep one versioned JSON entry per provider/model. Separate entries prevent concurrent processes updating unrelated models from losing one another's writes.
- Path segments must be reversible and traversal-safe. The current UTF-8 hex encoding is deliberate; do not replace it with a hash.
- Write a temporary file in the destination directory and atomically rename it. Always clean temporary files on failure.
- Validate the entry version, provider, model ID, and thinking level on every read. Corrupt or mismatched data must not be accepted silently.
- Version 1 state is public persisted data. Any incompatible format change needs an explicit compatibility/migration plan and tests.
- Same-model concurrent writers use last completed atomic rename semantics. Do not claim stronger coordination unless it is implemented and tested.

### Pi event ordering

- Pi changes the live model and may clamp thinking before emitting `model_select`.
- `thinking_level_select` is notification-only and can be delayed because event dispatch is not awaited before the switch continues.
- Keep the announced active provider/model explicit. Ignore interim notifications for a destination model and stale notifications whose level differs from `pi.getThinkingLevel()`.
- Compare models by provider and ID, never object identity.
- `session_start` performs startup initialization. Do not rely on a `model_select` event with `source: "restore"`; Pi 0.84.2 documents it but does not emit it in the installed implementation.
- Avoid no-op `pi.setThinkingLevel()` calls. After setting, persist `pi.getThinkingLevel()` so capability clamps are reflected.
- Event handlers must be safe when events overlap and must not allow an extension error to break the Pi session.

### Startup and compatibility

- Startup restoration intentionally lets an existing learned value beat an ordinary `--thinking` argument because Pi's public context does not expose the source of the startup value.
- Scoped pins remain detectable and beat learned startup memory. Only entries in `ctx.scopedModels` are scoped pins; a `--model provider/model:level` startup shorthand is otherwise just part of the startup effective level.
- The minimum required Pi API is from 0.84.2; startup checks capabilities, not version numbers. Development dependencies pin 1.5.2; packed-load tests use the currently installed development Pi version so temporary 0.87.1 compatibility runs exercise that host too. Test both 0.87.1 and 1.5.2 without adding an upper host version bound.
- Keep Pi's bundled core package as a `"*"` peer dependency, as Pi's package documentation requires.

### Security and privacy

- Pi extensions execute with the user's full permissions. Keep the published extension's direct filesystem access limited to its state directory; do not add runtime network calls, subprocesses, telemetry, or credential access.
- Never commit Pi `auth.json`, `models-store.json`, state entries, environment files, test workspaces, logs, or npm tarballs.
- The RPC integration may copy local Pi credentials into a temporary agent directory. It must make no LLM request, clean up in `finally`, and never print credential contents.
- Do not point tests at the user's writable agent directory. Use isolated temporary directories.

## Pi API research

Use public APIs in production code. After `npm ci`, authoritative version-matched material is under:

- `node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`
- `node_modules/@earendil-works/pi-coding-agent/docs/packages.md`
- `node_modules/@earendil-works/pi-coding-agent/docs/rpc.md`
- `node_modules/@earendil-works/pi-coding-agent/docs/models.md`
- `node_modules/@earendil-works/pi-coding-agent/docs/settings.md`
- `node_modules/@earendil-works/pi-coding-agent/docs/session-format.md`
- `node_modules/@earendil-works/pi-coding-agent/examples/extensions/`

For Pi integration changes, read the relevant documents completely and follow the directly related links needed for the change. When documentation and installed behavior differ, verify the pinned compiled implementation, record the exact version/files/order, isolate the workaround, and test it through real Pi. Published extension code must not depend on private compiled internals. Version-pinned test harnesses under `scripts/` or `integration/` may inspect or import them only when no public API can verify the behavior; keep that use isolated and update it with the pinned Pi version.

The key public surfaces used here are `session_start`, `model_select`, `thinking_level_select`, `pi.getThinkingLevel()`, `pi.setThinkingLevel()`, `ctx.model`, `ctx.scopedModels`, and `getAgentDir()`.

## Implementation rules

- Use ESM and the existing Node.js/TypeScript style.
- Keep Pi-specific code in `extensions/` and reusable behavior in `src/`.
- Prefer straightforward functions and explicit state over frameworks, generic repositories, or speculative abstractions.
- Avoid new runtime dependencies unless the requirement cannot be met safely with Node and Pi APIs. Explain any necessary dependency in the commit.
- Do not use hash functions. Preserve reversible path encoding.
- Preserve useful error causes. User-facing notifications should be concise and deduplicated; diagnostics may go to stderr but must not expose sensitive content.
- Validate at filesystem and public input boundaries. Do not add redundant validation inside already-proven internal paths.
- Keep synchronous state I/O small and bounded. If changing the I/O model, first prove that event ordering and durability remain correct.
- Comments should explain non-obvious constraints, especially Pi event races, not restate code.

## Testing workflow

Use test-first development for behavior changes. Test real behavior with temporary files, separate processes, the actual package tarball, and Pi RPC; do not fake the implementation being tested.

Install the exact development dependency graph:

```bash
npm ci
```

Run the deterministic release gate for code, package, dependency, or public-documentation changes:

```bash
npm run release:check
```

It must pass TypeScript checking, the deterministic suite with 100% line/branch/function coverage of `src/`, and packed-consumer loading.

For changes to event wiring, startup behavior, model identity, scoped pins, capability clamping, persistence timing, or Pi compatibility, also run:

```bash
npm run test:integration
PI_OFFLINE=1 npm run smoke
```

The integration defaults require authenticated `openai-codex/gpt-6.1-sol` and `kimi-coding/k3` models. Use the documented `PI_INTEGRATION_*` overrides when needed. If credentials or providers are unavailable, report the integration test as not run; never substitute a fake or make an LLM request.

After release preparation is complete, and immediately before an authorized publish, run:

```bash
npm publish --dry-run
```

Re-run it after any change to the manifest or tarball contents. This dry run does not authorize an actual publish.

Capture complete output for every required suite or gate under ignored `.test-workspaces/`. On success, report the exit status and artifact path. On failure, inspect the saved log's summary and exact failing section; do not rerun merely to discover which test failed. A passing rerun does not explain a flaky failure.

### Change-specific coverage

- Persistence changes: cover missing, malformed, mismatched, and special-name entries; atomic cleanup; new store instances; and relevant multi-process races.
- Event changes: cover switch-time clamps, delayed/stale notifications, rapid model changes, direct selection, scoped pins, startup, and effective-value persistence.
- Capability/clamping changes: cover `reasoning: false`, unsupported saved and pinned levels, and non-contiguous capability maps when practical.
- Package layout changes: update the exact file contract in `scripts/package-smoke.js` and prove the packed extension loads.
- Compatibility changes: test the minimum supported Pi version and update all version declarations and docs together.
- User-visible changes: update `CHANGELOG.md`; update `README.md` when behavior contracts, usage, compatibility, or limitations change.

## Git and release discipline

- Start and finish with `git status --short --branch`. Account for every changed and untracked file.
- Review `git diff` and run `git diff --check` before committing.
- Commit completed work in small, coherent chunks using the configured repository identity. Do not leave changes from the assigned task uncommitted; preserve and explicitly account for pre-existing or unrelated changes.
- Never rewrite public history, force-push, publish npm packages, create tags/releases, or change repository visibility unless explicitly instructed.
- Follow `RELEASING.md` for releases. Keep npm version, changelog, tag, and GitHub release aligned.
- The npm tarball is intentionally runtime-focused; tests and development scripts remain in the source repository.

## Definition of done

A change is done only when:

1. The implementation is the smallest complete solution and preserves the product invariants.
2. All applicable deterministic, integration, smoke, package, and release checks have passed, with evidence retained. A check blocked by unavailable credentials, providers, platforms, or required tooling is reported as not run with the exact blocker; it is never replaced with a fake.
3. Public behavior, limitations, compatibility, and changelog entries are accurate.
4. Security-sensitive and generated files are absent from the commit.
5. The diff has been reviewed and changes from this work are committed coherently. The working tree is clean, or pre-existing/unrelated changes are preserved and explicitly accounted for in the final report.
6. The final report names the commit, validation evidence, and anything not tested or intentionally not performed.
