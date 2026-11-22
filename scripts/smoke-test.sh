#!/usr/bin/env bash
# Smoke test for the deployed Pulsar payment-processing contract.
# Required env vars: CONTRACT_ID, ADMIN_SECRET, NETWORK
set -euo pipefail

: "${CONTRACT_ID:?CONTRACT_ID is required}"
: "${ADMIN_SECRET:?ADMIN_SECRET is required}"
: "${NETWORK:?NETWORK is required}"

ADMIN_ADDRESS=$(stellar keys address --secret-key "$ADMIN_SECRET" 2>/dev/null || \
  stellar keys address deployer 2>/dev/null || \
  stellar keys generate --global smoke-admin --secret-key "$ADMIN_SECRET" && stellar keys address smoke-admin)

invoke() {
  stellar contract invoke \
    --id "$CONTRACT_ID" \
    --source-account "$ADMIN_SECRET" \
    --network "$NETWORK" \
    -- "$@"
}

# Records the start time of a step.
step_start() {
  STEP_NAME="$1"
  STEP_START_TS=$(date +%s)
  echo "==> [$STEP_NAME] starting"
}

# Records the end time of a step and prints elapsed time.
step_end() {
  local end_ts
  end_ts=$(date +%s)
  local elapsed=$((end_ts - STEP_START_TS))
  echo "==> [$STEP_NAME] done in ${elapsed}s"
}

# Runs a step function, timing it and failing non-zero on error.
run_step() {
  local name="$1"
  shift
  step_start "$name"
  if ! "$@"; then
    echo "❌ [$name] failed" >&2
    exit 1
  fi
  step_end "$name"
}

# Unique-ish identifiers for the smoke payment.
SMOKE_TS=$(date +%s)
PAYMENT_ID="smoke-payment-${SMOKE_TS}"
PAYMENT_AMOUNT="1000"

do_set_admin() {
  invoke set_admin \
    --admins "[\"$ADMIN_ADDRESS\"]" \
    --threshold 1
}

do_register_merchant() {
  invoke register_merchant \
    --merchant_address "$ADMIN_ADDRESS" \
    --name "SmokeStore" \
    --description "Smoke test merchant" \
    --contact_info "smoke@test.local" \
    --category Retail \
    --signing_public_key null
}

do_process_payment() {
  invoke process_payment \
    --payment_id "$PAYMENT_ID" \
    --merchant_address "$ADMIN_ADDRESS" \
    --payer_address "$ADMIN_ADDRESS" \
    --amount "$PAYMENT_AMOUNT" \
    --currency "USD" \
    --payment_method "card"
}

do_get_payment() {
  local result
  result=$(invoke get_payment --payment_id "$PAYMENT_ID")
  echo "get_payment result: $result"
  if [ -z "$result" ]; then
    echo "❌ get_payment returned empty result" >&2
    return 1
  fi
  echo "$result" > /tmp/smoke_payment_result.json
}

do_verify_payment_status() {
  local result
  result=$(invoke get_payment --payment_id "$PAYMENT_ID")
  echo "verify get_payment result: $result"
  if [ -z "$result" ]; then
    echo "❌ verify: get_payment returned empty result" >&2
    return 1
  fi
  # Ensure the payment record references the expected payment id and amount.
  if ! echo "$result" | grep -q "$PAYMENT_ID"; then
    echo "❌ verify: payment id $PAYMENT_ID not found in result" >&2
    return 1
  fi
  if ! echo "$result" | grep -q "$PAYMENT_AMOUNT"; then
    echo "❌ verify: amount $PAYMENT_AMOUNT not found in result" >&2
    return 1
  fi
}

run_step "1/5 set_admin" do_set_admin
run_step "2/5 register_merchant" do_register_merchant
run_step "3/5 process_payment" do_process_payment
run_step "4/5 get_payment" do_get_payment
run_step "5/5 verify_payment_status" do_verify_payment_status

echo "✅ Smoke test passed"