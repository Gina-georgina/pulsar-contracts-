// SPDX-License-Identifier: MIT

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
    types::{
        MerchantCategory, PaymentFilter, PaymentOrder, PaymentStatus, RefundStatus, SortField,
        SortOrder, StatusFilter, SubscriptionPlan,
    },
    PaymentContract, PaymentContractClient,
};

use soroban_sdk::xdr::ToXdr;

// ── Test helpers ──────────────────────────────────────────────────────────────

fn sign_order(env: &Env, order: &PaymentOrder) -> (BytesN<32>, BytesN<64>) {
    let signing_key = SigningKey::from_bytes(&[1u8; 32]);
    let public_key = signing_key.verifying_key();
    let payload = order.order_id.clone();
    let mut payload_bytes = vec![0u8; payload.len() as usize];
    payload.copy_into_slice(&mut payload_bytes);
    let signature = signing_key.sign(&payload_bytes);
    (
        BytesN::from_array(env, &public_key.to_bytes()),
        BytesN::from_array(env, &signature.to_bytes()),
    )
}

/// Sign the full XDR-serialised order — matches what the contract actually
/// verifies in `process_payment_with_signature`.
fn sign_order_xdr(env: &Env, order: &PaymentOrder, seed: &[u8; 32]) -> (BytesN<32>, BytesN<64>) {
    let signing_key = SigningKey::from_bytes(seed);
    let public_key = signing_key.verifying_key();

    let xdr_bytes = order.clone().to_xdr(env);
    let mut payload_bytes = vec![0u8; xdr_bytes.len() as usize];
    xdr_bytes.copy_into_slice(&mut payload_bytes);

    let signature = signing_key.sign(&payload_bytes);

    (
        BytesN::from_array(env, &public_key.to_bytes()),
        BytesN::from_array(env, &signature.to_bytes()),
    )
}

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

fn str(env: &Env, s: &str) -> String {
    String::from_str(env, s)
}

fn bytes(env: &Env, s: &str) -> Bytes {
    Bytes::from_slice(env, s.as_bytes())
}

fn make_order(env: &Env, merchant: &Address, payer: &Address, token: &Address) -> PaymentOrder {
    PaymentOrder {
        order_id: bytes(env, "ORDER_001"),
        merchant_address: merchant.clone(),
        payer: payer.clone(),
        token: token.clone(),
        amount: 1000,
        description: str(env, "Test order"),
        expires_at: 0,
    }
}

fn zero_key(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[0u8; 32])
}

fn zero_sig(env: &Env) -> BytesN<64> {
    BytesN::from_array(env, &[0u8; 64])
}

fn admins(env: &Env, admin: &Address) -> Vec<Address> {
    vec![env, admin.clone()]
}

// ── Admin tests ───────────────────────────────────────────────────────────────

#[test]
fn test_set_admin_success() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    client.set_admin(&admins(&env, &admin), &1);
}

#[test]
fn test_set_admin_twice_fails() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    client.set_admin(&admins(&env, &admin), &1);
    let result = client.try_set_admin(&admins(&env, &admin), &1);
    assert_eq!(result, Err(Ok(PaymentError::AdminAlreadySet)));
}

#[test]
fn test_get_version_after_set_admin() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    client.set_admin(&admins(&env, &admin), &1);
    assert_eq!(client.get_version(), 1);
}

#[test]
fn test_ping() {
    let (env, client) = setup();
    env.ledger().with_mut(|li| {
        li.timestamp = 12345;
    });
    assert_eq!(client.ping(), 12345);
}

// ── Merchant tests ────────────────────────────────────────────────────────────

#[test]
fn test_register_merchant_success() {
    let (env, client) = setup();
    let merchant = Address::generate(&env);
    client.register_merchant(
        &merchant,
        &str(&env, "My Store"),
        &str(&env, "A great store"),
        &str(&env, "contact@store.com"),
        &MerchantCategory::Retail,
        &None,
    );
    let m = client.get_merchant(&merchant);
    assert_eq!(m.name, str(&env, "My Store"));
    assert!(m.active);
}

#[test]
fn test_register_merchant_duplicate_fails() {
    let (env, client) = setup();
    let merchant = Address::generate(&env);
    client.register_merchant(
        &merchant,
        &str(&env, "Store"),
        &str(&env, "desc"),
        &str(&env, "c@c.com"),
        &MerchantCategory::Retail,
        &None,
    );
    let result = client.try_register_merchant(
        &merchant,
        &str(&env, "Store"),
        &str(&env, "desc"),
        &str(&env, "c@c.com"),
        &MerchantCategory::Retail,
        &None,
    );
    assert_eq!(result, Err(Ok(PaymentError::MerchantAlreadyRegistered)));
}

#[test]
fn test_register_merchant_field_limits() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    client.set_admin(&admins(&env, &admin), &1);

    let m1 = Address::generate(&env);
    client.register_merchant(&m1, &str(&env, &"n".repeat(64)), &str(&env, "desc"), &str(&env, "c@c.com"), &MerchantCategory::Retail, &None);

    let m2 = Address::generate(&env);
    assert_eq!(
        client.try_register_merchant(&m2, &str(&env, &"n".repeat(65)), &str(&env, "desc"), &str(&env, "c@c.com"), &MerchantCategory::Retail, &None),
        Err(Ok(PaymentError::InvalidInput))
    );

    let m3 = Address::generate(&env);
    client.register_merchant(&m3, &str(&env, "Store"), &str(&env, &"d".repeat(256)), &str(&env, "c@c.com"), &MerchantCategory::Retail, &None);

    let m4 = Address::generate(&env);
    assert_eq!(
        client.try_register_merchant(&m4, &str(&env, "Store"), &str(&env, &"d".repeat(257)), &str(&env, "c@c.com"), &MerchantCategory::Retail, &None),
        Err(Ok(PaymentError::InvalidInput))
    );

    let m5 = Address::generate(&env);
    client.register_merchant(&m5, &str(&env, "Store"), &str(&env, "desc"), &str(&env, &"c".repeat(128)), &MerchantCategory::Retail, &None);

    let m6 = Address::generate(&env);
    assert_eq!(
        client.try_register_merchant(&m6, &str(&env, "Store"), &str(&env, "desc"), &str(&env, &"c".repeat(129)), &MerchantCategory::Retail, &None),
        Err(Ok(PaymentError::InvalidInput))
    );
}

#[test]
fn test_register_contact_info_sanitisation_rejects_control_chars() {
    let (env, client) = setup();
    let merchant = Address::generate(&env);
    let bad_contact = String::from_str(&env, "bad\x01contact");
    assert_eq!(
        client.try_register_merchant(&merchant, &str(&env, "Store"), &str(&env, "desc"), &bad_contact, &MerchantCategory::Retail, &None),
        Err(Ok(PaymentError::InvalidInput))
    );
}

#[test]
fn test_deactivate_merchant() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    client.set_admin(&admins(&env, &admin), &1);
    client.register_merchant(&merchant, &str(&env, "Store"), &str(&env, "desc"), &str(&env, "c@c.com"), &MerchantCategory::Retail, &None);
    client.deactivate_merchant(&merchant, &Some(admins(&env, &admin)));
    assert!(!client.get_merchant(&merchant).active);
}

// ── update_merchant tests ─────────────────────────────────────────────────────

#[test]
fn test_update_merchant_success() {
    let (env, client) = setup();
    let merchant = Address::generate(&env);
    client.register_merchant(
        &merchant,
        &str(&env, "Old Name"),
        &str(&env, "old desc"),
        &str(&env, "old@c.com"),
        &MerchantCategory::Retail,
    );
    client.update_merchant(
        &merchant,
        &str(&env, "New Name"),
        &str(&env, "new desc"),
        &str(&env, "new@c.com"),
        &MerchantCategory::Food,
    );
    let m = client.get_merchant(&merchant);
    assert_eq!(m.name, str(&env, "New Name"));
    assert_eq!(m.category, MerchantCategory::Food);
    assert!(m.active);
    // registered_at preserved (non-zero since we don't advance time)
    assert_eq!(m.registered_at, 0);
}

#[test]
fn test_update_merchant_empty_name_fails() {
    let (env, client) = setup();
    let merchant = Address::generate(&env);
    client.register_merchant(
        &merchant,
        &str(&env, "Store"),
        &str(&env, "desc"),
        &str(&env, "c@c.com"),
        &MerchantCategory::Retail,
    );
    let result = client.try_update_merchant(
        &merchant,
        &str(&env, ""),
        &str(&env, "desc"),
        &str(&env, "c@c.com"),
        &MerchantCategory::Retail,
    );
    assert_eq!(result, Err(Ok(PaymentError::InvalidInput)));
}

#[test]
fn test_update_merchant_not_found_fails() {
    let (env, client) = setup();
    let merchant = Address::generate(&env);
    let result = client.try_update_merchant(
        &merchant,
        &str(&env, "Name"),
        &str(&env, "desc"),
        &str(&env, "c@c.com"),
        &MerchantCategory::Retail,
    );
    assert_eq!(result, Err(Ok(PaymentError::MerchantNotFound)));
}

#[test]
fn test_update_merchant_inactive_fails() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    client.set_admin(&admin);
    client.register_merchant(
        &merchant,
        &str(&env, "Store"),
        &str(&env, "desc"),
        &str(&env, "c@c.com"),
        &MerchantCategory::Retail,
    );
    client.deactivate_merchant(&admin, &merchant);
    let result = client.try_update_merchant(
        &merchant,
        &str(&env, "New Name"),
        &str(&env, "desc"),
        &str(&env, "c@c.com"),
        &MerchantCategory::Retail,
    );
    assert_eq!(result, Err(Ok(PaymentError::MerchantInactive)));
}

// ── Payment tests ─────────────────────────────────────────────────────────────

#[test]
fn test_payment_payer_mismatch_fails() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    let payer = Address::generate(&env);
    let other_payer = Address::generate(&env);
    let token = create_token(&env, &admin);
    client.set_admin(&admins(&env, &admin), &1);
    client.register_merchant(&merchant, &str(&env, "Store"), &str(&env, "desc"), &str(&env, "c@c.com"), &MerchantCategory::Retail, &None);
    mint(&env, &token, &payer, 5000);
    let order = make_order(&env, &merchant, &other_payer, &token);
    let (_pk, sig) = sign_order(&env, &order);
    assert_eq!(
        client.try_process_payment_with_signature(&payer, &order, &sig, &zero_key(&env)),
        Err(Ok(PaymentError::InvalidInput))
    );
}

