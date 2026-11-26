# Incident Runbook: Emergency Contract Pause

## 1. Purpose and Scope

This runbook describes the procedure for responding to a security or operational incident affecting the contract by using its emergency pause mechanism.

The contract exposes a `Paused` storage key and a `ContractPaused` error. When the `Paused` key is set to `true`, all privileged/state-changing operations (e.g. refunds, disbursements, admin mutations) are rejected with `ContractPaused`. Read-only queries remain available unless otherwise noted.

**Scope:**
- Applies to the deployed contract on **testnet** and **mainnet**.
- Covers: when to pause, how to pause, how to verify the pause, how to unpause, user communication, and post-incident follow-up.
- Does **not** cover: key rotation, contract upgrades, or fund recovery procedures (see the respective runbooks).

**Audience:** On-call engineers, contract admins, security responders, and communications leads.

---

## 2. Pre-conditions for Triggering Pause

Pause is a high-impact action. Only trigger it when **at least one** of the following is confirmed or strongly suspected. When in doubt, pause first and investigate after — pausing is reversible; an exploit draining funds is not.

| # | Condition | Examples / Signals |
|---|-----------|--------------------|
| 1 | **Critical exploit or vulnerability** | Unauthorized withdrawals, reentrancy, integer overflow, signature bypass, unexpected balance changes, anomalous contract invocations. |
| 2 | **Abnormal refund rate** | Refund volume or value spikes far beyond baseline (e.g. >10x normal within a short window), suggesting a logic bug or abuse. |
| 3 | **Unauthorized admin activity** | Unexpected admin key usage, admin key compromise suspicion, unexpected config changes, or unknown signers. |
| 4 | **Dependency / oracle failure** | A critical external dependency (price feed, oracle, token contract) is compromised or returning invalid data that affects contract safety. |
| 5 | **Active incident in progress** | A live attack or ongoing anomalous behavior where halting state changes limits damage. |

**Authority:** Pause may be initiated by any on-call engineer or admin with pause authority. **Notify the incident commander and security lead immediately** (in parallel with pausing — do not wait for approval if an active exploit is underway).

---

## 3. Pause Procedure

### 3.1 Prerequisites

- Access to the admin key/identity authorized to call the pause function.
- The deployed **contract ID** for the target network.
- The correct **network passphrase**:
  - Testnet: `Test SDF Network ; September 2015`
  - Mainnet: `Public Global Stellar Network ; September 2015`
- Soroban/Stellar CLI installed and configured (`stellar` CLI).

Set environment variables to avoid mistakes:

```bash
# --- TESTNET ---
export NETWORK="testnet"
export NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
export CONTRACT_ID="<TESTNET_CONTRACT_ID>"
export ADMIN_IDENTITY="<ADMIN_IDENTITY_ALIAS>"

# --- MAINNET ---
export NETWORK="mainnet"
export NETWORK_PASSPHRASE="Public Global Stellar Network ; September 2015"
export CONTRACT_ID="<MAINNET_CONTRACT_ID>"
export ADMIN_IDENTITY="<ADMIN_IDENTITY_ALIAS>"
```

> ⚠️ Double-check `NETWORK`, `NETWORK_PASSPHRASE`, and `CONTRACT_ID` before invoking. A pause on the wrong network or contract has no effect on the incident.

### 3.2 Invoke the pause function

The contract exposes an admin-gated pause entry point (e.g. `pause`). Invoke it with the admin identity:

```bash
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --network "$NETWORK" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  --source "$ADMIN_IDENTITY" \
  -- \
  pause
```

**Testnet example:**

```bash
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --network testnet \
  --network-passphrase "Test SDF Network ; September 2015" \
  --source "$ADMIN_IDENTITY" \
  -- \
  pause
```

**Mainnet example:**

```bash
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --network mainnet \
  --network-passphrase "Public Global Stellar Network ; September 2015" \
  --source "$ADMIN_IDENTITY" \
  -- \
  pause
```

A successful invocation returns without error. Proceed immediately to **Section 4 (Verification)**.

### 3.3 If the pause call fails

