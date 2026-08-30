# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Remember the effective thinking level independently for each provider/model pair.
- Restore learned preferences on startup and model selection.
- Respect scoped-model thinking-level pins.
- Persist preferences as independent atomically replaced files.
- Guard against switch-time and stale thinking-level events.
- Add deterministic tests, real Pi RPC integration coverage, and package-loading checks.

### Fixed

- Apply scoped-model pins even when preference persistence fails, and save only Pi's effective clamped value.
- Reject model identities containing unpaired Unicode surrogates before path encoding.
- Preserve duplicate-error suppression when switch-time thinking notifications are ignored.

[Unreleased]: https://github.com/metzzo/pi-effort-setter/commits/main