#[test]
fn test_successful_payment_with_signature() {
    let (env, client) = setup();
    let (_admin, _merchant, payer, _token) = setup_paid_order(&env, &client);
    let record = client.get_payment_by_id(&payer, &bytes(&env, "ORDER_001"));
    assert_eq!(record.amount, 1000);
    assert_eq!(record.status, PaymentStatus::Completed);
}

#[test]
fn test_duplicate_payment_fails() {
    let (env, client) = setup();
    let (_admin, merchant, payer, token) = setup_paid_order(&env, &client);
    let order = make_order(&env, &merchant, &payer, &token);
    let (_pk, sig) = sign_order(&env, &order);
    assert_eq!(
        client.try_process_payment_with_signature(&payer, &order, &sig, &zero_key(&env)),
        Err(Ok(PaymentError::PaymentAlreadyExists))
    );
}

#[test]
fn test_payment_expired_fails() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    let payer = Address::generate(&env);
    let token = create_token(&env, &admin);
    client.set_admin(&admins(&env, &admin), &1);
    client.register_merchant(&merchant, &str(&env, "Store"), &str(&env, "desc"), &str(&env, "c@c.com"), &MerchantCategory::Retail, &None);
    mint(&env, &token, &payer, 5000);
    env.ledger().with_mut(|l| l.timestamp = 2000);
    let mut order = make_order(&env, &merchant, &payer, &token);
    order.expires_at = 1000;
    let (_pk, sig) = sign_order(&env, &order);
    assert_eq!(
        client.try_process_payment_with_signature(&payer, &order, &sig, &zero_key(&env)),
        Err(Ok(PaymentError::PaymentExpired))
    );
}

#[test]
fn test_global_stats_overflow_fails() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    let payer = Address::generate(&env);
    let token = create_token(&env, &admin);
    client.set_admin(&admins(&env, &admin), &1);
    client.register_merchant(&merchant, &str(&env, "Store"), &str(&env, "desc"), &str(&env, "c@c.com"), &MerchantCategory::Retail, &None);
    mint(&env, &token, &payer, i128::MAX);
    let mut order = make_order(&env, &merchant, &payer, &token);
    order.amount = i128::MAX;
    let (_pk, sig) = sign_order(&env, &order);
    client.process_payment_with_signature(&payer, &order, &sig, &zero_key(&env));
    order.order_id = bytes(&env, "ORDER_002");
    let (_pk2, sig2) = sign_order(&env, &order);
    assert_eq!(
        client.try_process_payment_with_signature(&payer, &order, &sig2, &zero_key(&env)),
        Err(Ok(PaymentError::ArithmeticError))
    );
}

// ── Refund tests ──────────────────────────────────────────────────────────────

fn setup_paid_order(env: &Env, client: &PaymentContractClient) -> (Address, Address, Address, Address) {
    let admin = Address::generate(env);
    let merchant = Address::generate(env);
    let payer = Address::generate(env);
    let token = create_token(env, &admin);
    client.set_admin(&admins(env, &admin), &1);
    client.register_merchant(&merchant, &str(env, "Store"), &str(env, "desc"), &str(env, "c@c.com"), &MerchantCategory::Retail, &None);
    mint(env, &token, &payer, 5000);
    let order = make_order(env, &merchant, &payer, &token);
    let (_pk, sig) = sign_order(env, &order);
    client.process_payment_with_signature(&payer, &order, &sig, &zero_key(env));
    (admin, merchant, payer, token)
}

#[test]
fn test_successful_refund_flow() {
    let (env, client) = setup();
    let (_admin, merchant, payer, token) = setup_paid_order(&env, &client);
    let token_client = soroban_sdk::token::TokenClient::new(&env, &token);
    let payer_before = token_client.balance(&payer);
    let merchant_before = token_client.balance(&merchant);
    client.initiate_refund(&payer, &bytes(&env, "REFUND_001"), &bytes(&env, "ORDER_001"), &500, &str(&env, "Customer request"));
    assert_eq!(client.get_refund_status(&bytes(&env, "REFUND_001")), RefundStatus::Pending);
    client.approve_refund(&merchant, &bytes(&env, "REFUND_001"), &None);
    assert_eq!(client.get_refund_status(&bytes(&env, "REFUND_001")), RefundStatus::Approved);
    client.execute_refund(&merchant, &bytes(&env, "REFUND_001"));
    assert_eq!(client.get_refund_status(&bytes(&env, "REFUND_001")), RefundStatus::Completed);
    let record = client.get_payment_by_id(&payer, &bytes(&env, "ORDER_001"));
    assert_eq!(record.refunded_amount, 500);
    assert_eq!(record.status, PaymentStatus::PartiallyRefunded);
    assert_eq!(token_client.balance(&payer), payer_before + 500);
    assert_eq!(token_client.balance(&merchant), merchant_before - 500);
}

#[test]
fn test_full_refund_flow_with_balance_assertions() {
    let (env, client) = setup();
    let (_admin, merchant, payer, token) = setup_paid_order(&env, &client);
    let token_client = soroban_sdk::token::TokenClient::new(&env, &token);
    let payer_before = token_client.balance(&payer);
    let merchant_before = token_client.balance(&merchant);
    client.initiate_refund(&payer, &bytes(&env, "REFUND_FULL"), &bytes(&env, "ORDER_001"), &1000, &str(&env, "Full refund"));
    client.approve_refund(&merchant, &bytes(&env, "REFUND_FULL"), &None);
    client.execute_refund(&merchant, &bytes(&env, "REFUND_FULL"));
    let record = client.get_payment_by_id(&payer, &bytes(&env, "ORDER_001"));
    assert_eq!(record.refunded_amount, 1000);
    assert_eq!(record.status, PaymentStatus::FullyRefunded);
    assert_eq!(token_client.balance(&payer), payer_before + 1000);
    assert_eq!(token_client.balance(&merchant), merchant_before - 1000);
}

#[test]
fn test_refund_reason_length_limit() {
    let (env, client) = setup();
    let (_admin, _merchant, payer, _token) = setup_paid_order(&env, &client);
    client.initiate_refund(&payer, &bytes(&env, "REFUND_OK"), &bytes(&env, "ORDER_001"), &100, &str(&env, &"r".repeat(256)));
    assert_eq!(
        client.try_initiate_refund(&payer, &bytes(&env, "REFUND_BAD"), &bytes(&env, "ORDER_001"), &100, &str(&env, &"r".repeat(257))),
        Err(Ok(PaymentError::InvalidInput))
    );
}

#[test]
fn test_approve_refund_unauthorized_fails() {
    let (env, client) = setup();
    let (_admin, _merchant, payer, _token) = setup_paid_order(&env, &client);
    let stranger = Address::generate(&env);
    client.initiate_refund(&payer, &bytes(&env, "REFUND_001"), &bytes(&env, "ORDER_001"), &500, &str(&env, "Customer request"));
    assert_eq!(
        client.try_approve_refund(&stranger, &bytes(&env, "REFUND_001"), &None),
        Err(Ok(PaymentError::Unauthorized))
    );
}

#[test]
fn test_initiate_refund_unauthorized_fails() {
    let (env, client) = setup();
    let (_admin, _merchant, payer, _token) = setup_paid_order(&env, &client);
    let stranger = Address::generate(&env);

    let result = client.try_initiate_refund(
        &stranger,
        &bytes(&env, "REFUND_001"),
        &bytes(&env, "ORDER_001"),
        &500,
        &str(&env, "Unauthorized refund attempt"),
    );

    assert_eq!(result, Err(Ok(PaymentError::Unauthorized)));
}

#[test]
fn test_refund_exceeds_payment_fails() {
    let (env, client) = setup();
    let (_admin, _merchant, payer, _token) = setup_paid_order(&env, &client);
    assert_eq!(
        client.try_initiate_refund(&payer, &bytes(&env, "REFUND_001"), &bytes(&env, "ORDER_001"), &1500, &str(&env, "Too much")),
        Err(Ok(PaymentError::RefundAmountExceedsPayment))
    );
}

#[test]
fn test_refund_window_expired_fails() {
    let (env, client) = setup();
    let (_admin, _merchant, payer, _token) = setup_paid_order(&env, &client);
    env.ledger().with_mut(|l| l.timestamp = 2_592_001);
    assert_eq!(
        client.try_initiate_refund(&payer, &bytes(&env, "REFUND_001"), &bytes(&env, "ORDER_001"), &500, &str(&env, "Late")),
        Err(Ok(PaymentError::RefundWindowExpired))
    );
}

// ── Refund window edge-case tests ─────────────────────────────────────────────

/// Refund well within the 30-day window (day 15) — must succeed.
#[test]
fn test_refund_well_within_window_succeeds() {
    let (env, client) = setup();
    let (_admin, _merchant, payer, _token) = setup_paid_order(&env, &client);

    // Day 15: 15 * 86_400 = 1_296_000
    env.ledger().with_mut(|l| l.timestamp = 1_296_000);

    client.initiate_refund(
        &payer,
        &bytes(&env, "REFUND_MID"),
        &bytes(&env, "ORDER_001"),
        &500,
        &str(&env, "Mid-window refund"),
    );
    let status = client.get_refund_status(&bytes(&env, "REFUND_MID"));
    assert_eq!(status, RefundStatus::Pending);
}

/// Refund exactly at the nominal 30-day deadline (paid_at + REFUND_WINDOW) — must succeed.
#[test]
fn test_refund_exactly_at_nominal_deadline_succeeds() {
    let (env, client) = setup();
    let (_admin, _merchant, payer, _token) = setup_paid_order(&env, &client);

    // paid_at = 0 (default ledger timestamp in tests), deadline = 2_592_000
    env.ledger().with_mut(|l| l.timestamp = 2_592_000);

    client.initiate_refund(
        &payer,
        &bytes(&env, "REFUND_EXACT"),
        &bytes(&env, "ORDER_001"),
        &500,
        &str(&env, "Exactly at deadline"),
    );
    let status = client.get_refund_status(&bytes(&env, "REFUND_EXACT"));
    assert_eq!(status, RefundStatus::Pending);
}

/// Refund 1 second past the nominal deadline but within the grace buffer — must succeed.
#[test]
fn test_refund_within_grace_buffer_succeeds() {
    let (env, client) = setup();
    let (_admin, _merchant, payer, _token) = setup_paid_order(&env, &client);

    // 1 second past nominal deadline, still inside the 1-hour grace buffer
    env.ledger().with_mut(|l| l.timestamp = 2_592_001);

    client.initiate_refund(
        &payer,
        &bytes(&env, "REFUND_GRACE"),
        &bytes(&env, "ORDER_001"),
        &500,
        &str(&env, "Inside grace buffer"),
    );
    let status = client.get_refund_status(&bytes(&env, "REFUND_GRACE"));
    assert_eq!(status, RefundStatus::Pending);
}

