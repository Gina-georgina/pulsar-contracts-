# Contributing to Pulsar

Thank you for your interest in contributing! Pulsar is an open-source project and we welcome contributions of all kinds.

By participating in this project, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

## Getting Started

1. Fork the repository and clone your fork.
2. Install prerequisites (see README).
3. Create a feature branch: `git checkout -b feat/your-feature`.
4. Make your changes, add tests, and ensure everything passes.
5. Open a pull request against `main`.

## Development Setup

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Add WASM target
rustup target add wasm32-unknown-unknown

# Run tests
cd contracts/payment-processing-contract
cargo test

# Build WASM
cargo build --target wasm32-unknown-unknown --release
```

## Pre-commit Hooks (DO-013)

A `.pre-commit-config.yaml` is provided at the repository root. It runs hooks
at two stages to catch issues as early as possible — **before** CI ever sees
your code:

| Stage | Hook | What it catches |
|---|---|---|
| `pre-commit` | `cargo fmt --check` | Unformatted Rust code |
| `pre-commit` | `cargo clippy -D warnings` | Lint warnings |
| `pre-push` | `cargo test --all-features --locked` | Failing tests |

### Installation

1. Install [pre-commit](https://pre-commit.com/#install):

   ```bash
   pip install pre-commit
   # or via Homebrew
   brew install pre-commit
   ```

2. Install **both** hook stages into your local clone (one-time setup):

   ```bash
   # Registers the pre-commit stage
   pre-commit install
   # Registers the pre-push stage
   pre-commit install --hook-type pre-push
   ```

   Or install both in one command:

   ```bash
   pre-commit install --install-hooks
   ```

3. The hooks run automatically on every `git commit` (fmt + clippy) and every
   `git push` (tests). To run all hooks manually against all files:

   ```bash
   pre-commit run --all-files
   # or for the push-stage hooks only:
   pre-commit run --hook-stage pre-push --all-files
   ```

> **Note:** The hooks require a working Rust toolchain with `rustfmt` and
> `clippy` components. Install them with:
> ```bash
> rustup component add rustfmt clippy
> ```

## Code Standards

- **Formatting**: run `cargo fmt` before committing.
- **Linting**: run `cargo clippy -- -D warnings`; fix all warnings.
- **License headers**: all `.rs` files must start with `// SPDX-License-Identifier: MIT` (see [LICENSE_HEADERS.md](docs/LICENSE_HEADERS.md)).
- **Tests**: every new function must have at least one unit test.
- **No unsafe**: do not use `unsafe` blocks.
- **No std**: the contract crate is `#![no_std]`; keep it that way.

## Branch Protection Rules

The `main` branch is protected with the following enforced settings:

| Rule | Setting |
|------|---------|
| Required approving reviews | At least **1** before merging |
| Dismiss stale reviews | Yes — a new push dismisses existing approvals |
| Required status checks | All CI jobs must pass (see list below) |
| Require branches to be up to date | Yes — branch must be up to date with `main` before merge |
| No direct pushes | All changes must arrive via a pull request |
| No force-pushes | `git push --force` to `main` is rejected |
| No branch deletion | `main` cannot be deleted |

### Required CI status checks

The following jobs in `.github/workflows/ci.yml` must all pass before merging:

- `test (stable)` — unit tests on stable Rust toolchain
- `test (1.79.0)` — unit tests on the declared MSRV
- `build` — WASM artifact compiles and passes the binary size gate
- `security-audit` — `cargo audit` reports no known vulnerabilities
- `deny` — `cargo deny check` (licence and duplicate-crate policy)
- `coverage` — generates test coverage report (warning only, does not block)

### Why these rules exist

- **Required review**: ensures at least one other maintainer has read every
  change before it lands.
- **Up-to-date branch**: prevents a PR that passed CI from landing on a `main`
  that has since moved forward, which could re-introduce a regression.
- **No direct push / no force-push**: the `main` branch is the source of truth
  for contract deployments; every change must be traceable to a PR review.

These rules are enforced via GitHub branch protection settings. Contributors
cannot bypass them. Maintainers (repo admins) can view and edit the settings
at:
`https://github.com/queenannaE/pulsar-contracts/settings/branches`

## Tagging Convention

Release tags **must** follow [semantic versioning](https://semver.org/) in the
form `vMAJOR.MINOR.PATCH` — for example `v1.2.3`, `v0.1.0`, or `v2.0.0-rc.1`.

The release workflow (`.github/workflows/release.yml`) only triggers on tags
matching the pattern `v[0-9]+.[0-9]+.[0-9]+*`; any other tag (e.g. `test`,
`v1`, or `release-1.2.3`) will not produce a release. A CI job step also
validates the tag against this pattern before continuing, so a malformed tag
fails the workflow rather than producing an unorderable artifact.

```bash
# Correct
git tag v1.2.3
git push origin v1.2.3

# Incorrect — will not trigger a release
git tag test
git tag v1
```

## Pull Request Guidelines

- Keep PRs focused — one feature or fix per PR.
- Write a clear description of what changed and why.
- Reference any related issues with `Closes #<issue>`.
- All CI checks must pass before merging.

## Reporting Issues

Open a GitHub Issue with:
- A clear title and description.
- Steps to reproduce (for bugs).
- Expected vs actual behaviour.
- Rust / Stellar CLI version (`rustc --version`, `stellar --version`).

## Issue Triage

When an issue is opened a maintainer will triage it within the SLA window
below, applying one or more labels and setting a priority.

**Label taxonomy**

| Label | Usage |
|---|---|
| `bug` | A defect in the code or documentation. |
| `enhancement` | A new feature or improvement. |
| `security` | Security-related issue; treated with elevated priority. |
| `documentation` | Docs improvements or corrections. |
| `question` | User questions or usage help. |
| `good first issue` | Well-scoped task suitable for new contributors. |
| `wontfix` | Out of scope or intentionally not addressed. |
| `duplicate` | Duplicate of an existing open issue. |

**Triage process**

1. A maintainer reads the issue and asks for clarifying information if needed.
2. The issue is labelled and assigned a priority (`P0`–`P3`).
3. For bugs, the maintainer attempts to reproduce the issue and records the result in a comment.
4. The issue is added to the project board or milestone if it will be actively worked.

**SLA for first response**

- All new issues receive an initial acknowledgement within **24 hours** on weekdays.
- Critical security issues are responded to within **4 hours**.
- Non-critical issues aim for a response within **48 hours**.

## Security Vulnerabilities

Do **not** open a public issue for security vulnerabilities. Use one of the
following private channels:

- **GitHub private security advisory (preferred):**
  https://github.com/queenannaE/pulsar-contracts/security/advisories/new
- **Email the maintainers:** euniceoyiefieo@gmail.com
  (subject line `[SECURITY] Pulsar — <short summary>`)

See [SECURITY.md](SECURITY.md) for the full disclosure policy, response SLA,
and the list of information to include in your report.

## License

By contributing you agree that your contributions will be licensed under the [MIT License](LICENSE).
