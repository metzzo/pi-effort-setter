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

- Validate type checking, RPC integration, packed loading, and real installed-package smoke sessions on Pi 0.87.1 and 1.5.2; pin development dependencies to 1.5.2 while retaining the wildcard host peer and capability-based startup check without an upper version bound.
- Make packed-consumer tests follow the installed development Pi version instead of always testing 0.87.1; cover repeated scoped cycling and explicit `off` pins through real Pi RPC.

- Apply scoped-model pins even when preference persistence fails, and save only Pi's effective clamped value.
- Reject model identities containing unpaired Unicode surrogates before path encoding.
- Preserve duplicate-error suppression when switch-time thinking notifications are ignored.

[Unreleased]: https://github.com/metzzo/pi-effort-setter/commits/main