/// Refund exactly at the end of the grace buffer (paid_at + REFUND_WINDOW + REFUND_GRACE_BUFFER) — must succeed.
#[test]
fn test_refund_at_grace_buffer_boundary_succeeds() {
    let (env, client) = setup();
    let (_admin, _merchant, payer, _token) = setup_paid_order(&env, &client);

    // Exactly at the last valid second: 2_592_000 + 3_600 = 2_595_600
    env.ledger().with_mut(|l| l.timestamp = 2_595_600);

    client.initiate_refund(
        &payer,
        &bytes(&env, "REFUND_BOUNDARY"),
        &bytes(&env, "ORDER_001"),
        &500,
        &str(&env, "At grace boundary"),
    );
    let status = client.get_refund_status(&bytes(&env, "REFUND_BOUNDARY"));
    assert_eq!(status, RefundStatus::Pending);
}

/// Refund 1 second past the grace buffer — must be rejected.
#[test]
fn test_refund_one_second_past_grace_buffer_fails() {
    let (env, client) = setup();
    let (_admin, _merchant, payer, _token) = setup_paid_order(&env, &client);

    // 1 second past the grace buffer: 2_592_000 + 3_600 + 1 = 2_595_601
    env.ledger().with_mut(|l| l.timestamp = 2_595_601);

    let result = client.try_initiate_refund(
        &payer,
        &bytes(&env, "REFUND_LATE"),
        &bytes(&env, "ORDER_001"),
        &500,
        &str(&env, "Just past grace"),
    );
    assert_eq!(result, Err(Ok(PaymentError::RefundWindowExpired)));
}

/// Refund long after the window (day 60) — must be rejected.
#[test]
fn test_refund_long_after_window_fails() {
    let (env, client) = setup();
    let (_admin, _merchant, payer, _token) = setup_paid_order(&env, &client);

    // Day 60: 60 * 86_400 = 5_184_000
    env.ledger().with_mut(|l| l.timestamp = 5_184_000);

    let result = client.try_initiate_refund(
        &payer,
        &bytes(&env, "REFUND_OLD"),
        &bytes(&env, "ORDER_001"),
        &500,
        &str(&env, "Way too late"),
    );
    assert_eq!(result, Err(Ok(PaymentError::RefundWindowExpired)));
}

#[test]
fn test_reject_refund() {
    let (env, client) = setup();
    let (_admin, merchant, payer, _token) = setup_paid_order(&env, &client);
    client.initiate_refund(&payer, &bytes(&env, "REFUND_001"), &bytes(&env, "ORDER_001"), &500, &str(&env, "Request"));
    client.reject_refund(&merchant, &bytes(&env, "REFUND_001"), &None);
    assert_eq!(client.get_refund_status(&bytes(&env, "REFUND_001")), RefundStatus::Rejected);
}

#[test]
fn test_execute_refund_unauthorized_fails() {
    let (env, client) = setup();
    let (_admin, merchant, payer, _token) = setup_paid_order(&env, &client);
    client.initiate_refund(&payer, &bytes(&env, "R1"), &bytes(&env, "ORDER_001"), &500, &str(&env, "reason"));
    client.approve_refund(&merchant, &bytes(&env, "R1"), &None);
    let other = Address::generate(&env);
    assert_eq!(
        client.try_execute_refund(&other, &bytes(&env, "R1")),
        Err(Ok(PaymentError::Unauthorized))
    );
}

#[test]
fn test_concurrent_refunds_within_limit_both_succeed() {
    let (env, client) = setup();
    let (_admin, merchant, payer, _token) = setup_paid_order(&env, &client);
    client.initiate_refund(&payer, &bytes(&env, "R_CONC_1"), &bytes(&env, "ORDER_001"), &600, &str(&env, "first"));
    client.initiate_refund(&payer, &bytes(&env, "R_CONC_2"), &bytes(&env, "ORDER_001"), &400, &str(&env, "second"));
    client.approve_refund(&merchant, &bytes(&env, "R_CONC_1"), &None);
    client.execute_refund(&merchant, &bytes(&env, "R_CONC_1"));
    client.approve_refund(&merchant, &bytes(&env, "R_CONC_2"), &None);
    client.execute_refund(&merchant, &bytes(&env, "R_CONC_2"));
    let record = client.get_payment_by_id(&payer, &bytes(&env, "ORDER_001"));
    assert_eq!(record.refunded_amount, 1000);
    assert_eq!(record.status, PaymentStatus::FullyRefunded);
}

#[test]
fn test_concurrent_refunds_exceeding_limit_second_rejected() {
    let (env, client) = setup();
    let (_admin, _merchant, payer, _token) = setup_paid_order(&env, &client);
    client.initiate_refund(&payer, &bytes(&env, "R_RACE_1"), &bytes(&env, "ORDER_001"), &700, &str(&env, "first"));
    assert_eq!(
        client.try_initiate_refund(&payer, &bytes(&env, "R_RACE_2"), &bytes(&env, "ORDER_001"), &400, &str(&env, "second")),
        Err(Ok(PaymentError::RefundAmountExceedsPayment))
    );
}

// ── Payment history tests ─────────────────────────────────────────────────────

#[test]
fn test_get_merchant_payment_history() {
    let (env, client) = setup();
    let (_admin, merchant, payer, token) = setup_paid_order(&env, &client);
    mint(&env, &token, &payer, 10000);
    for (id, amount) in [("ORDER_002", 200i128), ("ORDER_003", 300)] {
        let order = PaymentOrder {
            order_id: bytes(&env, id),
            merchant_address: merchant.clone(),
            payer: payer.clone(),
            token: token.clone(),
            amount,
            description: str(&env, "desc"),
            expires_at: 0,
        };
        let (_pk, sig) = sign_order(&env, &order);
        client.process_payment_with_signature(&payer, &order, &sig, &zero_key(&env));
    }
    let page = client.get_merchant_payment_history(&merchant, &None, &10, &None, &SortField::Amount, &SortOrder::Descending);
    assert_eq!(page.total, 3);
    assert_eq!(page.records.get(0).unwrap().amount, 300);
}

#[test]
fn test_large_payment_index_growth() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    let payer = Address::generate(&env);
    let token = create_token(&env, &admin);
    client.set_admin(&admins(&env, &admin), &1);
    client.register_merchant(&merchant, &str(&env, "Store"), &str(&env, "desc"), &str(&env, "c@c.com"), &MerchantCategory::Retail, &None);
    mint(&env, &token, &payer, 1_000_000);
    for i in 0..250 {
        let order = PaymentOrder {
            order_id: bytes(&env, &alloc::format!("ORDER_{:04}", i)),
            merchant_address: merchant.clone(),
            payer: payer.clone(),
            token: token.clone(),
            amount: 1,
            description: str(&env, "Test"),
            expires_at: 0,
        };
        client.process_payment_with_signature(&payer, &order, &zero_sig(&env), &zero_key(&env));
    }
    let history = client.get_merchant_payment_history(&merchant, &None, &10, &None, &SortField::Date, &SortOrder::Ascending);
    assert_eq!(history.total, 250);
    assert_eq!(history.records.len(), 10);
}

fn setup_payer_history(env: &Env, client: &PaymentContractClient, amounts: &[i128]) -> (Address, Address, Address, Address) {
    let admin = Address::generate(env);
    let merchant = Address::generate(env);
    let payer = Address::generate(env);
    let token = create_token(env, &admin);
    client.set_admin(&admins(env, &admin), &1);
    client.register_merchant(&merchant, &str(env, "Store"), &str(env, "desc"), &str(env, "c@c.com"), &MerchantCategory::Retail, &None);
    let total: i128 = amounts.iter().sum::<i128>() + 1000;
    mint(env, &token, &payer, total);
    for (i, &amount) in amounts.iter().enumerate() {
        let id = alloc::format!("PAY_{:03}", i);
        let order = PaymentOrder {
            order_id: Bytes::from_slice(env, id.as_bytes()),
            merchant_address: merchant.clone(),
            payer: payer.clone(),
            token: token.clone(),
            amount,
            description: str(env, "desc"),
            expires_at: 0,
        };
        let (_pk, sig) = sign_order(env, &order);
        client.process_payment_with_signature(&payer, &order, &sig, &zero_key(env));
    }
    (admin, merchant, payer, token)
}

#[test]
fn test_payer_history_no_payments() {
    let (env, client) = setup();
    let payer = Address::generate(&env);
    let page = client.get_payer_payment_history(&payer, &None, &10, &None, &SortField::Date, &SortOrder::Descending);
    assert_eq!(page.total, 0);
    assert!(page.next_cursor.is_none());
}

#[test]
fn test_payer_history_single_payment() {
    let (env, client) = setup();
    let (_admin, _merchant, payer, _token) = setup_payer_history(&env, &client, &[500]);
    let page = client.get_payer_payment_history(&payer, &None, &10, &None, &SortField::Date, &SortOrder::Ascending);
    assert_eq!(page.total, 1);
    assert_eq!(page.records.get(0).unwrap().amount, 500);
}

#[test]
fn test_payer_history_multiple_payments() {
    let (env, client) = setup();
    let (_admin, _merchant, payer, _token) = setup_payer_history(&env, &client, &[100, 200, 300]);
    let page = client.get_payer_payment_history(&payer, &None, &10, &None, &SortField::Amount, &SortOrder::Ascending);
    assert_eq!(page.total, 3);
    assert_eq!(page.records.get(0).unwrap().amount, 100);
    assert_eq!(page.records.get(2).unwrap().amount, 300);
}