- **Authorization error:** Confirm `--source` is the authorized admin identity and that the key is available.
- **Already paused:** If the contract returns an error indicating it is already paused, treat as success and proceed to verification.
- **Transaction failure / timeout:** Re-submit. If repeated failures occur, escalate to the incident commander and security lead; consider whether the admin key is compromised (see pre-condition #3).

---

## 4. Verification

Confirm the pause took effect before communicating status.

### 4.1 Confirm the `Paused` storage key is set

Query the contract state (e.g. an `is_paused` / `paused` view function, or read the `Paused` storage entry):

```bash
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --network "$NETWORK" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  --source "$ADMIN_IDENTITY" \
  -- \
  is_paused
```

Expected result: `true`.

### 4.2 Confirm privileged operations return `ContractPaused`

Attempt a representative privileged operation (e.g. a refund or admin mutation) against the paused contract. It **must** fail with the `ContractPaused` error. Use a dry-run/simulation where possible to avoid side effects:

```bash
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --network "$NETWORK" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  --source "$ADMIN_IDENTITY" \
  -- \
  <privileged_function> <args>
```

Expected result: transaction fails with `ContractPaused` (error code as defined in the contract). If the operation succeeds, **the pause did not take effect** — re-run Section 3 and escalate.

### 4.3 Record verification

Log the following in the incident channel:
- Timestamp of pause.
- Transaction hash of the pause invocation.
- Output of the `is_paused` check (`true`).
- Output of the `ContractPaused` check.

---

## 5. Unpause Procedure

Only unpause after the root cause is understood and remediated (or a documented decision is made by the incident commander and security lead).

### 5.1 Invoke the unpause function

```bash
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --network "$NETWORK" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  --source "$ADMIN_IDENTITY" \
  -- \
  unpause
```

**Testnet example:**

```bash
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --network testnet \
  --network-passphrase "Test SDF Network ; September 2015" \
  --source "$ADMIN_IDENTITY" \
  -- \
  unpause
```

**Mainnet example:**

```bash
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --network mainnet \
  --network-passphrase "Public Global Stellar Network ; September 2015" \
  --source "$ADMIN_IDENTITY" \
  -- \
  unpause
```

### 5.2 Verify unpause

- Confirm `is_paused` returns `false`.
- Confirm a representative privileged operation now succeeds (or behaves as expected).
- Monitor for recurrence of the original anomaly for at least 24 hours.

---

## 6. User Communication

### 6.1 Channels

- **Status page** (primary, always updated first).
- **Official social channels** (X/Twitter, Discord, Telegram).
- **Email** to affected users (if applicable).
- **In-app banner** (if the frontend supports it).

### 6.2 Timing

- **Within 15 minutes of confirmed pause:** Post an initial holding statement on the status page and social channels.
- **Every 60 minutes** while paused: Post an update, even if there is no new information.
- **On unpause:** Post a resolution notice and summary.

### 6.3 Templates

**Initial notice (pause):**

> ⚠️ We have temporarily paused [Contract/Product] as a precautionary measure while we investigate an issue. No action is required from users at this time. We will provide updates every 60 minutes. Follow this status page for the latest information.

**Update (in progress):**

> Update [HH:MM UTC]: [Contract/Product] remains paused while we continue our investigation. [Brief status]. Next update by [HH:MM UTC].

**Resolution (unpause):**

> ✅ [Contract/Product] has been unpaused and is operating normally. We identified [brief cause] and have [remediation]. A full post-incident report will follow. Thank you for your patience.

### 6.4 Guidance

- Do **not** speculate on cause, impact, or fund safety until confirmed by the security lead.
- Do **not** disclose exploit details that could enable further attacks.
- Always state clearly whether user funds are affected (only if confirmed).
- Coordinate all messaging with the incident commander.

---

## 7. Post-Incident Checklist

Complete within **5 business days** of resolution.

- [ ] **Audit log review**
  - [ ] Export and review on-chain transaction history for the incident window.
  - [ ] Review admin key usage and access logs.
  - [ ] Confirm no unauthorized state changes occurred during the pause.
  - [ ] Preserve logs and artifacts for the post-mortem.
- [ ] **User communication follow-up**
  - [ ] Publish a final resolution notice on all channels.
  - [ ] Publish a public post-incident summary (if appropriate).
  - [ ] Respond to outstanding user questions/support tickets.
- [ ] **Root cause analysis**
  - [ ] Write a post-mortem document (timeline, root cause, impact, detection, response).
  - [ ] Identify contributing factors and detection gaps.
  - [ ] Define remediation action items with owners and due dates.
  - [ ] Update this runbook and related docs based on lessons learned.
  - [ ] Schedule a review meeting with engineering, security, and comms.

---

## 8. References

- Security audit documentation: see `docs/SECURITY_AUDIT.md` (this runbook is linked from there).
- Contract error definitions: `ContractPaused` error and `Paused` storage key.
- Stellar CLI documentation: <https://developers.stellar.org/docs/tools/developer-tools/cli/stellar-cli>