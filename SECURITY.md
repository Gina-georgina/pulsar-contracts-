# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | ✅        |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

There are two supported reporting channels. The GitHub private security
advisory system is preferred because it provides a structured, auditable
workflow; email is available as a fallback for reporters who cannot use it.

### 1. GitHub private security advisory (preferred)

👉 **[Report a vulnerability](https://github.com/queenannaE/pulsar-contracts/security/advisories/new)**

This opens a private advisory on the `queenannaE/pulsar-contracts`
repository. Only the repository maintainers can see your report.

### 2. Email the maintainers directly

Send your report to **euniceoyiefieo@gmail.com** with the subject line
`[SECURITY] Pulsar — <short summary>`. Please encrypt sensitive details
with the maintainer's PGP key if you have it; otherwise plain email is fine.

### What to include

- A clear description of the vulnerability and its potential impact
- Steps to reproduce or a proof-of-concept
- Affected versions
- Any suggested mitigations (optional)

### Response SLA

| Milestone | Target |
|-----------|--------|
| Acknowledgement | Within **48 hours** of submission |
| Initial assessment | Within **5 business days** |
| Fix or mitigation | Within **90 days** (critical issues prioritised) |

We will keep you informed of progress throughout the process and credit you in the release notes unless you prefer to remain anonymous.

### Coordinated disclosure

We follow a coordinated disclosure model. Reporters are asked to give
maintainers a reasonable window (default 90 days, or until a fix is shipped —
whichever comes first) before publicly disclosing the issue. We will not
take action against good-faith security research that respects this window.

## Scope

This policy covers the smart contract code in this repository. Issues in third-party dependencies (e.g. `soroban-sdk`) should be reported to their respective maintainers.

The recognition program below covers the off-chain services in this repository as well — see [Bounty scope](#bounty-scope) for the full list of in-scope and out-of-scope targets.

## Rewards and Recognition

Pulsar does **not** currently run a paid bug bounty. Until a monetary program
exists (see [Future bug bounty program](#future-bug-bounty-program) below),
every valid report is rewarded with public recognition:

| Reward | What it means |
|---|---|
| **Release-notes credit** | Every valid report is credited by name (or handle) in the [CHANGELOG](CHANGELOG.md) entry and the GitHub Release notes for the version that ships the fix. |
| **Security Hall of Fame** | Reporters of valid Critical or High severity issues are listed in the [Hall of Fame](#security-hall-of-fame) below, with an optional link to a profile or website. |
| **Advisory credit** | Where a GitHub Security Advisory or CVE is published, the reporter is named in the advisory's credits section. |

Credit is opt-in: tell us in your report if you prefer to stay anonymous, and
we will omit your name everywhere while still shipping the fix.

### What counts as a valid report

A report qualifies for recognition when all of the following hold:

- It targets something listed under [Bounty scope](#bounty-scope).
- It was disclosed privately through one of the channels above and respected
  the [coordinated disclosure](#coordinated-disclosure) window.
- It describes a concrete security impact (loss or lock-up of funds,
  unauthorised state change, auth bypass, signature replay, data exposure) —
  not a theoretical or purely stylistic concern.
- It is the first report of that issue. Duplicates are acknowledged but only
  the first reporter is credited.

Reports that are rejected (out of scope, not reproducible, or no security
impact) still receive a written explanation of the decision.

### Bounty scope

The program covers both the on-chain contract and the off-chain services in
this repository:

| In scope | Path |
|---|---|
| Payment-processing smart contract | `contracts/payment-processing-contract/` |
| TypeScript SDK | `sdk/` |
| REST API wrapper | `api/` |
| Event indexer | `indexer/` |
| Monitoring and alerting service | `monitoring/` |
| Supporting off-chain services (analytics, cache, circuit breaker, data export, multisig, payments, webhooks) | `services/` |
| Merchant and payer web apps | `dashboard/`, `frontend/` |
| Deployment and CI configuration | `.github/workflows/`, `config/`, `scripts/` |

**Out of scope:**

- Third-party dependencies (e.g. `soroban-sdk`, npm packages) — report those
  to their own maintainers; tell us as well if Pulsar is exploitable through
  them.
- The Stellar network, Soroban host environment, or public RPC providers.
- Issues that require a compromised admin key, merchant key, or payer key —
  key custody is the operator's responsibility.
- Deployed third-party infrastructure not controlled by this repository.
- Denial of service via network-level traffic volume, spam transactions, or
  resource exhaustion that the Stellar fee model already prices in (see
  [Rate limiting](README.md#rate-limiting-and-spam-prevention)).
- Missing security headers, outdated-library notices, or automated scanner
  output with no demonstrated impact.
- Social engineering of maintainers or contributors.

### Future bug bounty program

A paid bounty program is planned **after** the independent mainnet audit
(SEC-001) completes and the contract is deployed to mainnet. The intent is to
list Pulsar on an established platform — [Immunefi](https://immunefi.com/)
(smart-contract focused) or [HackerOne](https://hackerone.com/) (broader
off-chain coverage) — with a severity-based reward table funded from the
project treasury.

| Milestone | Status |
|---|---|
| Independent security audit (SEC-001) | Pending — see [`docs/security-audit.md`](docs/security-audit.md) |
| Mainnet deployment | Pending |
| Bug bounty platform listing | Not started — blocked on the two milestones above |

This section will be updated with the platform, reward tiers, and program
rules once that work begins. Until then, the recognition rewards described
above are the full extent of the program.

### Security Hall of Fame

Researchers who have reported valid Critical or High severity vulnerabilities
in Pulsar:

| Researcher | Severity | Issue | Reported |
|---|---|---|---|
| — | — | — | — |

*No vulnerabilities have been reported yet. Be the first — see
[Reporting a Vulnerability](#reporting-a-vulnerability) above.*

---

## Mainnet Security Audit (SEC-001)

The Pulsar contract handles real token transfers. **An independent security audit by a recognised Soroban/Stellar smart contract auditor is required before any mainnet deployment.**

All Critical and High severity findings must be resolved before deployment. The full audit report will be published in [`docs/security-audit.md`](docs/security-audit.md) once completed.

See [`docs/security-audit.md`](docs/security-audit.md) for the full audit scope, recommended auditors, pre-audit checklist, and deployment gate criteria.