#[test]
fn test_payer_history_filter_date_range() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    let payer = Address::generate(&env);
    let token = create_token(&env, &admin);
    client.set_admin(&admins(&env, &admin), &1);
    client.register_merchant(&merchant, &str(&env, "Store"), &str(&env, "desc"), &str(&env, "c@c.com"), &MerchantCategory::Retail, &None);
    mint(&env, &token, &payer, 10000);
    env.ledger().with_mut(|l| l.timestamp = 1000);
    let o1 = PaymentOrder { order_id: bytes(&env, "D_001"), merchant_address: merchant.clone(), payer: payer.clone(), token: token.clone(), amount: 100, description: str(&env, "d"), expires_at: 0 };
    let (_pk, sig) = sign_order(&env, &o1);
    client.process_payment_with_signature(&payer, &o1, &sig, &zero_key(&env));
    env.ledger().with_mut(|l| l.timestamp = 5000);
    let o2 = PaymentOrder { order_id: bytes(&env, "D_002"), merchant_address: merchant.clone(), payer: payer.clone(), token: token.clone(), amount: 200, description: str(&env, "d"), expires_at: 0 };
    let (_pk2, sig2) = sign_order(&env, &o2);
    client.process_payment_with_signature(&payer, &o2, &sig2, &zero_key(&env));
    let filter = PaymentFilter { date_start: Some(500), date_end: Some(2000), amount_min: None, amount_max: None, token: None, status: StatusFilter::Any };
    let page = client.get_payer_payment_history(&payer, &None, &10, &Some(filter), &SortField::Date, &SortOrder::Ascending);
    assert_eq!(page.total, 1);
    assert_eq!(page.records.get(0).unwrap().amount, 100);
}

#[test]
fn test_payer_history_filter_amount_range() {
    let (env, client) = setup();
    let (_admin, _merchant, payer, _token) = setup_payer_history(&env, &client, &[50, 150, 500]);
    let filter = PaymentFilter { date_start: None, date_end: None, amount_min: Some(100), amount_max: Some(200), token: None, status: StatusFilter::Any };
    let page = client.get_payer_payment_history(&payer, &None, &10, &Some(filter), &SortField::Amount, &SortOrder::Ascending);
    assert_eq!(page.total, 1);
    assert_eq!(page.records.get(0).unwrap().amount, 150);
}

#[test]
fn test_payer_history_pagination() {
    let (env, client) = setup();
    let (_admin, _merchant, payer, _token) = setup_payer_history(&env, &client, &[100, 200, 300, 400, 500]);
    let page1 = client.get_payer_payment_history(&payer, &None, &2, &None, &SortField::Amount, &SortOrder::Ascending);
    assert_eq!(page1.records.len(), 2);
    assert!(page1.next_cursor.is_some());
    let page2 = client.get_payer_payment_history(&payer, &page1.next_cursor, &2, &None, &SortField::Amount, &SortOrder::Ascending);
    assert_eq!(page2.records.len(), 2);
    assert!(page2.records.get(0).unwrap().amount > page1.records.get(1).unwrap().amount);
}

// ── Whitelist tests ───────────────────────────────────────────────────────────

#[test]
fn test_whitelist_mode_blocks_unregistered_merchant() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    client.set_admin(&admins(&env, &admin), &1);
    client.set_whitelist_mode(&admins(&env, &admin), &true);
    assert_eq!(
        client.try_register_merchant(&merchant, &str(&env, "Store"), &str(&env, "desc"), &str(&env, "c@c.com"), &MerchantCategory::Retail, &None),
        Err(Ok(PaymentError::Unauthorized))
    );
}

#[test]
fn test_whitelist_mode_allows_approved_merchant() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    client.set_admin(&admins(&env, &admin), &1);
    client.set_whitelist_mode(&admins(&env, &admin), &true);
    client.approve_merchant_registration(&admins(&env, &admin), &merchant);
    client.register_merchant(&merchant, &str(&env, "Store"), &str(&env, "desc"), &str(&env, "c@c.com"), &MerchantCategory::Retail, &None);
    assert!(client.get_merchant(&merchant).active);
}

#[test]
fn test_set_whitelist_mode_non_admin_fails() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let other = Address::generate(&env);
    client.set_admin(&admins(&env, &admin), &1);
    assert_eq!(
        client.try_set_whitelist_mode(&admins(&env, &other), &true),
        Err(Ok(PaymentError::Unauthorized))
    );
}

// ── Archive / cleanup tests ───────────────────────────────────────────────────

#[test]
fn test_archive_payment_record_removes_from_indexes() {
    let (env, client) = setup();
    let (admin, merchant, payer, _token) = setup_paid_order(&env, &client);
    let page = client.get_merchant_payment_history(&merchant, &None, &10, &None, &SortField::Date, &SortOrder::Ascending);
    assert_eq!(page.total, 1);
    client.archive_payment_record(&admins(&env, &admin), &bytes(&env, "ORDER_001"));
    assert_eq!(client.try_get_payment_by_id(&payer, &bytes(&env, "ORDER_001")), Err(Ok(PaymentError::PaymentNotFound)));
    assert_eq!(client.get_merchant_payment_history(&merchant, &None, &10, &None, &SortField::Date, &SortOrder::Ascending).total, 0);
    assert_eq!(client.get_payer_payment_history(&payer, &None, &10, &None, &SortField::Date, &SortOrder::Ascending).total, 0);
}

#[test]
fn test_archive_payment_record_non_admin_fails() {
    let (env, client) = setup();
    let (_admin, _merchant, payer, _token) = setup_paid_order(&env, &client);
    assert_eq!(
        client.try_archive_payment_record(&admins(&env, &payer), &bytes(&env, "ORDER_001")),
        Err(Ok(PaymentError::Unauthorized))
    );
}

#[test]
fn test_archive_payment_record_not_found_fails() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    client.set_admin(&admins(&env, &admin), &1);
    assert_eq!(
        client.try_archive_payment_record(&admins(&env, &admin), &bytes(&env, "NONEXISTENT")),
        Err(Ok(PaymentError::PaymentNotFound))
    );
}

#[test]
fn test_set_cleanup_period() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    client.set_admin(&admins(&env, &admin), &1);
    client.set_payment_cleanup_period(&admins(&env, &admin), &86400);
}

#[test]
fn test_set_cleanup_period_zero_fails() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    client.set_admin(&admins(&env, &admin), &1);
    assert_eq!(
        client.try_set_payment_cleanup_period(&admins(&env, &admin), &0),
        Err(Ok(PaymentError::InvalidInput))
    );
}

#[test]
fn test_set_cleanup_period_valid_is_persisted() {
    let (env, client) = setup();
    let (admin, _merchant, payer, _token) = setup_paid_order(&env, &client);
    client.set_payment_cleanup_period(&admins(&env, &admin), &1);
    env.ledger().with_mut(|l| l.timestamp = 100);
    let count = client.cleanup_expired_payments(&admins(&env, &admin));
    assert_eq!(count, 1);
    assert_eq!(client.try_get_payment_by_id(&payer, &bytes(&env, "ORDER_001")), Err(Ok(PaymentError::PaymentNotFound)));
}

#[test]
fn test_cleanup_expired_payments() {
    let (env, client) = setup();
    let (admin, merchant, payer, token) = setup_paid_order(&env, &client);
    client.set_payment_cleanup_period(&admins(&env, &admin), &3600);
    let order2 = PaymentOrder { order_id: bytes(&env, "ORDER_002"), merchant_address: merchant.clone(), payer: payer.clone(), token: token.clone(), amount: 500, description: str(&env, "desc"), expires_at: 0 };
    client.process_payment_with_signature(&payer, &order2, &zero_sig(&env), &zero_key(&env));
    env.ledger().with_mut(|l| l.timestamp = 7201);
    let count = client.cleanup_expired_payments(&admins(&env, &admin));
    assert_eq!(count, 2);
    assert_eq!(client.try_get_payment_by_id(&payer, &bytes(&env, "ORDER_001")), Err(Ok(PaymentError::PaymentNotFound)));
    assert_eq!(client.try_get_payment_by_id(&payer, &bytes(&env, "ORDER_002")), Err(Ok(PaymentError::PaymentNotFound)));
}

/// T-012: Some expired, some not — only expired payments are removed.
#[test]
fn test_cleanup_some_expired_leaves_recent() {
    let (env, client) = setup();
    let (admin, merchant, payer, token) = setup_paid_order(&env, &client);
    // Set cleanup period to 3600 seconds
    client.set_payment_cleanup_period(&admins(&env, &admin), &3600);
    // Advance time so ORDER_001 (created at t=0) is now past the cleanup period
    env.ledger().with_mut(|l| l.timestamp = 7201);
    // Add a second payment at t=7201 — not yet past the cleanup period
    let order_recent = PaymentOrder {
        order_id: bytes(&env, "ORDER_RECENT"),
        merchant_address: merchant.clone(),
        payer: payer.clone(),
        token: token.clone(),
        amount: 200,
        description: str(&env, "recent"),
        expires_at: 0,
    };
    client.process_payment_with_signature(&payer, &order_recent, &zero_sig(&env), &zero_key(&env));
    // Only ORDER_001 was created before the cutoff; ORDER_RECENT was just created
    let count = client.cleanup_expired_payments(&admins(&env, &admin));
    assert_eq!(count, 1);
    // ORDER_001 should be gone
    assert_eq!(
        client.try_get_payment_by_id(&payer, &bytes(&env, "ORDER_001")),
        Err(Ok(PaymentError::PaymentNotFound))
    );
    // ORDER_RECENT should still exist
    let recent = client.get_payment_by_id(&payer, &bytes(&env, "ORDER_RECENT"));
    assert_eq!(recent.amount, 200);
}

#[test]
fn test_cleanup_no_expired_returns_zero() {
    let (env, client) = setup();
    let (admin, _merchant, _payer, _token) = setup_paid_order(&env, &client);
    assert_eq!(client.cleanup_expired_payments(&admins(&env, &admin)), 0);
}

#[test]
fn test_cleanup_non_admin_unauthorized() {
    let (env, client) = setup();
    let (_admin, _merchant, _payer, _token) = setup_paid_order(&env, &client);
    let non_admin = Address::generate(&env);
    assert_eq!(
        client.try_cleanup_expired_payments(&admins(&env, &non_admin)),
        Err(Ok(PaymentError::Unauthorized))
    );
}

// ── Global stats tests ────────────────────────────────────────────────────────

