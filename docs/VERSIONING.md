# Versioning Policy

Pulsar Contract follows [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html)
(`MAJOR.MINOR.PATCH`).

## Version increments

| Increment | When to use |
|-----------|-------------|
| **MAJOR** | Breaking ABI change — any change to public function signatures, removed functions, or changed `#[contracttype]` layouts that would break existing callers or stored data. |
| **MINOR** | Backwards-compatible new functionality — new public functions, new optional parameters, new event topics, or new storage keys that do not affect existing callers. |
| **PATCH** | Backwards-compatible bug fixes, documentation updates, internal refactors, or dependency bumps that do not change the public ABI. |

## Release process

1. Decide the new version number using the table above.
2. Update the version field in `contracts/payment-processing-contract/Cargo.toml`:
   ```toml
   [package]
   version = "x.y.z"
   ```
3. Add a new `## [x.y.z] - YYYY-MM-DD` section at the top of [CHANGELOG.md](../CHANGELOG.md)
   describing all changes under the standard headings (`Added`, `Changed`, `Deprecated`,
   `Removed`, `Fixed`, `Security`).
4. Commit with message `chore(release): bump version to x.y.z`.
5. Push the commit and open a pull request against `main`.
6. Once the PR is merged, CI (`release.yml`) automatically:
   - Reads the version from `Cargo.toml`.
   - Checks whether a `v<x.y.z>` tag already exists.
   - Creates the tag and a GitHub Release with release notes extracted from `CHANGELOG.md`.
   - The CI `release` job in `ci.yml` also builds the WASM binary and uploads it—along
     with its SHA-256 checksum—to the GitHub Release as permanent assets.

## On-chain contract version

The contract stores its own version in persistent storage under the
`ContractVersion` key. It is initialised to `1` by `set_admin` and must be bumped
every time the deployed WASM is replaced, so that off-chain tools can detect that
a migration has occurred.

### Upgrading the contract

Use the admin-only `upgrade_contract` function:

```rust
pub fn upgrade_contract(env: Env, new_wasm_hash: BytesN<32>) -> u32
```

It performs the following steps atomically:

1. Requires authorization from the stored admin address.
2. Reads the current on-chain version (defaulting to `1` if unset).
3. Computes the new version as `old_version + 1`.
4. Persists the new version under the `ContractVersion` key.
5. Replaces the contract WASM with `new_wasm_hash`.
6. Emits a `contract_upgraded` event carrying the old and new versions.

The function returns the new version number.

> **Note:** the on-chain version is a monotonically increasing counter, not the
> semver string from `Cargo.toml`. Keep the two in sync manually: when you cut a
> release, record the mapping between the semver tag and the on-chain counter in
> the release notes.

### `contract_upgraded` event

The event is published with the topic `contract_upgraded` and the payload
`(old_version, new_version)`:

```text
topics: ["contract_upgraded"]
data:   (u32, u32)   // (old_version, new_version)
```

### Recommended workflow for off-chain tools

1. Before interacting with the contract, read the stored `ContractVersion`.
2. Cache the value alongside any cached ABI or decoded state.
3. Subscribe to the `contract_upgraded` event (or poll the version) and compare
   the observed version with the cached one.
4. If the version has increased, refresh the ABI, re-fetch any cached state, and
   re-run any pending migrations before submitting further transactions.

Because the version is bumped in the same invocation that swaps the WASM, a
version change observed by a client always implies the code has changed.

## Pre-release versions
=======

Append a pre-release suffix when shipping alpha or release-candidate builds:

```
0.2.0-alpha.1
0.2.0-rc.1
```

These follow semver pre-release semantics. CI will still tag and create a GitHub Release
for pre-release versions; consumers should pin exact versions for pre-releases.

## Changelog format

Follow [Keep a Changelog](https://keepachangelog.com/en/1.0.0/):

```markdown
## [x.y.z] - YYYY-MM-DD

### Added
- …

### Changed
- …

### Fixed
- …
```

The `[Unreleased]` section at the top of `CHANGELOG.md` accumulates changes that are
on `main` but not yet tagged. Move its contents to a versioned section when cutting a
release.
