# Merchant Registration Anti-Spam Mechanism

Addresses: [SEC-003] — No rate limiting on merchant registration.

## Problem

Without a guard, any account can call `register_merchant` an unlimited number
of times (from different addresses), spamming contract storage and inflating
the merchant index at minimal cost relative to the damage caused.

## Chosen mechanism: admin-whitelist mode

The contract implements an **admin-controlled whitelist** that gates merchant
registration behind explicit admin pre-approval. This is the recommended
approach for production deployments.

### How it works

1. An admin enables whitelist mode by calling `set_whitelist_mode(admins, true)`.
2. Before a merchant can register, an admin must call
   `approve_merchant_registration(admins, merchant_address)`.
3. `register_merchant` checks `is_whitelist_enabled` and, if true, rejects the
   call with `Unauthorized` unless the address is already whitelisted.

### Enabling whitelist mode

```bash
# Enable whitelist mode (admin multi-sig required)
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source <ADMIN_KEY> \
  -- set_whitelist_mode \
  --admins '["<ADMIN_ADDRESS>"]' \
  --enabled true

# Pre-approve a merchant
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source <ADMIN_KEY> \
  -- approve_merchant_registration \
  --admins '["<ADMIN_ADDRESS>"]' \
  --merchant_address <MERCHANT_ADDRESS>
```

### Disabling whitelist mode (open registration)

Pass `enabled: false` to `set_whitelist_mode`. This allows any address to
register freely — suitable for testnets or permissionless deployments.

## Trade-offs

| Approach | Pros | Cons |
|---|---|---|
| Admin whitelist (implemented) | Zero on-chain cost for admins; full control over who registers | Requires admin action per merchant; centralised trust in admins |
| Minimum XLM deposit | Trustless; economic deterrent | Requires deposit/refund logic; complexity; XLM price volatility |

The whitelist approach was chosen for its simplicity, auditability, and zero
smart-contract complexity overhead. A deposit-based mechanism can be layered
on top in a future upgrade if open-registration with economic friction is
preferred.