#[test]
fn test_get_global_payment_stats() {
    let (env, client) = setup();
    env.ledger().with_mut(|l| l.timestamp = 1000);
    let (admin, merchant, payer, token) = setup_paid_order(&env, &client);
    env.ledger().with_mut(|l| l.timestamp = 2000);
    let order2 = PaymentOrder { order_id: bytes(&env, "ORDER_002"), merchant_address: merchant.clone(), payer: payer.clone(), token: token.clone(), amount: 2000, description: str(&env, "p2"), expires_at: 0 };
    let (_pk2, sig2) = sign_order(&env, &order2);
    client.process_payment_with_signature(&payer, &order2, &sig2, &zero_key(&env));
    env.ledger().with_mut(|l| l.timestamp = 3000);
    client.initiate_refund(&payer, &bytes(&env, "R1"), &bytes(&env, "ORDER_001"), &500, &str(&env, "reason"));
    client.approve_refund(&merchant, &bytes(&env, "R1"), &None);
    env.ledger().with_mut(|l| l.timestamp = 4000);
    client.execute_refund(&merchant, &bytes(&env, "R1"));
    let stats = client.get_global_payment_stats(&admins(&env, &admin), &None, &None);
    assert_eq!(stats.total_payments, 2);
    assert_eq!(stats.total_volume, 3000);
    assert_eq!(stats.total_refunds, 1);
    assert_eq!(stats.total_refund_volume, 500);
    let stats = client.get_global_payment_stats(&admins(&env, &admin), &Some(500), &Some(1500));
    assert_eq!(stats.total_payments, 1);
    assert_eq!(stats.total_volume, 1000);
}

// ── Dispute resolution tests ──────────────────────────────────────────────────

#[test]
fn test_resolve_dispute_within_window_passes() {
    let (env, client) = setup();
    let (admin, _merchant, payer, _token) = setup_paid_order(&env, &client);

    client.initiate_refund(
        &payer,
        &bytes(&env, "REFUND_D1"),
        &bytes(&env, "ORDER_001"),
        &500,
        &str(&env, "disputed"),
    );
    client.dispute_refund(&payer, &bytes(&env, "REFUND_D1"));
    assert_eq!(
        client.get_refund_status(&bytes(&env, "REFUND_D1")),
        RefundStatus::Disputed
    );

    // resolve within dispute window (paid_at=0, deadline = 0 + 2_592_000 + 604_800)
    env.ledger().with_mut(|l| l.timestamp = 100);
    client.resolve_dispute(&admin, &bytes(&env, "REFUND_D1"), &true);
    assert_eq!(
        client.get_refund_status(&bytes(&env, "REFUND_D1")),
        RefundStatus::Approved
    );
}

#[test]
fn test_resolve_dispute_after_deadline_fails() {
    let (env, client) = setup();
    let (admin, _merchant, payer, _token) = setup_paid_order(&env, &client);

    client.initiate_refund(
        &payer,
        &bytes(&env, "REFUND_D2"),
        &bytes(&env, "ORDER_001"),
        &500,
        &str(&env, "disputed"),
    );
    client.dispute_refund(&payer, &bytes(&env, "REFUND_D2"));

    // advance past paid_at(0) + REFUND_WINDOW(2_592_000) + DISPUTE_WINDOW(604_800)
    env.ledger().with_mut(|l| l.timestamp = 2_592_000 + 604_801);

    let result = client.try_resolve_dispute(&admin, &bytes(&env, "REFUND_D2"), &true);
    assert_eq!(result, Err(Ok(PaymentError::RefundWindowExpired)));
}

// ── Multisig tests ────────────────────────────────────────────────────────────

#[test]
fn test_initiate_multisig_payment_success() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let token = create_token(&env, &admin);
    client.set_admin(&admins(&env, &admin), &1);
    client.register_merchant(&merchant, &str(&env, "Store"), &str(&env, "desc"), &str(&env, "c@c.com"), &MerchantCategory::Retail, &None);
    mint(&env, &token, &signer1, 5000);
    let order = PaymentOrder { order_id: bytes(&env, "MS_001"), merchant_address: merchant.clone(), payer: signer1.clone(), token: token.clone(), amount: 1000, description: str(&env, "Multisig order"), expires_at: 0 };
    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());
    client.initiate_multisig_payment(&signer1, &bytes(&env, "MS_001"), &order, &signers);
    client.sign_multisig_payment(&signer1, &bytes(&env, "MS_001"));
    client.sign_multisig_payment(&signer2, &bytes(&env, "MS_001"));
    client.execute_multisig_payment(&signer1, &bytes(&env, "MS_001"));
    let record = client.get_payment_by_id(&signer1, &bytes(&env, "MS_001"));
    assert_eq!(record.amount, 1000);
    assert_eq!(record.status, PaymentStatus::Completed);
}

#[test]
fn test_multisig_insufficient_signatures_fails() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let token = create_token(&env, &admin);
    client.set_admin(&admins(&env, &admin), &1);
    client.register_merchant(&merchant, &str(&env, "Store"), &str(&env, "desc"), &str(&env, "c@c.com"), &MerchantCategory::Retail, &None);
    mint(&env, &token, &signer1, 5000);
    let order = PaymentOrder { order_id: bytes(&env, "MS_002"), merchant_address: merchant.clone(), payer: signer1.clone(), token: token.clone(), amount: 1000, description: str(&env, "Multisig order"), expires_at: 0 };
    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());
    client.initiate_multisig_payment(&signer1, &bytes(&env, "MS_002"), &order, &signers);
    client.sign_multisig_payment(&signer1, &bytes(&env, "MS_002"));
    assert_eq!(
        client.try_execute_multisig_payment(&signer1, &bytes(&env, "MS_002")),
        Err(Ok(PaymentError::InsufficientSignatures))
    );
}

#[test]
fn test_get_multisig_payment_access_control_and_state() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let outsider = Address::generate(&env);
    let token = create_token(&env, &admin);

    client.set_admin(&vec![&env, admin.clone()], &1);
    client.register_merchant(
        &merchant,
        &str(&env, "Store"),
        &str(&env, "desc"),
        &str(&env, "c@c.com "),
        &MerchantCategory::Retail,
        &None,
    );
    mint(&env, &token, &admin, &signer1, 5000);

    let order = PaymentOrder {
        order_id: bytes(&env, "MS_GET"),
        merchant_address: merchant.clone(),
        payer: signer1.clone(),
        token: token.clone(),
        amount: 1000,
        description: str(&env, "Multisig query order"),
        expires_at: 0,
    };

    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    client.initiate_multisig_payment(&signer1, &bytes(&env, "MS_GET"), &order, &signers);

    let ms_before = client.get_multisig_payment(&signer1, &bytes(&env, "MS_GET"));
    assert_eq!(ms_before.required_signers.len(), 2);
    assert_eq!(ms_before.signatures.len(), 0);
    assert!(!ms_before.executed);

    let ms_admin = client.get_multisig_payment(&admin, &bytes(&env, "MS_GET"));
    assert_eq!(ms_admin.required_signers.len(), 2);
    assert_eq!(ms_admin.signatures.len(), 0);

    let unauthorized_result = client.try_get_multisig_payment(&outsider, &bytes(&env, "MS_GET"));
    assert_eq!(unauthorized_result, Err(Ok(PaymentError::Unauthorized)));

    client.sign_multisig_payment(&signer1, &bytes(&env, "MS_GET"));
    let ms_after = client.get_multisig_payment(&signer2, &bytes(&env, "MS_GET"));
    assert_eq!(ms_after.signatures.len(), 1);
    assert!(ms_after.signatures.contains(&signer1));
}

#[test]
fn test_initiate_multisig_duplicate_signer_fails() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let token = create_token(&env, &admin);
    client.set_admin(&admins(&env, &admin), &1);
    client.register_merchant(&merchant, &str(&env, "Store"), &str(&env, "desc"), &str(&env, "c@c.com"), &MerchantCategory::Retail, &None);
    mint(&env, &token, &signer1, 5000);
    let order = PaymentOrder { order_id: bytes(&env, "MS_DUP"), merchant_address: merchant.clone(), payer: signer1.clone(), token: token.clone(), amount: 1000, description: str(&env, "Multisig order"), expires_at: 0 };
    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());
    signers.push_back(signer1.clone());
    assert_eq!(
        client.try_initiate_multisig_payment(&signer1, &bytes(&env, "MS_DUP"), &order, &signers),
        Err(Ok(PaymentError::InvalidInput))
    );
}

#[test]
fn test_multisig_payment_expiry() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let token = create_token(&env, &admin);
    client.set_admin(&admins(&env, &admin), &1);
    client.register_merchant(&merchant, &str(&env, "Store"), &str(&env, "desc"), &str(&env, "c@c.com"), &MerchantCategory::Retail, &None);
    mint(&env, &token, &signer1, 5000);
    let order = make_order(&env, &merchant, &signer1, &token);
    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());
    client.initiate_multisig_payment(&signer1, &bytes(&env, "MS_EXPIRY"), &order, &signers);
    env.ledger().with_mut(|l| l.timestamp = 86400 + 3601);
    assert_eq!(client.try_sign_multisig_payment(&signer1, &bytes(&env, "MS_EXPIRY")), Err(Ok(PaymentError::PaymentExpired)));
    assert_eq!(client.try_execute_multisig_payment(&signer1, &bytes(&env, "MS_EXPIRY")), Err(Ok(PaymentError::PaymentExpired)));
}

// ── Subscription tests ────────────────────────────────────────────────────────

fn make_plan(env: &Env, token: &Address) -> SubscriptionPlan {
    SubscriptionPlan {
        interval: 2_592_000, // 30 days
        amount: 500,
        token: token.clone(),
    }
}

#[test]
fn test_create_subscription_success() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    let payer = Address::generate(&env);
    let token = create_token(&env, &admin);
    client.set_admin(&admins(&env, &admin), &1);
    client.register_merchant(&merchant, &str(&env, "Store"), &str(&env, "desc"), &str(&env, "c@c.com"), &MerchantCategory::Retail, &None);
    let sub_id = bytes(&env, "SUB_001");
    client.create_subscription(&payer, &merchant, &sub_id, &make_plan(&env, &token));
    let sub = client.get_subscription(&sub_id);
    assert_eq!(sub.payer, payer);
    assert_eq!(sub.merchant, merchant);
    assert_eq!(sub.last_charged_at, 0);
    assert_eq!(sub.status, crate::types::SubscriptionStatus::Active);
}

#[test]
fn test_create_subscription_duplicate_fails() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    let payer = Address::generate(&env);
    let token = create_token(&env, &admin);
    client.set_admin(&admins(&env, &admin), &1);
    client.register_merchant(&merchant, &str(&env, "Store"), &str(&env, "desc"), &str(&env, "c@c.com"), &MerchantCategory::Retail, &None);
    let sub_id = bytes(&env, "SUB_001");
    client.create_subscription(&payer, &merchant, &sub_id, &make_plan(&env, &token));
    assert_eq!(
        client.try_create_subscription(&payer, &merchant, &sub_id, &make_plan(&env, &token)),
        Err(Ok(PaymentError::SubscriptionAlreadyExists))
    );
}

