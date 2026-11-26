# Fuzz & Property-Based Tests

> **Issue T-011** — Property-based tests for `validate_amount`,
> `matches_filter`, and `paginate_payments`.

---

## Overview

The contract uses [proptest](https://proptest-rs.github.io/proptest/) for
property-based testing. Proptest generates hundreds of random inputs for each
property and shrinks any failing case to the smallest reproducer.

The test module lives at:

```
contracts/payment-processing-contract/src/prop_tests.rs
```

---

## Properties Covered

### `validate_amount`

| Property | Description |
|---|---|
| Positive amounts accepted | Any `amount > 0` returns `Ok(())` |
| Zero rejected | `amount == 0` returns `Err(InvalidAmount)` |
| Negative amounts rejected | Any `amount < 0` returns `Err(InvalidAmount)` |
| Boundary: `i128::MAX` valid | Maximum representable value is accepted |
| Boundary: `i128::MIN` invalid | Minimum representable value is rejected |

### `matches_filter`

| Property | Description |
|---|---|
| Empty filter always passes | A filter with no constraints and `StatusFilter::Any` never rejects a record |
| `amount_min` boundary | Record at exactly `amount_min` passes; record at `amount_min + 1` fails |
| `amount_max` boundary | Record at exactly `amount_max` passes; record at `amount_max - 1` fails |
| Inverted range never passes | When `amount_min > amount_max` no record can satisfy both bounds |
| `date_start` boundary | Record at exactly `date_start` passes; record one second earlier fails |
| Status mismatch | A `Completed` record fails a `PartiallyRefunded` filter |
| Status mismatch (refunded) | A `FullyRefunded` record fails a `Completed` filter |

### `paginate_payments`

| Property | Description |
|---|---|
| Page size bounded | Returned page never exceeds `min(limit, 100)` records |
| Cursor iff more records | `next_cursor` is `Some` iff there are records beyond the current page |
| Full traversal | Following all cursors yields every record exactly once |
| Empty input | Empty record set returns empty page, no cursor, total = 0 |
| Zero limit | A limit of 0 produces an empty page |

---

## Running Locally

```bash
# Run all property tests with the default 256 cases
cargo test prop_ --all-features --locked
```

Run from the contract directory:

```bash
cd contracts/payment-processing-contract
cargo test prop_ --all-features --locked
```

### Increase the number of cases

```bash
PROPTEST_CASES=1000 cargo test prop_ --all-features --locked
```

### Replay a failing seed

When proptest finds a failure it prints a line like:

```
PROPTEST_SEED=abc123...
```

Replay it with:

```bash
PROPTEST_SEED=abc123... cargo test prop_ --all-features --locked
```

Proptest also saves a regression file at:

```
contracts/payment-processing-contract/proptest-regressions/prop_tests.txt
```

This file is committed to the repository so that previously found failures are
always re-tested on every run.

---

## Fuzz Testing

> **Issue T-023** — Fuzz coverage for `request_validation.rs` input
> sanitisation.

The contract also ships a [cargo-fuzz](https://github.com/rust-fuzz/cargo-fuzz)
target that feeds arbitrary byte inputs into the string validation functions in
`request_validation.rs` (merchant name, description, and contact info). This
catches panics and unexpected behaviour on adversarial inputs that
property-based tests are unlikely to generate.

The fuzz target lives at:

```
contracts/payment-processing-contract/fuzz/fuzz_targets/request_validation.rs
```

### Install cargo-fuzz

```bash
cargo install cargo-fuzz
```

`cargo-fuzz` requires a nightly toolchain:

```bash
rustup toolchain install nightly
```

### Run the fuzz target locally

From the fuzz directory:

```bash
cd contracts/payment-processing-contract/fuzz
cargo fuzz run request_validation
```

The target runs until it finds a crash or you stop it with `Ctrl+C`.

### Set a time limit

Pass libFuzzer flags after `--`. For example, to run for 10 minutes:

```bash
cargo fuzz run request_validation -- -max_total_time=600
```

Other useful flags:

| Flag | Description |
|---|---|
| `-max_total_time=<secs>` | Stop after the given number of seconds |
| `-runs=<n>` | Stop after `n` individual inputs |
| `-jobs=<n>` | Run `n` parallel fuzzing jobs |
| `-workers=<n>` | Run `n` parallel worker processes |

### Reproduce and minimise a crash

When a crash is found, the offending input is written to
`fuzz/artifacts/request_validation/`. Re-run it with:

```bash
cargo fuzz run request_validation fuzz/artifacts/request_validation/<crash-file>
```

Minimise the reproducer to the smallest input that still crashes:

```bash
cargo fuzz tmin request_validation fuzz/artifacts/request_validation/<crash-file>
```

Fix the underlying bug in `request_validation.rs` before merging, and add the
minimised input as a regression case if appropriate.

### CI

The fuzz target is exercised by a nightly workflow
(`.github/workflows/fuzz.yml`) that runs:

```bash
cargo fuzz run request_validation -- -max_total_time=600
```

for at least 10 minutes. Any crash fails the workflow.

---

## CI

Property-based tests run as a separate `property-tests` job in
`.github/workflows/ci.yml`. The job runs with `PROPTEST_CASES=512` and is
independent of the main `test` matrix so it does not block the WASM build.

---

## Adding New Properties

1. Add a new `proptest!` block in `src/prop_tests.rs`.
2. Use `prop_assert!` / `prop_assert_eq!` for assertions.
3. Document the new property in this file.
4. Run locally to verify before pushing.
