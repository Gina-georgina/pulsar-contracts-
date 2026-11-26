# Secret Rotation Procedure

This document describes how to rotate every secret used by this project, who owns each secret, where it is stored, and how often it should be rotated.

Rotation is a routine security hygiene task. Treat it as a normal, low-drama operation: generate the new value, update every consumer, verify, then retire the old value.

---

## 1. Secret Inventory

| Secret | Owner | Storage location | Consumers | Notes |
| --- | --- | --- | --- | --- |
| `TESTNET_SECRET_KEY` | DevOps / Release lead | GitHub Actions secret (repo or environment scope) | `.github/workflows/ci.yml` (testnet deploy job) | Stellar secret key (`S...`) for the testnet deployer account. Used to sign testnet deploy transactions in CI. |
| `MAINNET_DEPLOYER_SECRET_KEY` | Release lead + one backup maintainer | GitHub Actions **environment** secret (`mainnet` environment, required reviewers) | Mainnet deploy workflow | Stellar secret key (`S...`) for the mainnet deployer account. Highest-value secret in the repo. |
| `MAINNET_DEPLOYER_PUBLIC_KEY` | Release lead | GitHub Actions environment variable (not a secret) | Mainnet deploy workflow | Public key (`G...`) of the mainnet deployer. Kept in sync with the secret above. |
| `TESTNET_DEPLOYER_PUBLIC_KEY` | DevOps | GitHub Actions variable (not a secret) | `.github/workflows/ci.yml` | Public key (`G...`) of the testnet deployer. Kept in sync with `TESTNET_SECRET_KEY`. |
| `SOROBAN_RPC_URL` / `STELLAR_RPC_URL` | DevOps | GitHub Actions variable; local `.env` | CI workflows, local scripts | Not secret in the strict sense, but may embed provider API keys in the URL. Rotate the provider key if the URL is leaked. |
| Local `.env` keys | Individual developer | Developer machine `.env` (git-ignored) | Local scripts, `make` targets, integration tests | Each developer uses their own throwaway testnet keypair. Never commit `.env`. |
| Other CI secrets (e.g. `CODECOV_TOKEN`, package registry tokens) | DevOps | GitHub Actions secrets | CI workflows | Rotate per the provider's guidance; follow the same GitHub Secrets procedure below. |

> **Rule of thumb:** if a value can sign a transaction on mainnet, it lives only in a protected GitHub environment with required reviewers, and at most two people can read it.

---

## 2. Rotating a GitHub Actions Secret

Applies to `TESTNET_SECRET_KEY`, `MAINNET_DEPLOYER_SECRET_KEY`, and any other CI secret.

### 2.1 Generate the new keypair

For Stellar keys, generate a fresh keypair locally (never in CI logs):

```bash
# Using the Stellar CLI
stellar keys generate deployer-$(date +%Y%m) --network testnet
stellar keys address deployer-$(date +%Y%m)   # prints the G... public key
stellar keys show   deployer-$(date +%Y%m)   # prints the S... secret key
```

Or with any offline keypair generator. Store the secret key in a password manager entry owned by the secret owner — **do not** paste it into chat, tickets, or commit messages.

### 2.2 Fund and verify the new account

- **Testnet:** fund the new account with Friendbot:
  ```bash
  curl "https://friendbot.stellar.org?addr=<NEW_G_ADDRESS>"
  ```
  Confirm the balance with `stellar account show <NEW_G_ADDRESS> --network testnet`.
- **Mainnet:** transfer a small operating balance (enough for contract deploys and admin operations) from the old deployer to the new one. Confirm the balance on a block explorer before proceeding.

### 2.3 Update the secret in GitHub

1. Go to **Settings → Secrets and variables → Actions**.
2. For `MAINNET_DEPLOYER_SECRET_KEY`, select the **`mainnet` environment** first (environment secrets are scoped separately from repository secrets).
3. Click **Update** next to the secret and paste the new value.
4. Update the matching public-key variable (`TESTNET_DEPLOYER_PUBLIC_KEY` / `MAINNET_DEPLOYER_PUBLIC_KEY`) in the **Variables** tab so it matches the new keypair.
5. Save. GitHub does not display secret values after saving — verify by re-running the workflow, not by reading the value back.

### 2.4 Re-run the deploy workflow to confirm

- **Testnet:** trigger the testnet deploy job in `.github/workflows/ci.yml` (push to the deploy branch, or use **Actions → Run workflow**). Confirm the job succeeds and the deploy transaction is signed by the new key.
- **Mainnet:** run the mainnet deploy workflow through its required-reviewer gate. Confirm the transaction is signed by the new deployer and the contract state is as expected.

If the workflow fails with an authentication/signature error, the secret was not updated correctly — fix it before retiring the old key.

### 2.5 Revoke / retire the old key

Only after the new key is verified working:

- **Testnet:** the old account can simply be abandoned. Optionally merge its remaining balance into the new account:
  ```bash
  stellar tx new account-merge --source <OLD_S_ADDRESS> --destination <NEW_G_ADDRESS> --network testnet
  ```
- **Mainnet:** if the old key was the contract admin, complete the admin transfer (see §4) **before** draining the old account. Then merge any remaining balance into the new deployer.
- Delete the old secret value from the password manager entry (or mark it "retired — do not use") and record the rotation date in the team's rotation log.

---

## 3. Rotating Local `.env` Values