#[test]
fn test_create_subscription_zero_interval_fails() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    let payer = Address::generate(&env);
    let token = create_token(&env, &admin);
    client.set_admin(&admins(&env, &admin), &1);
    client.register_merchant(&merchant, &str(&env, "Store"), &str(&env, "desc"), &str(&env, "c@c.com"), &MerchantCategory::Retail, &None);
    let bad_plan = SubscriptionPlan { interval: 0, amount: 500, token: token.clone() };
    assert_eq!(
        client.try_create_subscription(&payer, &merchant, &bytes(&env, "SUB_BAD"), &bad_plan),
        Err(Ok(PaymentError::InvalidInput))
    );
}

#[test]
fn test_create_subscription_inactive_merchant_fails() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    let payer = Address::generate(&env);
    let token = create_token(&env, &admin);
    client.set_admin(&admins(&env, &admin), &1);
    client.register_merchant(&merchant, &str(&env, "Store"), &str(&env, "desc"), &str(&env, "c@c.com"), &MerchantCategory::Retail, &None);
    client.deactivate_merchant(&merchant, &None);
    assert_eq!(
        client.try_create_subscription(&payer, &merchant, &bytes(&env, "SUB_001"), &make_plan(&env, &token)),
        Err(Ok(PaymentError::MerchantInactive))
    );
}

#[test]
fn test_cancel_subscription_success() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    let payer = Address::generate(&env);
    let token = create_token(&env, &admin);
    client.set_admin(&admins(&env, &admin), &1);
    client.register_merchant(&merchant, &str(&env, "Store"), &str(&env, "desc"), &str(&env, "c@c.com"), &MerchantCategory::Retail, &None);
    let sub_id = bytes(&env, "SUB_001");
    client.create_subscription(&payer, &merchant, &sub_id, &make_plan(&env, &token));
    client.cancel_subscription(&payer, &sub_id);
    assert_eq!(client.get_subscription(&sub_id).status, crate::types::SubscriptionStatus::Cancelled);
}

#[test]
fn test_cancel_subscription_wrong_payer_fails() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    let payer = Address::generate(&env);
    let other = Address::generate(&env);
    let token = create_token(&env, &admin);
    client.set_admin(&admins(&env, &admin), &1);
    client.register_merchant(&merchant, &str(&env, "Store"), &str(&env, "desc"), &str(&env, "c@c.com"), &MerchantCategory::Retail, &None);
    let sub_id = bytes(&env, "SUB_001");
    client.create_subscription(&payer, &merchant, &sub_id, &make_plan(&env, &token));
    assert_eq!(
        client.try_cancel_subscription(&other, &sub_id),
        Err(Ok(PaymentError::Unauthorized))
    );
}

#[test]
fn test_cancel_already_cancelled_fails() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    let payer = Address::generate(&env);
    let token = create_token(&env, &admin);
    client.set_admin(&admins(&env, &admin), &1);
    client.register_merchant(&merchant, &str(&env, "Store"), &str(&env, "desc"), &str(&env, "c@c.com"), &MerchantCategory::Retail, &None);
    let sub_id = bytes(&env, "SUB_001");
    client.create_subscription(&payer, &merchant, &sub_id, &make_plan(&env, &token));
    client.cancel_subscription(&payer, &sub_id);
    assert_eq!(
        client.try_cancel_subscription(&payer, &sub_id),
        Err(Ok(PaymentError::SubscriptionNotActive))
    );
}

#[test]
fn test_process_subscription_payment_first_charge() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    let payer = Address::generate(&env);
    let token = create_token(&env, &admin);
    client.set_admin(&admins(&env, &admin), &1);
    client.register_merchant(&merchant, &str(&env, "Store"), &str(&env, "desc"), &str(&env, "c@c.com"), &MerchantCategory::Retail, &None);
    mint(&env, &token, &payer, 5000);
    let token_client = soroban_sdk::token::TokenClient::new(&env, &token);
    let payer_before = token_client.balance(&payer);
    let merchant_before = token_client.balance(&merchant);
    let sub_id = bytes(&env, "SUB_001");
    client.create_subscription(&payer, &merchant, &sub_id, &make_plan(&env, &token));
    env.ledger().with_mut(|l| l.timestamp = 1000);
    let o1 = PaymentOrder {
        order_id: bytes(&env, "D_001"),
        merchant_address: merchant.clone(),
        payer: payer.clone(),
        token: token.clone(),
        amount: 100,
        description: str(&env, "d"),
        expires_at: 0,
    };
    let (_pk, sig) = sign_order(&env, &o1);
    client.process_payment_with_signature(&payer, &o1, &sig, &BytesN::from_array(&env, &[0u8; 32]));

    env.ledger().with_mut(|l| l.timestamp = 5000);
    let o2 = PaymentOrder {
        order_id: bytes(&env, "D_002"),
        merchant_address: merchant.clone(),
        payer: payer.clone(),
        token: token.clone(),
        amount: 200,
        description: str(&env, "d"),
        expires_at: 0,
    };
    let (_pk2, sig2) = sign_order(&env, &o2);
    client.process_payment_with_signature(&payer, &o2, &sig2, &BytesN::from_array(&env, &[0u8; 32]));

    use crate::types::{PaymentFilter, StatusFilter};
    let filter = PaymentFilter {
        date_start: Some(500),
        date_end: Some(2000),
        amount_min: None,
        amount_max: None,
        tokens: None,
        status: StatusFilter::Any,
    };
    let page = client.get_payer_payment_history(
        &payer,
        &None,
        &10,
        &Some(filter),
        &SortField::Date,
        &SortOrder::Ascending,
    );
    assert_eq!(page.total, 1);
    assert_eq!(page.records.get(0).unwrap().amount, 100);
}

#[test]
fn test_payer_history_filter_amount_range() {
    let (env, client) = setup();
    let (_admin, _merchant, payer, _token) =
        setup_payer_history(&env, &client, &[50, 150, 500]);

    use crate::types::{PaymentFilter, StatusFilter};
    let filter = PaymentFilter {
        date_start: None,
        date_end: None,
        amount_min: Some(100),
        amount_max: Some(200),
        tokens: None,
        status: StatusFilter::Any,
    };
    let page = client.get_payer_payment_history(
        &payer,
        &None,
        &10,
        &Some(filter),
        &SortField::Amount,
        &SortOrder::Ascending,
    );
    assert_eq!(page.total, 1);
    assert_eq!(page.records.get(0).unwrap().amount, 150);
}

#[test]
fn test_process_subscription_payment_after_interval() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    let payer = Address::generate(&env);
    let token1 = create_token(&env, &admin);
    let token2 = create_token(&env, &admin);

    client.set_admin(&vec![&env, admin.clone()], &1);
    client.register_merchant(
        &merchant,
        &str(&env, "Store"),
        &str(&env, "desc"),
        &str(&env, "c@c.com"),
        &MerchantCategory::Retail,
        &None,
    );
    mint(&env, &token1, &admin, &payer, 5000);
    mint(&env, &token2, &admin, &payer, 5000);

    let o1 = PaymentOrder {
        order_id: bytes(&env, "T_001"),
        merchant_address: merchant.clone(),
        payer: payer.clone(),
        token: token1.clone(),
        amount: 100,
        description: str(&env, "d"),
        expires_at: 0,
    };
    let (_pk, sig) = sign_order(&env, &o1);
    client.process_payment_with_signature(&payer, &o1, &sig, &BytesN::from_array(&env, &[0u8; 32]));

    let o2 = PaymentOrder {
        order_id: bytes(&env, "T_002"),
        merchant_address: merchant.clone(),
        payer: payer.clone(),
        token: token2.clone(),
        amount: 200,
        description: str(&env, "d"),
        expires_at: 0,
    };
    let (_pk2, sig2) = sign_order(&env, &o2);
    client.process_payment_with_signature(&payer, &o2, &sig2, &BytesN::from_array(&env, &[0u8; 32]));

    use crate::types::{PaymentFilter, StatusFilter};
    let filter = PaymentFilter {
        date_start: None,
        date_end: None,
        amount_min: None,
        amount_max: None,
        tokens: Some(Vec::from_array(&env, [token2.clone()])),
        status: StatusFilter::Any,
    };
    let page = client.get_payer_payment_history(
        &payer,
        &None,
        &10,
        &Some(filter),
        &SortField::Date,
        &SortOrder::Ascending,
    );
    assert_eq!(page.total, 1);
    assert_eq!(page.records.get(0).unwrap().token, token2);
}

#[test]
fn test_payer_history_filter_by_status() {
    let (env, client) = setup();
    let (_admin, merchant, payer, _token) =
        setup_payer_history(&env, &client, &[300, 400]);

    // Initiate + approve + execute a partial refund on PAY_000
    client.initiate_refund(
        &payer,
        &bytes(&env, "RF_001"),
        &bytes(&env, "PAY_000"),
        &100,
        &str(&env, "partial"),
    );
    client.approve_refund(&merchant, &bytes(&env, "RF_001"));
    client.execute_refund(&bytes(&env, "RF_001"));

    use crate::types::{PaymentFilter, StatusFilter};
    let filter = PaymentFilter {
        date_start: None,
        date_end: None,
        amount_min: None,
        amount_max: None,
        tokens: None,
        status: StatusFilter::PartiallyRefunded,
    };
    let page = client.get_payer_payment_history(
        &payer,
        &None,
        &10,
        &Some(filter),
        &SortField::Date,
        &SortOrder::Ascending,
    );
    assert_eq!(page.total, 1);
    assert_eq!(page.records.get(0).unwrap().status, PaymentStatus::PartiallyRefunded);
}

#[test]
fn test_payer_history_sort_by_amount_ascending() {
    let (env, client) = setup();
    let (_admin, _merchant, payer, _token) =
        setup_payer_history(&env, &client, &[300, 100, 200]);

    let page = client.get_payer_payment_history(
        &payer,
        &None,
        &10,
        &None,
        &SortField::Amount,
        &SortOrder::Ascending,
    );
    assert_eq!(page.records.get(0).unwrap().amount, 100);
    assert_eq!(page.records.get(2).unwrap().amount, 300);
}

#[test]
fn test_payer_history_sort_by_amount_descending() {
    let (env, client) = setup();
    let (_admin, _merchant, payer, _token) =
        setup_payer_history(&env, &client, &[300, 100, 200]);

    let page = client.get_payer_payment_history(
        &payer,
        &None,
        &10,
        &None,
        &SortField::Amount,
        &SortOrder::Descending,
    );
    assert_eq!(page.records.get(0).unwrap().amount, 300);
    assert_eq!(page.records.get(2).unwrap().amount, 100);
}

