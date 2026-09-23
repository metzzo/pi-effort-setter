# Pi model thinking levels

[![CI](https://github.com/metzzo/pi-effort-setter/actions/workflows/ci.yml/badge.svg)](https://github.com/metzzo/pi-effort-setter/actions/workflows/ci.yml)

A Pi extension that remembers a separate thinking level for every provider/model pair.

For example:

1. Select `openai-codex/gpt-5.6-sol` and set thinking to `xhigh`.
2. Select `kimi-coding/k3` and set thinking to `high`.
3. Switching between them restores `xhigh` for GPT-5.6 Sol and `high` for K3.

Preferences are global across Pi projects and sessions. They are stored as one JSON entry per provider/model under:

```text
~/.pi/agent/model-thinking-levels/
```

`PI_CODING_AGENT_DIR` is respected because the extension resolves the path through Pi's `getAgentDir()` API. Separate entry files let different Pi processes update different models without overwriting one another.

## Requirements

- Pi 0.84.2 or newer; tested on 0.87.1, with no upper version bound
- Node.js 22.19.0 or newer

The package keeps Pi's bundled extension API as a `"*"` peer dependency, as Pi's package documentation recommends. A runtime compatibility check disables the extension with an error on older Pi contexts that do not expose `ctx.scopedModels`.

## Install

Install the current package from GitHub for the current user:

```bash
pi install git:github.com/metzzo/pi-effort-setter
```

After the first npm release, the registry package can be installed with:

```bash
pi install npm:pi-model-thinking-levels
```

Update installed packages or remove the GitHub package with Pi's package manager:

```bash
pi update --extensions
pi remove git:github.com/metzzo/pi-effort-setter
```

For local development, install this checkout by path:

```bash
pi install /absolute/path/to/pi-effort-setter
```

To try the checkout for one Pi process without installing:

```bash
pi --extension ./extensions/model-thinking-levels.ts
```

Pi packages and extensions execute with the user's full permissions. Review the source and [security model](SECURITY.md) before installing. Removing the package does not delete saved preferences; remove the corresponding `model-thinking-levels/` directory under the configured Pi agent directory separately if those should also be erased.

## Behavior

- Model identity is the pair `provider` + `model id`, not the model id alone.
- A newly encountered model starts at Pi's current effective level.
- Later model selections restore that model's saved effective level.
- Pi still clamps saved values to the levels currently supported by the model. The clamped value replaces an obsolete saved value.
- Explicit thinking levels pinned through `--models` or `enabledModels`, such as `kimi-coding/k3:high`, take precedence and become the new saved value.
- Each model's state entry is updated immediately with an atomic temporary-file rename. Different provider/model pairs use different files, so concurrent Pi processes cannot drop unrelated preferences through a shared read-modify-write race.

### Startup caveat

Pi's extension API does not say whether the startup thinking level came from `--thinking`, a `--model ...:level` suffix, restored session state, or the global default. This extension restores the remembered value for the startup model, so an existing remembered value also wins over an ordinary `--thinking` startup argument. Scoped-model pins remain detectable and take precedence.

## How Pi currently implements thinking levels

Research was performed against the locally installed `@earendil-works/pi-coding-agent` 0.84.2 package.

Pi currently has two layers of thinking-level state, both singular rather than per model:

1. The active session has one `agent.state.thinkingLevel`.
2. Global `settings.json` has one `defaultThinkingLevel`.

`AgentSession.setThinkingLevel()` clamps a requested level to the active model, updates the one session value, appends a `thinking_level_change` session entry, and updates the one global default when appropriate. Model switches carry that current preference to the next model and clamp it. This means switching from a model at `xhigh` to one capped at `high` can turn the shared preference into `high`; switching back does not recover the earlier model's `xhigh` value.

Relevant installed sources and documentation:

- `dist/core/agent-session.js` / source map `packages/coding-agent/src/core/agent-session.ts`
  - `setModel()`
  - `_cycleScopedModel()`
  - `_cycleAvailableModel()`
  - `_getThinkingLevelForModelSwitch()`
  - `setThinkingLevel()`
- `dist/core/settings-manager.js`
  - `getDefaultThinkingLevel()`
  - `setDefaultThinkingLevel()`
- `dist/core/session-manager.js`
  - `appendModelChange()`
  - `appendThinkingLevelChange()`
- `docs/settings.md`
- `docs/session-format.md`
- `docs/extensions.md`
- `docs/models.md`

Pi already supports fixed thinking levels in scoped model configuration (`--models` and `enabledModels`), but those are manually configured pins rather than learned per-model preferences.

## Extension design

The implementation uses only public extension APIs:

- `session_start` initializes the active provider/model and restores its saved value.
- `thinking_level_select` saves user or extension changes for the announced active model.
- `model_select` restores the newly selected model's value with `pi.setThinkingLevel()`.
- `ctx.scopedModels` detects explicit scoped-model pins.

Pi changes the active model and may clamp thinking before it emits `model_select`. The earlier `thinking_level_select` notification is started without being awaited. The extension therefore tracks the last announced provider/model and ignores interim or stale thinking notifications. This prevents a switch-time clamp from overwriting the destination model's saved preference before it can be restored.

The installed 0.84.2 documentation describes `model_select` with source `restore`, but no restore emission was found in that version's compiled implementation. Initialization therefore relies on `session_start`, not a restore event.

## Development (source checkout only)

Development files and tests are intentionally omitted from the runtime npm tarball. Clone the source repository before using these commands.

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidance and [RELEASING.md](RELEASING.md) for the release checklist.

Run the TypeScript compatibility check and deterministic filesystem/state-machine tests:

```bash
npm run check
npm test
```

Build the npm tarball in a temporary workspace, install it as a consumer would, and load its declared extension through Pi's package APIs:

```bash
npm run test:package
```

Run the real Pi RPC integration suite (uses the authenticated GPT-5.6 Sol and K3 providers from `~/.pi/agent/auth.json`, but copies credentials into a temporary agent directory):

```bash
npm run test:integration
```

The integration models and levels can be changed with `PI_INTEGRATION_MODEL_A`, `PI_INTEGRATION_LEVEL_A`, `PI_INTEGRATION_MODEL_B`, and `PI_INTEGRATION_LEVEL_B`. Set `PI_INTEGRATION_SOURCE_AGENT_DIR` when the source Pi configuration is elsewhere.

Run a no-request Pi loading smoke test:

```bash
PI_OFFLINE=1 npm run smoke
```

The deterministic suite uses real temporary files and separate writer processes. It covers provider/model separation, persistence, atomic writes, concurrent independent updates, switch-time clamps, scoped preferences, malformed state, inherited-property model names, and validation. The separate RPC suite exercises the installed Pi 0.87.1 event wiring, learned restoration, cross-process startup restoration, and direct model selection with scoped pins without making an LLM request.

Before publishing, run the deterministic release gate:

```bash
npm run release:check
```

## License

[MIT](LICENSE)
