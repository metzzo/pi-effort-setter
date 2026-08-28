# Contributing

Contributions are welcome. Work from a source checkout; development files and tests are intentionally omitted from the runtime npm tarball.

## Prerequisites

- Node.js 22.19.0 or newer
- Pi 0.84.2 or newer for smoke and integration testing

## Before submitting a change

Run the type check, deterministic suite, and packaged-consumer smoke test:

```bash
npm run check
npm test
npm run test:package
```

Run the extension-loading smoke test when Pi is installed:

```bash
PI_OFFLINE=1 npm run smoke
```

Changes to Pi event handling should also run the opt-in RPC integration suite described in `README.md`:

```bash
npm run test:integration
```

The integration suite uses credentials from a local Pi agent directory, copies them into a temporary directory, makes no LLM request, and removes the directory afterward. Its default models can be overridden through the environment variables documented in `README.md`.

Keep changes focused, update tests and `CHANGELOG.md` when behavior changes, and do not commit credentials or generated state files.