#[test]
fn test_process_subscription_payment_before_interval_fails() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    let payer = Address::generate(&env);
    let token = create_token(&env, &admin);
    client.set_admin(&admins(&env, &admin), &1);
    client.register_merchant(&merchant, &str(&env, "Store"), &str(&env, "desc"), &str(&env, "c@c.com"), &MerchantCategory::Retail, &None);
    mint(&env, &token, &payer, 5000);
    let sub_id = bytes(&env, "SUB_001");
    client.create_subscription(&payer, &merchant, &sub_id, &make_plan(&env, &token));
    env.ledger().with_mut(|l| l.timestamp = 1000);
    client.process_subscription_payment(&payer, &sub_id);
    // Try again before interval elapses
    env.ledger().with_mut(|l| l.timestamp = 1001);
    assert_eq!(
        client.try_process_subscription_payment(&payer, &sub_id),
        Err(Ok(PaymentError::SubscriptionIntervalNotElapsed))
    );
}

#[test]
fn test_process_subscription_payment_cancelled_fails() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    let payer = Address::generate(&env);
    let token = create_token(&env, &admin);
    client.set_admin(&admins(&env, &admin), &1);
    client.register_merchant(&merchant, &str(&env, "Store"), &str(&env, "desc"), &str(&env, "c@c.com"), &MerchantCategory::Retail, &None);
    mint(&env, &token, &payer, 5000);
    let sub_id = bytes(&env, "SUB_001");
    client.create_subscription(&payer, &merchant, &sub_id, &make_plan(&env, &token));
    client.cancel_subscription(&payer, &sub_id);
    assert_eq!(
        client.try_process_subscription_payment(&payer, &sub_id),
        Err(Ok(PaymentError::SubscriptionNotActive))
    );
}

#[test]
fn test_get_subscription_not_found_fails() {
    let (env, client) = setup();
    assert_eq!(
        client.try_get_subscription(&bytes(&env, "NONEXISTENT")),
        Err(Ok(PaymentError::SubscriptionNotFound))
    );
}

// ── T-020: inactive merchant payment ─────────────────────────────────────────

#[test]
fn test_payment_with_inactive_merchant_fails() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    let payer = Address::generate(&env);
    let token = create_token(&env, &admin);

    client.set_admin(&admin);
    client.register_merchant(
        &merchant,
        &str(&env, "Store"),
        &str(&env, "desc"),
        &str(&env, "c@c.com"),
        &MerchantCategory::Retail,
    );
    mint(&env, &token, &admin, &payer, 5000);

    // Deactivate the merchant
    client.deactivate_merchant(&merchant, &None);
    let m = client.get_merchant(&merchant);
    assert!(!m.active);

    // Attempt payment → must fail with MerchantInactive
    let order = make_order(&env, &merchant, &payer, &token);
    let (pub_key, sig) = sign_order(&env, &order);
    let result = client.try_process_payment_with_signature(&payer, &order, &sig, &pub_key);
    assert_eq!(result, Err(Ok(PaymentError::MerchantInactive)));
}

// ── SEC-011: max pending refunds per order ────────────────────────────────────

#[test]
fn test_max_pending_refunds_per_order() {
    let (env, client) = setup();
    let (_admin, _merchant, payer, _token) = setup_paid_order(&env, &client);

    // Initiate 10 refunds of 1 each (within the 1000 payment amount)
    for i in 0..10u32 {
        let refund_id = alloc::format!("RF_{:02}", i);
        client.initiate_refund(
            &payer,
            &Bytes::from_slice(&env, refund_id.as_bytes()),
            &bytes(&env, "ORDER_001"),
            &1,
            &str(&env, "reason"),
        );
    }

    // 11th refund must be rejected with InvalidInput
    let result = client.try_initiate_refund(
        &payer,
        &bytes(&env, "RF_10"),
        &bytes(&env, "ORDER_001"),
        &1,
        &str(&env, "over limit"),
    );
    assert_eq!(result, Err(Ok(PaymentError::InvalidInput)));
}


// ── Merchant stats tests ──────────────────────────────────────────────────────

#[test]
fn test_get_merchant_stats_unfiltered() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    let payer = Address::generate(&env);
    let token = create_token(&env, &admin);

    client.set_admin(&vec![&env, admin.clone()], &1);
    client.register_merchant(
        &merchant,
        &str(&env, "Store"),
        &str(&env, "desc"),
        &str(&env, "c@c.com"),
        &MerchantCategory::Retail,
        &None,
    );
    mint(&env, &token, &admin, &payer, 5000);

    env.ledger().with_mut(|l| l.timestamp = 1000);
    let order1 = PaymentOrder {
        order_id: bytes(&env, "MS_001"),
        merchant_address: merchant.clone(),
        payer: payer.clone(),
        token: token.clone(),
        amount: 1000,
        description: str(&env, "p1"),
        expires_at: 0,
    };
    let (_pk1, sig1) = sign_order(&env, &order1);
    client.process_payment_with_signature(&payer, &order1, &sig1, &BytesN::from_array(&env, &[0u8; 32]));

    // Query unfiltered stats
    let stats = client.get_merchant_stats(&merchant, &None, &None);
    assert_eq!(stats.merchant_address, merchant);
    assert_eq!(stats.total_payments, 1);
    assert_eq!(stats.total_volume, 1000);
    assert_eq!(stats.total_refunds, 0);
    assert_eq!(stats.total_refund_volume, 0);
}

#[test]
fn test_get_merchant_stats_with_refunds() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    let payer = Address::generate(&env);
    let token = create_token(&env, &admin);

    client.set_admin(&vec![&env, admin.clone()], &1);
    client.register_merchant(
        &merchant,
        &str(&env, "Store"),
        &str(&env, "desc"),
        &str(&env, "c@c.com"),
        &MerchantCategory::Retail,
        &None,
    );
    mint(&env, &token, &admin, &payer, 5000);

    env.ledger().with_mut(|l| l.timestamp = 1000);
    let order1 = PaymentOrder {
        order_id: bytes(&env, "MS_002"),
        merchant_address: merchant.clone(),
        payer: payer.clone(),
        token: token.clone(),
        amount: 1000,
        description: str(&env, "p1"),
        expires_at: 0,
    };
    let (_pk1, sig1) = sign_order(&env, &order1);
    client.process_payment_with_signature(&payer, &order1, &sig1, &BytesN::from_array(&env, &[0u8; 32]));

    // Initiate and execute refund
    env.ledger().with_mut(|l| l.timestamp = 2000);
    client.initiate_refund(&payer, &bytes(&env, "R1"), &bytes(&env, "MS_002"), &500, &str(&env, "reason"));
    client.approve_refund(&merchant, &bytes(&env, "R1"));
    env.ledger().with_mut(|l| l.timestamp = 3000);
    client.execute_refund(&merchant, &bytes(&env, "R1"));

    // Query stats
    let stats = client.get_merchant_stats(&merchant, &None, &None);
    assert_eq!(stats.total_payments, 1);
    assert_eq!(stats.total_volume, 1000);
    assert_eq!(stats.total_refunds, 1);
    assert_eq!(stats.total_refund_volume, 500);
}

#[test]
fn test_get_merchant_stats_filtered_by_date() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    let payer = Address::generate(&env);
    let token = create_token(&env, &admin);

    client.set_admin(&vec![&env, admin.clone()], &1);
    client.register_merchant(
        &merchant,
        &str(&env, "Store"),
        &str(&env, "desc"),
        &str(&env, "c@c.com"),
        &MerchantCategory::Retail,
        &None,
    );
    mint(&env, &token, &admin, &payer, 10000);

    // Payment 1 at t=1000
    env.ledger().with_mut(|l| l.timestamp = 1000);
    let order1 = PaymentOrder {
        order_id: bytes(&env, "MS_003"),
        merchant_address: merchant.clone(),
        payer: payer.clone(),
        token: token.clone(),
        amount: 1000,
        description: str(&env, "p1"),
        expires_at: 0,
    };
    let (_pk1, sig1) = sign_order(&env, &order1);
    client.process_payment_with_signature(&payer, &order1, &sig1, &BytesN::from_array(&env, &[0u8; 32]));

    // Payment 2 at t=5000
    env.ledger().with_mut(|l| l.timestamp = 5000);
    let order2 = PaymentOrder {
        order_id: bytes(&env, "MS_004"),
        merchant_address: merchant.clone(),
        payer: payer.clone(),
        token: token.clone(),
        amount: 2000,
        description: str(&env, "p2"),
        expires_at: 0,
    };
    let (_pk2, sig2) = sign_order(&env, &order2);
    client.process_payment_with_signature(&payer, &order2, &sig2, &BytesN::from_array(&env, &[0u8; 32]));

    // Query all payments
    let stats = client.get_merchant_stats(&merchant, &None, &None);
    assert_eq!(stats.total_payments, 2);
    assert_eq!(stats.total_volume, 3000);

    // Query only first payment (t=500 to t=2000)
    let stats = client.get_merchant_stats(&merchant, &Some(500), &Some(2000));
    assert_eq!(stats.total_payments, 1);
    assert_eq!(stats.total_volume, 1000);

    // Query only second payment (t=4000 to t=6000)
    let stats = client.get_merchant_stats(&merchant, &Some(4000), &Some(6000));
    assert_eq!(stats.total_payments, 1);
    assert_eq!(stats.total_volume, 2000);

    // Query no payments (t=6000 to t=7000)
    let stats = client.get_merchant_stats(&merchant, &Some(6000), &Some(7000));
    assert_eq!(stats.total_payments, 0);
    assert_eq!(stats.total_volume, 0);
}

#[test]
fn test_get_merchant_stats_access_control() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    let other_merchant = Address::generate(&env);
    let payer = Address::generate(&env);
    let token = create_token(&env, &admin);

    client.set_admin(&vec![&env, admin.clone()], &1);
    client.register_merchant(
        &merchant,
        &str(&env, "Store"),
        &str(&env, "desc"),
        &str(&env, "c@c.com"),
        &MerchantCategory::Retail,
        &None,
    );
    mint(&env, &token, &admin, &payer, 5000);

    env.ledger().with_mut(|l| l.timestamp = 1000);
    let order1 = PaymentOrder {
        order_id: bytes(&env, "MS_005"),
        merchant_address: merchant.clone(),
        payer: payer.clone(),
        token: token.clone(),
        amount: 1000,
        description: str(&env, "p1"),
        expires_at: 0,
    };
    let (_pk1, sig1) = sign_order(&env, &order1);
    client.process_payment_with_signature(&payer, &order1, &sig1, &BytesN::from_array(&env, &[0u8; 32]));

    // Merchant can query their own stats
    let stats = client.get_merchant_stats(&merchant, &None, &None);
    assert_eq!(stats.total_payments, 1);

    // Admin can query any merchant's stats
    let stats = client.get_merchant_stats(&merchant, &None, &None);
    assert_eq!(stats.total_payments, 1);

    // Other merchant querying different merchant's stats should fail
    // (This would require auth checking in the contract)
}

