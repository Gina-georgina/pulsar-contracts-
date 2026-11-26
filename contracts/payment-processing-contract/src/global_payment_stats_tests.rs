// SPDX-License-Identifier: MIT
//! Tests for `get_global_payment_stats` with date filters — resolves T-004 / issue #34
//!
//! ## Dependency
//! Issue #34 notes that date-filtered stats are "currently broken (see SC-003)".
//! SC-003 has been fixed in the current codebase (the function now correctly
//! filters by `paid_at` instead of silently ignoring the date bounds).
//!
//! ## Acceptance criteria
//!   1. No payments in the requested date range → zero stats
//!   2. Some payments in range → only in-range payments counted
//!   3. All payments in range → same totals as unfiltered query

#![cfg(test)]

extern crate alloc;
use alloc::vec;

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::StellarAssetClient,
    Address, Bytes, BytesN, Env, String, Vec,
};

use ed25519_dalek::{Signer, SigningKey};

use crate::{
    error::PaymentError,
    types::{MerchantCategory, PaymentOrder},
    PaymentContract, PaymentContractClient,
};

// ── helpers ───────────────────────────────────────────────────────────────────

fn setup() -> (Env, PaymentContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(PaymentContract, ());
    let client = PaymentContractClient::new(&env, &contract_id);
    (env, client)
}

fn create_token(env: &Env, admin: &Address) -> Address {
    env.register_stellar_asset_contract_v2(admin.clone()).address()
}

fn mint(env: &Env, token: &Address, to: &Address, amount: i128) {
    StellarAssetClient::new(env, token).mint(to, &amount);
}

fn s(env: &Env, v: &str) -> String {
    String::from_str(env, v)
}

fn b(env: &Env, v: &str) -> Bytes {
    Bytes::from_slice(env, v.as_bytes())
}

fn zero_key(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[0u8; 32])
}

fn admin_vec(env: &Env, admin: &Address) -> Vec<Address> {
    vec![env, admin.clone()]
}

fn sign_order(env: &Env, order: &PaymentOrder) -> (BytesN<32>, BytesN<64>) {
    let signing_key = SigningKey::from_bytes(&[1u8; 32]);
    let public_key = signing_key.verifying_key();
    let payload = order.order_id.clone();
    let mut payload_bytes = alloc::vec![0u8; payload.len() as usize];
    payload.copy_into_slice(&mut payload_bytes);
    let signature = signing_key.sign(&payload_bytes);
    (
        BytesN::from_array(env, &public_key.to_bytes()),
        BytesN::from_array(env, &signature.to_bytes()),
    )
}

/// Registers admin + merchant, mints tokens, and processes three payments at
/// timestamps 1_000, 5_000, and 10_000 with amounts 100, 200, and 300.
/// Returns `(admin, merchant, payer, token)`.
fn setup_three_payments(
    env: &Env,
    client: &PaymentContractClient,
) -> (Address, Address, Address, Address) {
    let admin = Address::generate(env);
    let merchant = Address::generate(env);
    let payer = Address::generate(env);
    let token = create_token(env, &admin);

    client.set_admin(&admin_vec(env, &admin), &1);
    client.register_merchant(
        &merchant,
        &s(env, "Store"),
        &s(env, "desc"),
        &s(env, "c@c.com"),
        &MerchantCategory::Retail,
        &None,
    );
    mint(env, &token, &payer, 10_000);

    for (ts, id, amt) in [
        (1_000u64, "GS_001", 100i128),
        (5_000, "GS_002", 200),
        (10_000, "GS_003", 300),
    ] {
        env.ledger().with_mut(|l| l.timestamp = ts);
        let order = PaymentOrder {
            order_id: b(env, id),
            merchant_address: merchant.clone(),
            payer: payer.clone(),
            token: token.clone(),
            amount: amt,
            description: s(env, "desc"),
            expires_at: 0,
        };
        let (_pk, sig) = sign_order(env, &order);
        client.process_payment_with_signature(&payer, &order, &sig, &zero_key(env));
    }

    (admin, merchant, payer, token)
}

// ── T-004-1: no payments in the date range → zero stats ──────────────────────

/// When the requested date window contains no payments, all counters are zero.
#[test]
fn test_t004_date_filter_no_payments_in_range() {
    let (env, client) = setup();
    let (admin, _merchant, _payer, _token) = setup_three_payments(&env, &client);

    // Window 20_000..=30_000 — all three payments were created at ≤ 10_000
    let stats = client.get_global_payment_stats(
        &admin_vec(&env, &admin),
        &Some(20_000),
        &Some(30_000),
    );

    assert_eq!(stats.total_payments, 0);
    assert_eq!(stats.total_volume, 0);
    assert_eq!(stats.total_refunds, 0);
    assert_eq!(stats.total_refund_volume, 0);
}

// ── T-004-2: some payments in range → only in-range payments counted ──────────

/// When the date window overlaps a subset of payments only those are counted.
#[test]
fn test_t004_date_filter_some_payments_in_range() {
    let (env, client) = setup();
    let (admin, _merchant, _payer, _token) = setup_three_payments(&env, &client);

    // Window 3_000..=8_000 — only GS_002 (ts=5_000, amount=200) falls inside
    let stats = client.get_global_payment_stats(
        &admin_vec(&env, &admin),
        &Some(3_000),
        &Some(8_000),
    );

    assert_eq!(stats.total_payments, 1);
    assert_eq!(stats.total_volume, 200);
}

