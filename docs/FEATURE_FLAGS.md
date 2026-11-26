# Feature Flags

This document describes the feature flag system used to roll out contract features
gradually (staged rollout) and to run A/B-style experiments without requiring a
contract upgrade.

## Overview

Feature flags are simple on/off switches stored directly in contract storage and
controlled by the admin. Because they live in storage rather than in the compiled
contract, the admin can enable or disable a feature at any time by submitting a
transaction — no redeploy or upgrade is required.

Flags are intended for *behavioral* toggles (e.g. "is the token allowlist
enforced?"). They are **not** a replacement for access control or for the
existing admin storage keys; they sit on top of them and gate specific code
paths.

## Storage Key Scheme

Each flag is stored under a dedicated contract storage key:

```rust
FeatureFlag(String)
```

- The `String` payload is the flag name (e.g. `"subscriptions_enabled"`).
- The stored value is a `bool` (`true` = enabled, `false` = disabled).
- Flag names are lowercase `snake_case` and are treated as a stable public API.
  Renaming a flag is a breaking change.

Because the key is namespaced by `FeatureFlag`, flags cannot collide with other
contract storage entries.

## API

### `set_feature_flag(env, name, enabled)`

Enables or disables a flag. **Admin only.**

```rust
pub fn set_feature_flag(env: Env, name: String, enabled: bool)
```

- Requires the caller to be the contract admin; otherwise the call panics with
  an authorization error.
- Creates the flag if it does not exist, or overwrites its current value.
- Emits an event so off-chain indexers can track flag changes.

### `get_feature_flag(env, name)`

Reads the current state of a flag.

```rust
pub fn get_feature_flag(env: Env, name: String) -> bool
```

- Returns the stored value if the flag has been set.
- Returns the flag's **default** if it has never been set (see below).
- Unknown flag names return `false` (fail-closed).

### Gating a code path

Feature-gated logic should read the flag through a small helper so the default
behavior is consistent everywhere:

```rust
fn is_feature_enabled(env: &Env, name: &str) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::FeatureFlag(name.into()))
        .unwrap_or_else(|| default_for(name))
}
```

## Current Flags

| Flag name                   | Default | Gates                                                        |
| --------------------------- | ------- | ------------------------------------------------------------ |
| `subscriptions_enabled`     | `false` | Subscription payment flows (create/renew/cancel).             |
| `token_allowlist_enforced`  | `false` | Whether token transfers must use an allowlisted token.       |

Defaults are chosen to be **fail-closed**: a freshly deployed contract has the
newer features disabled until the admin explicitly turns them on.

> Note: the defaults above describe the behavior when a flag has never been
> written. If a flag has been explicitly set (even to `false`), the stored value
> wins.

## Staged Rollout Guidance

1. **Deploy with flags off.** Ship the code with the new feature's flag
   defaulting to `false`. Existing behavior is unchanged.
2. **Enable for a canary.** Turn the flag on and monitor events, error rates,
   and any off-chain metrics. Because the flag is a single global switch, a
   canary is typically a short observation window rather than a per-account
   rollout.
3. **Roll back instantly if needed.** If something goes wrong, the admin calls
   `set_feature_flag(name, false)`. No upgrade is required.
4. **Retire the flag.** Once the feature is stable and universally enabled,
   remove the flag check in a future contract version and delete the storage
   entry.

## A/B Testing Guidance

- Use distinct flag names per experiment (e.g. `experiment_pricing_v2`) so
  experiments do not interfere with production flags.
- Keep experiments short-lived and document their start/end in this file.
- Because flags are global, A/B testing here means "run variant A for a period,
  then variant B" rather than simultaneous per-user bucketing. For per-user
  bucketing, derive the bucket off-chain and pass it in, or add a dedicated
  storage-backed cohort mechanism.
- Always leave a safe default (`false`) so an unset flag never enables an
  experimental path.

## Operational Notes

- Only the admin can change flags. Treat the admin key with the same care as any
  other privileged operation.
- Flag changes emit events; index these to reconstruct flag history.
- When adding a new flag, update the table above and add tests covering both the
  enabled and disabled code paths.