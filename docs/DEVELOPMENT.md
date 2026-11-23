# Development Guide

This guide provides instructions for setting up a development environment and working with the Pulsar payment processing contract.

## Table of Contents

- [Quick Start](#quick-start)
- [Development Setup](#development-setup)
- [Building](#building)
- [Testing](#testing)
- [Local Network](#local-network)
- [Container Resource Limits](#container-resource-limits)
- [Environment Seeding](#environment-seeding)
- [Debugging](#debugging)
- [Common Tasks](#common-tasks)

## Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/devEunicee/pulsar-contracts.git
cd pulsar-contracts

# 2. Install prerequisites
rustup target add wasm32-unknown-unknown

# 3. Build the contract
cd contracts/payment-processing-contract
cargo build --target wasm32-unknown-unknown --release

# 4. Run tests
cargo test

# 5. Start local network
stellar network container start local

# 6. Deploy contract
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/payment_processing_contract.wasm \
  --source-account admin \
  --network local

# 7. Seed test environment
export CONTRACT_ID="<returned_contract_id>"
bash scripts/seed.sh config/local.toml
```

## Development Setup

### Prerequisites

- **Rust** (stable) — https://www.rust-lang.org/tools/install
- **Stellar CLI** — https://developers.stellar.org/docs/tools/stellar-cli
- **Docker Desktop** — https://www.docker.com/products/docker-desktop
- **Git** — https://git-scm.com/

### Installation

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Add WASM target
rustup target add wasm32-unknown-unknown

# Install Stellar CLI (macOS)
brew install stellar-cli

# Install Stellar CLI (Linux)
curl -L https://github.com/stellar/stellar-cli/releases/download/v21.0.0/stellar-cli-21.0.0-x86_64-unknown-linux-gnu.tar.gz | tar xz
sudo mv stellar /usr/local/bin/

# Verify installations
rustc --version
cargo --version
stellar --version
docker --version
```

## Building

### Build WASM

```bash
cd contracts/payment-processing-contract

# Debug build
cargo build --target wasm32-unknown-unknown

# Release build (optimized)
cargo build --target wasm32-unknown-unknown --release
```

### Build Output

- **Debug**: `target/wasm32-unknown-unknown/debug/payment_processing_contract.wasm`
- **Release**: `target/wasm32-unknown-unknown/release/payment_processing_contract.wasm`

## Testing

### Run All Tests

```bash
cd contracts/payment-processing-contract
cargo test
```

### Run Specific Test

```bash
cargo test test_register_merchant_success
```

### Run Tests with Output

```bash
cargo test -- --nocapture
```

### Run Tests in Parallel

```bash
cargo test -- --test-threads=4
```

### Generate Test Coverage

```bash
# Install tarpaulin
cargo install cargo-tarpaulin

# Generate coverage report
cargo tarpaulin --out Html --output-dir coverage
```

## Local Network

### Start Local Network

```bash
stellar network container start local
```

### Stop Local Network

```bash
stellar network container stop local
```

### Restart Local Network

```bash
stellar network container restart local
```

### View Local Network Logs

```bash
stellar network container logs local
```

## Container Resource Limits

Every service in `docker-compose.yml` declares `deploy.resources.limits` for both
memory and CPU. Without limits, a single misbehaving container — for example the
monitoring poll loop during an RPC error storm — can consume all available host
resources and starve its sibling containers (and the host itself).

### Default Limits

The defaults are intentionally conservative so the whole stack fits comfortably
on a developer laptop:

| Resource | Limit per service |
| -------- | ----------------- |
| Memory   | `256M`            |
| CPU      | `0.5`             |

```yaml
services:
  monitoring:
    # ...
    deploy:
      resources:
        limits:
          memory: 256M
          cpus: "0.5"
```

### Raising Limits

If a service legitimately needs more headroom (e.g. a large seeding run or a
debugger attached to a container), raise the limits in one of two ways.

**1. Edit `docker-compose.yml` directly** — change the `memory` / `cpus` values
under that service's `deploy.resources.limits` block.

**2. Use a `docker-compose.override.yml`** — preferred for local, uncommitted
tweaks. Compose automatically merges this file with `docker-compose.yml`:

```yaml
# docker-compose.override.yml
services:
  monitoring:
    deploy:
      resources:
        limits:
          memory: 512M
          cpus: "1.0"
```

### Verifying Limits

Confirm the merged configuration before starting the stack:

```bash
docker compose config
```

The output shows the effective `deploy.resources.limits` for each service. After
`docker compose up`, you can also check live usage with `docker stats`.

## Environment Seeding

### Seed Local Environment

```bash
# Set contract ID
export CONTRACT_ID="CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4"

# Run seeding script
bash scripts/seed.sh config/local.toml
```

### Seed Testnet Environment

```bash
export CONTRACT_ID="<testnet_contract_id>"
bash scripts/seed.sh config/testnet.toml
```

### Custom Seeding

Edit `config/local.toml` to customize:
- Number of merchants
- Number of payments
- Number of refunds
- Merchant categories
- Payment amounts

See [SEEDING_GUIDE.md](SEEDING_GUIDE.md) for detailed instructions.

## Debugging

### Enable Debug Logging

```bash
# Set Rust backtrace
export RUST_BACKTRACE=1

# Run tests with backtrace
cargo test -- --nocapture
```

### Inspect Contract State

```bash
# Query merchant
stellar contract invoke --id $CONTRACT_ID --source-account admin --network local \
  -- get_merchant --merchant_address <ADDRESS>

# Query payment
stellar contract invoke --id $CONTRACT_ID --source-account admin --network local \
  -- get_payment_by_id --caller <ADDRESS> --order_id "ORDER_001"

# Query global stats
stellar contract invoke --id $CONTRACT_ID --source-account admin --network local \
  -- get_global_payment_stats --admins '["<ADMIN_ADDRESS>"]' --date_start null --date_end null
```

### Check Contract Version

```bash
stellar contract invoke --id $CONTRACT_ID --source-account admin --network local \
  -- get_version
```

## Common Tasks

### Deploy Contract

```bash
# Build
cargo build --target wasm32-unknown-unknown --release

# Deploy to local network
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/payment_processing_contract.wasm \
  --source-account admin \
  --network local
```

### Initialize Admin

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source-account admin \
  --network local \
  -- set_admin \
  --admin <ADMIN_ADDRESS>
```

### Register Merchant

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source-account merchant \
  --network local \
  -- register_merchant \
  --merchant_address <MERCHANT_ADDRESS> \
  --name "My Store" \
  --description "Store description" \
  --contact_info "contact@store.com" \
  --category Retail \
  --signing_public_key null
```

### Process Payment

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source-account payer \
  --network local \
  -- process_payment_with_signature \
  --payer <PAYER_ADDRESS> \
  --order '{"order_id":"ORDER_001","merchant_address":"<MERCHANT>","payer":"<PAYER>","token":"<TOKEN>","amount":1000,"description":"Test","expires_at":0}' \
  --signature <64_BYTE_HEX> \
  --merchant_public_key <32_BYTE_HEX>
```

### Query Merchant Stats

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source-account merchant \
  --network local \
  -- get_merchant_stats \
  --merchant <MERCHANT_ADDRESS> \
  --date_start null \
  --date_end null
```

## Code Standards

- **Formatting**: `cargo fmt`
- **Linting**: `cargo clippy -- -D warnings`
- **License headers**: All `.rs` files must start with `// SPDX-License-Identifier: MIT`
- **Tests**: Every new function must have at least one unit test
- **No unsafe**: Do not use `unsafe` blocks
- **No std**: Keep `#![no_std]` for contract crate

## Useful Resources

- [Soroban Documentation](https://developers.stellar.org/docs/learn/soroban)
- [Stellar CLI Reference](https://developers.stellar.org/docs/tools/stellar-cli)
- [Rust Book](https://doc.rust-lang.org/book/)
- [Soroban SDK](https://docs.rs/soroban-sdk/)

## Getting Help

- Check [CONTRIBUTING.md](../CONTRIBUTING.md) for contribution guidelines
- Review [README.md](../README.md) for API documentation
- See [SEEDING_GUIDE.md](SEEDING_GUIDE.md) for environment setup
- Open an issue on GitHub for bugs or feature requests