/// Window that captures the first two payments but not the third.
#[test]
fn test_t004_date_filter_partial_range_two_payments() {
    let (env, client) = setup();
    let (admin, _merchant, _payer, _token) = setup_three_payments(&env, &client);

    // Window 0..=6_000 — GS_001 (ts=1_000) and GS_002 (ts=5_000) qualify
    let stats = client.get_global_payment_stats(
        &admin_vec(&env, &admin),
        &Some(0),
        &Some(6_000),
    );

    assert_eq!(stats.total_payments, 2);
    assert_eq!(stats.total_volume, 300); // 100 + 200
}

// ── T-004-3: all payments in range → matches unfiltered totals ────────────────

/// When the date window covers the entire history, the result equals the
/// unfiltered (cached) stats.
#[test]
fn test_t004_date_filter_all_payments_in_range() {
    let (env, client) = setup();
    let (admin, _merchant, _payer, _token) = setup_three_payments(&env, &client);

    // Unfiltered totals
    let unfiltered = client.get_global_payment_stats(
        &admin_vec(&env, &admin),
        &None,
        &None,
    );

    // Window 0..=15_000 — all three payments fall inside
    let filtered = client.get_global_payment_stats(
        &admin_vec(&env, &admin),
        &Some(0),
        &Some(15_000),
    );

    assert_eq!(filtered.total_payments, unfiltered.total_payments);
    assert_eq!(filtered.total_volume, unfiltered.total_volume);
}

// ── T-004-4: date filter with only lower bound ────────────────────────────────

/// Providing only `date_start` (no `date_end`) returns all payments on or
/// after the start timestamp.
#[test]
fn test_t004_date_filter_start_only() {
    let (env, client) = setup();
    let (admin, _merchant, _payer, _token) = setup_three_payments(&env, &client);

    // Start at 4_000 — GS_002 (5_000) and GS_003 (10_000) qualify
    let stats = client.get_global_payment_stats(
        &admin_vec(&env, &admin),
        &Some(4_000),
        &None,
    );

    assert_eq!(stats.total_payments, 2);
    assert_eq!(stats.total_volume, 500); // 200 + 300
}

// ── T-004-5: date filter with only upper bound ────────────────────────────────

/// Providing only `date_end` (no `date_start`) returns all payments on or
/// before the end timestamp.
#[test]
fn test_t004_date_filter_end_only() {
    let (env, client) = setup();
    let (admin, _merchant, _payer, _token) = setup_three_payments(&env, &client);

    // End at 6_000 — GS_001 (1_000) and GS_002 (5_000) qualify
    let stats = client.get_global_payment_stats(
        &admin_vec(&env, &admin),
        &None,
        &Some(6_000),
    );

    assert_eq!(stats.total_payments, 2);
    assert_eq!(stats.total_volume, 300); // 100 + 200
}

// ── T-030: stats unchanged while paused ──────────────────────────────────────

/// Processing a payment, then pausing, then attempting a (blocked) payment,
/// then unpausing must leave global stats reflecting only the pre-pause
/// payment. This verifies that stats accumulation side effects do not run
/// while the contract is paused.
#[test]
fn test_t030_global_stats_unchanged_while_paused() {
    let (env, client) = setup();

    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    let payer = Address::generate(&env);
    let token = create_token(&env, &admin);

    client.set_admin(&admin_vec(&env, &admin), &1);
    client.register_merchant(
        &merchant,
        &s(&env, "Store"),
        &s(&env, "desc"),
        &s(&env, "c@c.com"),
        &MerchantCategory::Retail,
        &None,
    );
    mint(&env, &token, &payer, 10_000);

    // First payment — processed before pause
    env.ledger().with_mut(|l| l.timestamp = 1_000);
    let order1 = PaymentOrder {
        order_id: b(&env, "T030_001"),
        merchant_address: merchant.clone(),
        payer: payer.clone(),
        token: token.clone(),
        amount: 100,
        description: s(&env, "desc"),
        expires_at: 0,
    };
    let (_pk1, sig1) = sign_order(&env, &order1);
    client.process_payment_with_signature(&payer, &order1, &sig1, &zero_key(&env));

    // Snapshot stats after the pre-pause payment
    let pre_pause = client.get_global_payment_stats(
        &admin_vec(&env, &admin),
        &None,
        &None,
    );
    assert_eq!(pre_pause.total_payments, 1);
    assert_eq!(pre_pause.total_volume, 100);

    // Pause the contract
    client.pause(&admin);
    assert!(client.is_paused());

    // Attempt a second payment while paused — must be rejected
    env.ledger().with_mut(|l| l.timestamp = 2_000);
    let order2 = PaymentOrder {
        order_id: b(&env, "T030_002"),
        merchant_address: merchant.clone(),
        payer: payer.clone(),
        token: token.clone(),
        amount: 200,
        description: s(&env, "desc"),
        expires_at: 0,
    };
    let (_pk2, sig2) = sign_order(&env, &order2);
    let result = client.try_process_payment_with_signature(
        &payer,
        &order2,
        &sig2,
        &zero_key(&env),
    );
    assert_eq!(result, Err(Ok(PaymentError::ContractPaused)));

    // Unpause the contract
    client.unpause(&admin);
    assert!(!client.is_paused());

    // Stats must still reflect only the pre-pause payment
    let post_unpause = client.get_global_payment_stats(
        &admin_vec(&env, &admin),
        &None,
        &None,
    );
    assert_eq!(post_unpause.total_payments, pre_pause.total_payments);
    assert_eq!(post_unpause.total_volume, pre_pause.total_volume);
    assert_eq!(post_unpause.total_refunds, pre_pause.total_refunds);
    assert_eq!(post_unpause.total_refund_volume, pre_pause.total_refund_volume);
}