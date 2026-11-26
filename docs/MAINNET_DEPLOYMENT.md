# Stellar Mainnet Deployment Guide (MISC-015)

This guide covers deploying `payment-processing-contract` to the Stellar
**public network (mainnet / pubnet)**. The main [README](../README.md)
documents local and testnet deployment only; mainnet carries real-value risk
(misconfigured admin keys, a missed initialisation step, or an unaudited
network setting can lock or drain funds), so it gets its own checklist.

Read this guide fully before running any command against `--network public`.
None of the steps here are reversible once funds start moving through the
contract.

## Pre-deployment security checklist

Work through this list before touching mainnet. Do not skip items because
"it worked on testnet."

- [ ] **Security audit / review completed.** See
      [`docs/security-audit.md`](security-audit.md) for the project's audit
      status; do not deploy unaudited changes straight to mainnet.
- [ ] **CI is green on the exact commit being deployed**, including the WASM
      size gate (`cargo build --release` artifact under 100 KB — see
      [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)) and
      `cargo audit` / `cargo deny`.
- [ ] **Admin key(s) generated on hardware the deploying operator controls**,
      never reused from testnet or from any other project. See
      [Key generation](#1-key-generation) below.
- [ ] **Admin multi-sig threshold decided in advance.** `set_admin` takes a
      list of admin addresses and a `threshold`; decide how many of how many
      signers are required for admin actions (`set_whitelist_mode`,
      `set_token_allowlist_mode`, `set_merchant_tier`, pause/unpause, etc.)
      *before* calling it — it can only be called once per contract instance
      (`PaymentError::AdminAlreadySet` thereafter).
- [ ] **Secret keys stored in a secrets manager or hardware wallet**, not in
      shell history, `.env` files committed to git, or CI logs. If you must
      use a CI secret (as `deploy-testnet` does for testnet, via
      `TESTNET_SECRET_KEY`), scope it to a dedicated mainnet deployment key
      with no other privileges and rotate it after use if possible.
- [ ] **Funding account amount sized for real base reserves**, not the
      Friendbot-funded 10,000 XLM used on testnet — see
      [Account funding](#2-account-funding).
- [ ] **Token allowlist / merchant whitelist mode decided.** Decide, before
      going live, whether `set_token_allowlist_mode` and
      `set_whitelist_mode` should be enabled on mainnet (recommended for a
      production deployment — see the inline docs on those functions in
      `src/lib.rs`), and prepare the `add_allowed_token` /
      `approve_merchant_registration` calls you'll need right after
      `set_admin`.
- [ ] **Rollback / pause plan.** Confirm who holds the keys needed to call
      the contract's pause functionality and under what conditions it would
      be used, before an incident — not during one.
- [ ] **Contract ID and WASM hash recorded somewhere outside your terminal**
      (e.g. a runbook, a password manager note, or the release's
      `payment_processing_contract.wasm.sha256` artifact produced by the
      `release` CI job) immediately after deployment, per
      [Step 5](#5-verify).

## Step-by-step deployment

### 1. Key generation

Generate a dedicated mainnet deployer key. Do not reuse a testnet key.

```bash
stellar keys generate --global mainnet-deployer --network public
stellar keys address mainnet-deployer   # public key (G...) — safe to share
stellar keys show mainnet-deployer      # secret key (S...) — NEVER share or commit this
```

Treat the secret key as you would a production database password: store it
in a secrets manager (1Password, Vault, AWS Secrets Manager, etc.) or on a
hardware signer, not in a plaintext file.

Separately, generate (or designate) the address(es) that will become the
contract's admin(s) via `set_admin`. These may be the same key as the
deployer or, for a multi-sig setup, a distinct set of addresses held by
different people/devices.

### 2. Account funding

Unlike testnet, there is no Friendbot on mainnet. Fund the deployer account
with real XLM from an exchange, an existing wallet, or a liquidity provider.

At minimum, the account needs:
- The [base reserve](https://developers.stellar.org/docs/learn/fundamentals/lumens#base-reserves)
  for the account itself (currently 1 XLM per reserve unit — check current
  network parameters, as these can change).
- Enough XLM to cover the resource fees for the contract deployment and
  initial admin/configuration transactions (deployment of a ~90 KB WASM
  payload is more expensive than invoking an already-deployed contract;
  budget several XLM to be safe, and check current fees via
  `stellar network` tooling or Stellar Laboratory before sending funds).

Verify the funded balance before continuing:

```bash
stellar keys address mainnet-deployer
# then check the balance for that address with your preferred
# Horizon/RPC query or a block explorer (e.g. stellar.expert)
```

### 3. WASM upload / contract deployment

Build the release WASM exactly as CI does, so the deployed bytecode matches
what was audited and size-checked:

```bash
cargo build --target wasm32-unknown-unknown --release --locked
```

(Optional but recommended) verify this matches a CI-built artifact — compare
against the `payment_processing_contract.wasm.sha256` checksum published by
the `release` job in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)
for the tag you are deploying, or follow
[`docs/reproducible-builds.md`](reproducible-builds.md) to rebuild
byte-for-byte and compare hashes yourself.

Deploy to the public network:

```bash
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/payment_processing_contract.wasm \
  --source-account mainnet-deployer \
  --network public
```

This prints a contract address starting with `C`. Save it immediately:

```bash
export CONTRACT_ID="<address printed above>"
```

### 4. Initialise

The contract has no owner until `set_admin` is called — do this
**immediately** after deployment, before any other party could race you to
it (anyone can call `set_admin` on an un-initialised contract instance, and
it can only be called once).

```bash
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source-account mainnet-deployer \
  --network public \
  -- set_admin \
  --admins '["<ADMIN_ADDRESS_1>","<ADMIN_ADDRESS_2>"]' \
  --threshold 2
```

Adjust `--admins` / `--threshold` to match the multi-sig policy you decided
on in the [pre-deployment checklist](#pre-deployment-security-checklist). A
single-admin deployment is `--admins '["<ADMIN_ADDRESS>"]' --threshold 1`,
but a production deployment handling real funds should use more than one
independent signer.

Immediately follow up with whatever allowlist/whitelist configuration you
decided on, for example:

```bash
stellar contract invoke --id "$CONTRACT_ID" --source-account mainnet-deployer \
  --network public -- set_token_allowlist_mode \
  --admins '["<ADMIN_ADDRESS_1>","<ADMIN_ADDRESS_2>"]' --enabled true

stellar contract invoke --id "$CONTRACT_ID" --source-account mainnet-deployer \
  --network public -- add_allowed_token \
  --admins '["<ADMIN_ADDRESS_1>","<ADMIN_ADDRESS_2>"]' --token "<TOKEN_CONTRACT_ADDRESS>"
```

### 5. Verify

After initialisation, confirm the contract is in the expected state before
announcing it or routing any real payment traffic to it:

```bash
# Confirm the version/admin state is as expected
stellar contract invoke --id "$CONTRACT_ID" --source-account mainnet-deployer \
  --network public -- get_version

# Confirm the token allowlist state, if you enabled it
stellar contract invoke --id "$CONTRACT_ID" --source-account mainnet-deployer \
  --network public -- is_token_allowed --token "<TOKEN_CONTRACT_ADDRESS>"
```

Record, outside your terminal history:
- The contract ID (`$CONTRACT_ID`).
- The exact git commit/tag deployed and its WASM SHA-256 (from the `release`
  CI job, or computed locally with `sha256sum`).
- The admin address(es) and threshold configured.
- The date/time and operator who performed the deployment.

Only after this verification step should the mainnet contract ID be shared
with downstream integrators or put in front of real payment volume.

## Off-chain service Docker images

Each release tag publishes pre-built Docker images for the off-chain
services (`indexer`, `webhook`, and `analytics-service`) to the GitHub
Container Registry (ghcr.io). You do not need to clone the repository or
build from source to self-host them — pull the image matching the release
you are running against:

```bash
# Replace <org>/<repo> with the GitHub owner/repository and <version> with
# the release semver tag (e.g. v1.2.3). The `latest` tag tracks the most
# recent release.
docker pull ghcr.io/<org>/<repo>/indexer:<version>
docker pull ghcr.io/<org>/<repo>/webhook:<version>
docker pull ghcr.io/<org>/<repo>/analytics-service:<version>
```

Images are tagged with both the release semver tag and `latest`. For
production, always pin an explicit semver tag rather than `latest` so that
redeploys are reproducible and rollbacks are a tag change away.

If the packages are private, authenticate first with a GitHub token that has
`read:packages` scope:

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u <github-username> --password-stdin
```

### Production `docker-compose.override.yml`

The repository ships a base `docker-compose.yml` for local development. For
production, layer a `docker-compose.override.yml` next to it that swaps the
locally built services for the published images, pins the release tag, and
sets production environment variables and port mappings. Compose merges the
override automatically when you run `docker compose up` from the same
directory.

```yaml
# docker-compose.override.yml — production overrides
services:
  indexer:
    image: ghcr.io/<org>/<repo>/indexer:${RELEASE_TAG:?set RELEASE_TAG to the release semver}
    build: !reset null
    restart: unless-stopped
    environment:
      RUST_LOG: info
      DATABASE_URL: ${DATABASE_URL:?set DATABASE_URL}
      STELLAR_RPC_URL: ${STELLAR_RPC_URL:-https://mainnet.sorobanrpc.com}
      STELLAR_NETWORK: public
      CONTRACT_ID: ${CONTRACT_ID:?set CONTRACT_ID to the deployed contract address}
      START_LEDGER: ${START_LEDGER:-0}
    ports:
      - "8081:8081"
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://localhost:8081/health"]
      interval: 30s
      timeout: 5s
      retries: 3

  webhook:
    image: ghcr.io/<org>/<repo>/webhook:${RELEASE_TAG:?set RELEASE_TAG to the release semver}
    build: !reset null
    restart: unless-stopped
    environment:
      RUST_LOG: info
      DATABASE_URL: ${DATABASE_URL:?set DATABASE_URL}
      WEBHOOK_SIGNING_SECRET: ${WEBHOOK_SIGNING_SECRET:?set WEBHOOK_SIGNING_SECRET}
      WEBHOOK_MAX_RETRIES: ${WEBHOOK_MAX_RETRIES:-5}
    ports:
      - "8082:8082"
    depends_on:
      - indexer
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://localhost:8082/health"]
      interval: 30s
      timeout: 5s
      retries: 3

  analytics-service:
    image: ghcr.io/<org>/<repo>/analytics-service:${RELEASE_TAG:?set RELEASE_TAG to the release semver}
    build: !reset null
    restart: unless-stopped
    environment:
      RUST_LOG: info
      DATABASE_URL: ${DATABASE_URL:?set DATABASE_URL}
      ANALYTICS_PORT: "8083"
    ports:
      - "8083:8083"
    depends_on:
      - indexer
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://localhost:8083/health"]
      interval: 30s
      timeout: 5s
      retries: 3
```

Set the required values in a `.env` file next to the compose files (never
commit it), then start the stack:

```bash
cat > .env <<'EOF'
RELEASE_TAG=v1.2.3
CONTRACT_ID=C...
DATABASE_URL=postgres://user:pass@db:5432/payments
WEBHOOK_SIGNING_SECRET=change-me
EOF

docker compose pull
docker compose up -d
```

Notes for production:
- The `build: !reset null` lines disable the base file's local build context
  so Compose only ever pulls the pinned image. If your Compose version does
  not support `!reset`, remove the `build:` keys from the base file or run
  with `--no-build`.
- The `${VAR:?message}` syntax makes Compose fail fast if a required value
  is missing, rather than starting a service with an empty secret.
- Port mappings above are the services' defaults; adjust them to match your
  reverse proxy / load balancer layout. Do not expose these ports directly
  to the public internet — terminate TLS at a proxy in front of them.
- To roll back, change `RELEASE_TAG` to the previous release and re-run
  `docker compose pull && docker compose up -d`.

## See also

- [`README.md`](../README.md) — local/testnet setup, environment seeding,
  general contract usage.
- [`docs/reproducible-builds.md`](reproducible-builds.md) — rebuilding the
  WASM byte-for-byte to verify what was deployed.
- [`docs/security-audit.md`](security-audit.md) — audit status and scope.
- [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) — the
  `deploy-testnet` job this guide's mainnet flow mirrors (testnet deploys
  are automated in CI; mainnet deploys are intentionally manual and
  checklist-gated).