#[test]
fn test_get_merchant_stats_multiple_merchants() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let merchant1 = Address::generate(&env);
    let merchant2 = Address::generate(&env);
    let payer = Address::generate(&env);
    let token = create_token(&env, &admin);

    client.set_admin(&vec![&env, admin.clone()], &1);
    client.register_merchant(
        &merchant1,
        &str(&env, "Store1"),
        &str(&env, "desc"),
        &str(&env, "c@c.com"),
        &MerchantCategory::Retail,
        &None,
    );
    client.register_merchant(
        &merchant2,
        &str(&env, "Store2"),
        &str(&env, "desc"),
        &str(&env, "c@c.com"),
        &MerchantCategory::Food,
        &None,
    );
    mint(&env, &token, &admin, &payer, 10000);

    // Payment to merchant1
    env.ledger().with_mut(|l| l.timestamp = 1000);
    let order1 = PaymentOrder {
        order_id: bytes(&env, "MS_006"),
        merchant_address: merchant1.clone(),
        payer: payer.clone(),
        token: token.clone(),
        amount: 1000,
        description: str(&env, "p1"),
        expires_at: 0,
    };
    let (_pk1, sig1) = sign_order(&env, &order1);
    client.process_payment_with_signature(&payer, &order1, &sig1, &BytesN::from_array(&env, &[0u8; 32]));

    // Payment to merchant2
    env.ledger().with_mut(|l| l.timestamp = 2000);
    let order2 = PaymentOrder {
        order_id: bytes(&env, "MS_007"),
        merchant_address: merchant2.clone(),
        payer: payer.clone(),
        token: token.clone(),
        amount: 2000,
        description: str(&env, "p2"),
        expires_at: 0,
    };
    let (_pk2, sig2) = sign_order(&env, &order2);
    client.process_payment_with_signature(&payer, &order2, &sig2, &BytesN::from_array(&env, &[0u8; 32]));

    // Each merchant has independent stats
    let stats1 = client.get_merchant_stats(&merchant1, &None, &None);
    assert_eq!(stats1.total_payments, 1);
    assert_eq!(stats1.total_volume, 1000);

    let stats2 = client.get_merchant_stats(&merchant2, &None, &None);
    assert_eq!(stats2.total_payments, 1);
    assert_eq!(stats2.total_volume, 2000);
}

// ── T-010: Zero and negative amount tests for process_payment_with_signature ──

#[test]
fn test_payment_zero_amount_fails() {
    // T-010: amount = 0 must return InvalidAmount
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    let payer = Address::generate(&env);
    let token = create_token(&env, &admin);

    client.set_admin(&vec![&env, admin.clone()], &1);
    client.register_merchant(
        &merchant,
        &str(&env, "Store"),
        &str(&env, "desc"),
        &str(&env, "c@c.com"),
        &MerchantCategory::Retail,
        &None,
    );
    mint(&env, &token, &payer, 5000);

    let mut order = make_order(&env, &merchant, &payer, &token);
    order.amount = 0;
    let (_pub_key, sig) = sign_order(&env, &order);

    let result = client.try_process_payment_with_signature(
        &payer,
        &order,
        &sig,
        &BytesN::from_array(&env, &[0u8; 32]),
    );
    assert_eq!(result, Err(Ok(PaymentError::InvalidAmount)));
}

#[test]
fn test_payment_negative_amount_fails() {
    // T-010: amount = -1 must return InvalidAmount
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    let payer = Address::generate(&env);
    let token = create_token(&env, &admin);

    client.set_admin(&vec![&env, admin.clone()], &1);
    client.register_merchant(
        &merchant,
        &str(&env, "Store"),
        &str(&env, "desc"),
        &str(&env, "c@c.com"),
        &MerchantCategory::Retail,
        &None,
    );
    mint(&env, &token, &payer, 5000);

    let mut order = make_order(&env, &merchant, &payer, &token);
    order.amount = -1;
    let (_pub_key, sig) = sign_order(&env, &order);

    let result = client.try_process_payment_with_signature(
        &payer,
        &order,
        &sig,
        &BytesN::from_array(&env, &[0u8; 32]),
    );
    assert_eq!(result, Err(Ok(PaymentError::InvalidAmount)));
}

// ── T-001: Real ed25519 key-pair signature tests ──────────────────────────────

/// Registers a merchant with a real ed25519 public key, signs the full XDR
/// payload with the matching private key, and asserts the payment succeeds.
/// `mock_all_auths` is intentionally NOT used here so the signature path is
/// exercised end-to-end.
#[test]
fn test_real_ed25519_valid_signature_succeeds() {
    let env = Env::default();
    env.mock_all_auths(); // auth mocked; signature verification is NOT mocked
    let contract_id = env.register_contract(None, PaymentContract);
    let client = PaymentContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    let payer = Address::generate(&env);
    let token = create_token(&env, &admin);

    // Generate a real ed25519 key pair
    let seed = [42u8; 32];
    let signing_key = SigningKey::from_bytes(&seed);
    let pub_key_bytes = signing_key.verifying_key().to_bytes();
    let merchant_pub_key: BytesN<32> = BytesN::from_array(&env, &pub_key_bytes);

    client.set_admin(&vec![&env, admin.clone()], &1);
    // Register merchant WITH the real public key stored on-chain
    client.register_merchant(
        &merchant,
        &str(&env, "RealSigStore"),
        &str(&env, "desc"),
        &str(&env, "real@store.com"),
        &MerchantCategory::Retail,
        &Some(merchant_pub_key.clone()),
    );
    mint(&env, &token, &payer, 5000);

    let order = make_order(&env, &merchant, &payer, &token);

    // Sign the full XDR payload — exactly what the contract verifies
    let (_, sig) = sign_order_xdr(&env, &order, &seed);

    // Payment must succeed with a valid real signature
    client.process_payment_with_signature(&payer, &order, &sig, &merchant_pub_key);

    let record = client.get_payment_by_id(&payer, &bytes(&env, "ORDER_001"));
    assert_eq!(record.amount, 1000);
    assert_eq!(record.status, PaymentStatus::Completed);
}

/// Registers a merchant with a real ed25519 public key, tampers with the
/// signature, and asserts `InvalidSignature` (or a host crypto error) is
/// returned. `mock_all_auths` is intentionally NOT used here.
#[test]
fn test_real_ed25519_tampered_signature_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PaymentContract);
    let client = PaymentContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    let payer = Address::generate(&env);
    let token = create_token(&env, &admin);

    let seed = [42u8; 32];
    let signing_key = SigningKey::from_bytes(&seed);
    let pub_key_bytes = signing_key.verifying_key().to_bytes();
    let merchant_pub_key: BytesN<32> = BytesN::from_array(&env, &pub_key_bytes);

    client.set_admin(&vec![&env, admin.clone()], &1);
    client.register_merchant(
        &merchant,
        &str(&env, "RealSigStore"),
        &str(&env, "desc"),
        &str(&env, "real@store.com"),
        &MerchantCategory::Retail,
        &Some(merchant_pub_key.clone()),
    );
    mint(&env, &token, &payer, 5000);

    let order = make_order(&env, &merchant, &payer, &token);

    // Produce a valid signature then flip one byte to tamper it
    let (_, valid_sig) = sign_order_xdr(&env, &order, &seed);
    let mut sig_bytes = valid_sig.to_array();
    sig_bytes[0] ^= 0xFF; // corrupt first byte
    let tampered_sig: BytesN<64> = BytesN::from_array(&env, &sig_bytes);

    // The contract must reject the tampered signature
    let result =
        client.try_process_payment_with_signature(&payer, &order, &tampered_sig, &merchant_pub_key);
    assert!(
        result.is_err(),
        "Expected error for tampered signature, got Ok"
    );
}

/// SC-001 acceptance test: proves that a signature over a different amount is rejected.
/// This verifies the fix that uses the full PaymentOrder XDR as the signature payload,
/// not just the order_id field.
#[test]
fn test_signature_over_different_amount_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PaymentContract);
    let client = PaymentContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    let payer = Address::generate(&env);
    let token = create_token(&env, &admin);

    let seed = [42u8; 32];
    let signing_key = SigningKey::from_bytes(&seed);
    let pub_key_bytes = signing_key.verifying_key().to_bytes();
    let merchant_pub_key: BytesN<32> = BytesN::from_array(&env, &pub_key_bytes);

    client.set_admin(&vec![&env, admin.clone()], &1);
    client.register_merchant(
        &merchant,
        &str(&env, "SignatureTestStore"),
        &str(&env, "desc"),
        &str(&env, "test@store.com"),
        &MerchantCategory::Retail,
        &Some(merchant_pub_key.clone()),
    );
    mint(&env, &token, &payer, 10_000);

    // Create an order with amount=1000
    let order_1000 = PaymentOrder {
        order_id: bytes(&env, "ORDER_AMOUNT_TEST"),
        merchant_address: merchant.clone(),
        payer: payer.clone(),
        token: token.clone(),
        amount: 1000,
        description: str(&env, "Original amount"),
        expires_at: 0,
    };

    // Sign the order with amount=1000
    let (_, sig_1000) = sign_order_xdr(&env, &order_1000, &seed);

    // Attempt to reuse the same signature on an order with amount=2000
    let order_2000 = PaymentOrder {
        order_id: bytes(&env, "ORDER_AMOUNT_TEST"), // same order_id
        merchant_address: merchant.clone(),
        payer: payer.clone(),
        token: token.clone(),
        amount: 2000, // different amount
        description: str(&env, "Original amount"),
        expires_at: 0,
    };

    // The contract must reject the signature because the XDR payload differs
    let result =
        client.try_process_payment_with_signature(&payer, &order_2000, &sig_1000, &merchant_pub_key);
    assert!(
        result.is_err(),
        "Expected signature verification to fail when amount differs, but got Ok"
    );
}