Each developer's `.env` holds their own testnet keypair and local configuration. It is **never** committed (it is git-ignored).

1. Generate a fresh testnet keypair (§2.1) or a fresh provider API key.
2. Update the value in your local `.env`:
   ```dotenv
   TESTNET_SECRET_KEY=S...
   TESTNET_DEPLOYER_PUBLIC_KEY=G...
   ```
3. **Never commit `.env`.** Confirm with `git status` that it is untracked. If it was ever committed, treat it as compromised and follow §6.
4. Notify the team in the usual channel that you rotated your local key (no need to share the value).
5. Invalidate the old value: fund-merge or abandon the old testnet account, and revoke any old provider API key in the provider's dashboard.

If a shared `.env` value (e.g. a team-wide RPC provider key) is rotated, the person rotating it updates the value in the shared password manager entry and tells everyone to pull the new value.

---

## 4. Rotating Testnet and Mainnet Keys

Stellar keys are asymmetric: rotating a key means creating a new keypair, moving the on-chain role to it, and then retiring the old one. The contract's admin role is the critical piece.

### 4.1 Testnet

1. Generate and fund a new testnet keypair (§2.1–2.2).
2. If the old key is the contract admin, transfer admin to the new key using the contract's two-step admin transfer:
   - **Step 1 — old admin proposes the new admin:**
     ```bash
     stellar contract invoke \
       --id <CONTRACT_ID> --source <OLD_S_ADDRESS> --network testnet \
       -- transfer_admin --new_admin <NEW_G_ADDRESS>
     ```
   - **Step 2 — new admin accepts:**
     ```bash
     stellar contract invoke \
       --id <CONTRACT_ID> --source <NEW_S_ADDRESS> --network testnet \
       -- accept_admin
     ```
   - Verify the admin changed (e.g. query the contract's admin getter or check the emitted event).
3. Update `TESTNET_SECRET_KEY` and `TESTNET_DEPLOYER_PUBLIC_KEY` in GitHub (§2.3) and re-run the testnet deploy job (§2.4).
4. Retire the old key (§2.5).

### 4.2 Mainnet

Mainnet rotation requires **two maintainers**: the release lead and the backup maintainer. Do not perform it alone.

1. Generate a new mainnet keypair offline. Store the secret key in the password manager entry shared by the two maintainers.
2. Fund the new deployer account from the old one (§2.2).
3. Transfer the contract admin using the same two-step flow as §4.1, but with `--network mainnet` and the mainnet `CONTRACT_ID`. The old admin proposes, the new admin accepts. **Do not skip the accept step** — until it is accepted, the old key remains admin.
4. Verify the admin change on a block explorer and via the contract's admin getter.
5. Update `MAINNET_DEPLOYER_SECRET_KEY` and `MAINNET_DEPLOYER_PUBLIC_KEY` in the `mainnet` GitHub environment (§2.3), then run the mainnet deploy workflow through its reviewer gate (§2.4).
6. Only after the new key is verified: merge the old deployer's remaining balance into the new deployer and retire the old key (§2.5).
7. Record the rotation in the rotation log with both maintainers' names and the date.

---

## 5. Recommended Rotation Schedule

| Trigger | Action |
| --- | --- |
| **Annually** (calendar reminder set by the release lead) | Rotate all CI secrets and the mainnet deployer key. Testnet keys may be rotated at the same time. |
| **Team member offboarding** | Immediately rotate every secret the departing member could read: `TESTNET_SECRET_KEY`, `MAINNET_DEPLOYER_SECRET_KEY`, and any shared `.env` values. Revoke their GitHub access first, then rotate. |
| **Role change** (e.g. someone gains or loses release/maintainer duties) | Rotate the secrets tied to the role they are leaving. |
| **Suspected compromise** | Rotate immediately — do not wait for the schedule. Follow §6. |
| **Provider-mandated** | Follow the provider's guidance for third-party tokens (e.g. `CODECOV_TOKEN`). |

Set a recurring calendar reminder for the annual rotation and assign it to the release lead.

---

## 6. Incident Checklist — Suspected Compromise

If a secret may have leaked (committed to git, pasted in chat, exposed in logs, lost device, departing member, etc.):

- [ ] **Assume compromise.** Do not wait to confirm — start rotating.
- [ ] **Contain:** revoke the leaked value at the source (GitHub secret, provider dashboard, or on-chain via admin transfer).
- [ ] **Rotate** the affected secret following §2 (CI), §3 (local), or §4 (on-chain keys).
- [ ] **Check for unauthorized activity:** review recent transactions on the affected account and contract events on a block explorer. Note anything unexpected.
- [ ] **Purge history if committed:** if a secret was committed, remove it from git history (e.g. `git filter-repo`) and force-push, then rotate — history rewriting alone does not un-leak a value.
- [ ] **Notify:** inform the maintainers and, for mainnet incidents, the project owners. Do not post the leaked value in the notification.
- [ ] **Record:** add an entry to the rotation log with the date, the secret affected, how it was discovered, and the actions taken.
- [ ] **Review:** after the incident, update this document if the procedure missed a step.

---

## References

- `.github/workflows/ci.yml` — uses `TESTNET_SECRET_KEY` for the testnet deploy job.
- GitHub docs: *Encrypted secrets* and *Using environments for deployment*.
- Stellar docs: *Keypair generation*, *Account merge*, and the contract's admin transfer interface.