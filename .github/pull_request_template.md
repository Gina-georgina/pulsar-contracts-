## Summary

<!-- Describe what this PR does and why. -->

## Changes

<!-- List the key changes made. -->

## Testing

<!-- Describe how you tested this change. -->

## Checklist

- [ ] I have updated **CHANGELOG.md** under `## [Unreleased]` with a one-line
      summary of this change using the appropriate heading
      (`Added` / `Changed` / `Deprecated` / `Removed` / `Fixed` / `Security`).
- [ ] If this PR adds, removes, or changes any API route, request schema, or
      response schema, I have updated **docs/api-reference.md** to match the
      current implementation (analytics, webhook registration, DLQ admin, etc.).
- [ ] New or modified behaviour is covered by tests.
- [ ] Clippy and `cargo fmt` pass locally.
- [ ] No new `unwrap()` / `expect()` calls in contract code without justification.
- [ ] If this adds a new public function, the ABI change is intentional and
      documented.

## Smart Contract Checklist

<!-- Complete this section only if this PR modifies smart contract code. -->

- [ ] Snapshot tests updated.
- [ ] ABI reference updated.
- [ ] SDK errors regenerated.
- [ ] CHANGELOG.md updated.
- [ ] ADR written if a design decision is involved.

## Related Issues

<!-- e.g. Closes #123 -->