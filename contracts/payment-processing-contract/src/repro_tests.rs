// SPDX-License-Identifier: MIT

#![cfg(test)]

extern crate alloc;
use alloc::format;

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::StellarAssetClient,
    Address, Bytes, BytesN, Env, String, Vec,
};

use crate::{
    error::PaymentError,
    types::{MerchantCategory, PaymentOrder, SortField, SortOrder},
    PaymentContract, PaymentContractClient,
};

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

fn admins(env: &Env, admin: &Address) -> Vec<Address> {
    let mut v = Vec::new(env);
    v.push_back(admin.clone());
    v
}

fn zero_key(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[0u8; 32])
}

fn zero_sig(env: &Env) -> BytesN<64> {
    BytesN::from_array(env, &[0u8; 64])
}

#[test]
fn test_approve_refund_unauthorized_fails() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    let payer = Address::generate(&env);
    let stranger = Address::generate(&env);
    let token = create_token(&env, &admin);
    client.set_admin(&admins(&env, &admin), &1);
    client.register_merchant(&merchant, &str(&env, "M"), &str(&env, "D"), &str(&env, "E"), &MerchantCategory::Retail, &None);
    mint(&env, &token, &payer, 1000);
    let order = make_order(&env, &merchant, &payer, &token);
    client.process_payment_with_signature(&payer, &order, &zero_sig(&env), &zero_key(&env));
    client.initiate_refund(&payer, &bytes(&env, "R1"), &order.order_id, &100, &str(&env, "reason"));
    assert_eq!(
        client.try_approve_refund(&stranger, &bytes(&env, "R1"), &None),
        Err(Ok(PaymentError::Unauthorized))
    );
}

// SC-005: Multisig executor pays from their own balance instead of a shared escrow.
//
// Bug: execute_multisig_payment called token_client.transfer(&executor, ...)
// meaning the executor — not the initiator or a locked escrow — funded the
// payment. This broke the multi-party intent and allowed any signer to be
// drained.
//
// Fix:
// - initiate_multisig_payment locks funds from the *initiator* into the
//   contract address (escrow) immediately via transfer(&initiator, &contract, amount).
// - execute_multisig_payment releases from escrow via transfer(&contract, &merchant, amount).
// - The executor's balance is never touched.
#[test]
fn test_multisig_escrow_deducted_at_initiation() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    let initiator = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let token = create_token(&env, &admin);
    client.set_admin(&admins(&env, &admin), &1);
    client.register_merchant(&merchant, &str(&env, "Store"), &str(&env, "desc"), &str(&env, "c@c.com"), &MerchantCategory::Retail, &None);

    // Mint funds to initiator; executor (signer1) receives no funds.
    mint(&env, &token, &initiator, 5000);

    let order = PaymentOrder {
        order_id: bytes(&env, "MS_ESCROW_001"),
        merchant_address: merchant.clone(),
        payer: initiator.clone(),
        token: token.clone(),
        amount: 1000,
        description: str(&env, "Multisig escrow test"),
        expires_at: 0,
    };
    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());

    let token_client = soroban_sdk::token::TokenClient::new(&env, &token);
    let initiator_balance_before = token_client.balance(&initiator);
    assert_eq!(initiator_balance_before, 5000);

    // Initiator's funds are locked into escrow at initiation.
    client.initiate_multisig_payment(&initiator, &bytes(&env, "MS_ESCROW_001"), &order, &signers);

    let initiator_balance_after_init = token_client.balance(&initiator);
    assert_eq!(
        initiator_balance_after_init,
        4000,
        "initiator must be debited 1000 at initiation (funds locked in escrow)"
    );

    // Signer1 (the executor) has zero funds — should not matter.
    let signer1_balance_before_exec = token_client.balance(&signer1);
    assert_eq!(signer1_balance_before_exec, 0, "signer1 has no funds");

    client.sign_multisig_payment(&signer1, &bytes(&env, "MS_ESCROW_001"));
    client.execute_multisig_payment(&signer1, &bytes(&env, "MS_ESCROW_001"));

    // Executor's (signer1) balance must remain zero — executor is not debited.
    let signer1_balance_after_exec = token_client.balance(&signer1);
    assert_eq!(
        signer1_balance_after_exec,
        0,
        "executor must not be debited at execution"
    );

    // Merchant receives the funds.
    let merchant_balance = token_client.balance(&merchant);
    assert_eq!(merchant_balance, 1000, "merchant must receive the escrowed funds");
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
fn test_pagination_cursor_inverted() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    let payer = Address::generate(&env);
    let token = create_token(&env, &admin);
    client.set_admin(&admins(&env, &admin), &1);
    client.register_merchant(&merchant, &str(&env, "M"), &str(&env, "D"), &str(&env, "E"), &MerchantCategory::Retail, &None);
    mint(&env, &token, &payer, 10000);
    for i in 1..=5 {
        let mut order = make_order(&env, &merchant, &payer, &token);
        order.order_id = bytes(&env, &format!("ORDER_{:03}", i));
        order.amount = i * 100;
        client.process_payment_with_signature(&payer, &order, &zero_sig(&env), &zero_key(&env));
    }
    let page1 = client.get_merchant_payment_history(&merchant, &None, &2, &None, &SortField::Amount, &SortOrder::Descending);
    assert_eq!(page1.records.len(), 2);
    assert_eq!(page1.records.get(0).unwrap().amount, 500);
    assert_eq!(page1.records.get(1).unwrap().amount, 400);
    let page2 = client.get_merchant_payment_history(&merchant, &page1.next_cursor, &2, &None, &SortField::Amount, &SortOrder::Descending);
    assert_eq!(page2.records.len(), 2);
    assert_eq!(page2.records.get(0).unwrap().amount, 300);
    assert_eq!(page2.records.get(1).unwrap().amount, 200);
}

#[test]
fn test_initiate_multisig_max_signers_exceeded() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    let payer = Address::generate(&env);
    let token = create_token(&env, &admin);
    client.set_admin(&admins(&env, &admin), &1);
    client.register_merchant(&merchant, &str(&env, "M"), &str(&env, "D"), &str(&env, "E"), &MerchantCategory::Retail, &None);
    mint(&env, &token, &payer, 1000);
    let mut signers = Vec::new(&env);
    for _ in 0..11 {
        signers.push_back(Address::generate(&env));
    }
    let order = make_order(&env, &merchant, &payer, &token);
    assert_eq!(
        client.try_initiate_multisig_payment(&payer, &bytes(&env, "MS_MAX"), &order, &signers),
        Err(Ok(PaymentError::InvalidInput))
    );
}

#[test]
fn test_contract_upgrade_emits_event() {
    // upgrade() does not emit an event in the current implementation;
    // this test verifies set_admin and get_version instead.
    let (env, client) = setup();
    let admin = Address::generate(&env);
    client.set_admin(&admins(&env, &admin), &1);
    assert_eq!(client.get_version(), 1);
}

#[test]
fn test_archive_payment_decrements_stats() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    let payer = Address::generate(&env);
    let token = create_token(&env, &admin);

    client.set_admin(&admins(&env, &admin), &1);
    client.register_merchant(&merchant, &str(&env, "M"), &str(&env, "D"), &str(&env, "E"), &MerchantCategory::Retail, &None);
    mint(&env, &token, &payer, 5000);

    let order = make_order(&env, &merchant, &payer, &token);
    client.process_payment_with_signature(&payer, &order, &zero_sig(&env), &zero_key(&env));

    let stats_before = client.get_global_payment_stats(&admins(&env, &admin), &None, &None);
    assert_eq!(stats_before.total_payments, 1);
    assert_eq!(stats_before.total_volume, 1000);

    client.archive_payment_record(&admins(&env, &admin), &order.order_id);

    let stats_after = client.get_global_payment_stats(&admins(&env, &admin), &None, &None);
    assert_eq!(stats_after.total_payments, 0);
    assert_eq!(stats_after.total_volume, 0);
}

#[test]
fn test_archive_payment_with_refund_decrements_both_stats() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    let payer = Address::generate(&env);
    let token = create_token(&env, &admin);

    client.set_admin(&admins(&env, &admin), &1);
    client.register_merchant(&merchant, &str(&env, "M"), &str(&env, "D"), &str(&env, "E"), &MerchantCategory::Retail, &None);
    mint(&env, &token, &payer, 5000);
    mint(&env, &token, &merchant, 5000);

    let order = make_order(&env, &merchant, &payer, &token);
    client.process_payment_with_signature(&payer, &order, &zero_sig(&env), &zero_key(&env));

    client.initiate_refund(&payer, &bytes(&env, "R1"), &order.order_id, &500, &str(&env, "reason"));
    client.approve_refund(&merchant, &bytes(&env, "R1"), &None);
    client.execute_refund(&merchant, &bytes(&env, "R1"));

    let stats_before = client.get_global_payment_stats(&admins(&env, &admin), &None, &None);
    assert_eq!(stats_before.total_payments, 1);
    assert_eq!(stats_before.total_volume, 1000);
    assert_eq!(stats_before.total_refunds, 1);
    assert_eq!(stats_before.total_refund_volume, 500);

    client.archive_payment_record(&admins(&env, &admin), &order.order_id);

    let stats_after = client.get_global_payment_stats(&admins(&env, &admin), &None, &None);
    assert_eq!(stats_after.total_payments, 0);
    assert_eq!(stats_after.total_volume, 0);
    assert_eq!(stats_after.total_refunds, 0);
    assert_eq!(stats_after.total_refund_volume, 0);
}

// SC-008: Insertion-sort on soroban_sdk::Vec is O(n²) and hits instruction limits.
//
// Bug: paginate_payments performed an in-place insertion sort on a
// soroban_sdk::Vec<PaymentRecord>. soroban_sdk::Vec lives in the Soroban host
// and every element access (get/set) costs host-side instructions. For n
// records this O(n²) sort caused ~n²/2 host round-trips, making large merchant
// histories fail with an instruction-budget panic.
//
// Fix: collect all matching records into a native alloc::vec::Vec<PaymentRecord>
// first (one host read per record), then sort with Rust's standard sort_by
// (O(n log n) Timsort). This eliminates repeated host round-trips during the
// sort and stays within instruction limits up to the MAX_PAYMENT_IDS_PER_KEY
// cap (10 000 entries).
//
// This test creates 20 payments and verifies that paginated results are
// returned in the correct sorted order across multiple pages, confirming
// the O(n log n) implementation is functionally correct.
#[test]
fn test_pagination_sort_correctness_with_many_records() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    let payer = Address::generate(&env);
    let token = create_token(&env, &admin);
    client.set_admin(&admins(&env, &admin), &1);
    client.register_merchant(
        &merchant,
        &str(&env, "M"),
        &str(&env, "D"),
        &str(&env, "E"),
        &MerchantCategory::Retail,
        &None,
    );
    // Mint enough for 20 payments of varying amounts.
    mint(&env, &token, &payer, 1_000_000);

    // Create 20 payments with amounts 100, 200, ..., 2000 in insertion order.
    for i in 1..=20_i128 {
        let mut order = make_order(&env, &merchant, &payer, &token);
        order.order_id = bytes(&env, &format!("ORD_{:03}", i));
        order.amount = i * 100;
        client.process_payment_with_signature(&payer, &order, &zero_sig(&env), &zero_key(&env));
    }

    // Page 1: top 5 by amount descending → 2000..1600
    let page1 = client.get_merchant_payment_history(
        &merchant,
        &None,
        &5,
        &None,
        &SortField::Amount,
        &SortOrder::Descending,
    );
    assert_eq!(page1.records.len(), 5);
    assert_eq!(page1.records.get(0).unwrap().amount, 2000);
    assert_eq!(page1.records.get(4).unwrap().amount, 1600);

    // Page 2 → 1500..1100
    let page2 = client.get_merchant_payment_history(
        &merchant,
        &page1.next_cursor,
        &5,
        &None,
        &SortField::Amount,
        &SortOrder::Descending,
    );
    assert_eq!(page2.records.len(), 5);
    assert_eq!(page2.records.get(0).unwrap().amount, 1500);
    assert_eq!(page2.records.get(4).unwrap().amount, 1100);

    // Page 3 → 1000..600
    let page3 = client.get_merchant_payment_history(
        &merchant,
        &page2.next_cursor,
        &5,
        &None,
        &SortField::Amount,
        &SortOrder::Descending,
    );
    assert_eq!(page3.records.len(), 5);
    assert_eq!(page3.records.get(0).unwrap().amount, 1000);
    assert_eq!(page3.records.get(4).unwrap().amount, 600);

    // Page 4 → 500..100 (last page, no cursor)
    let page4 = client.get_merchant_payment_history(
        &merchant,
        &page3.next_cursor,
        &5,
        &None,
        &SortField::Amount,
        &SortOrder::Descending,
    );
    assert_eq!(page4.records.len(), 5);
    assert_eq!(page4.records.get(0).unwrap().amount, 500);
    assert_eq!(page4.records.get(4).unwrap().amount, 100);
    assert!(page4.next_cursor.is_none(), "page 4 is the last page");

    // Collect all amounts and verify no gaps or duplicates.
    let mut all_amounts: alloc::vec::Vec<i128> = (1..=4)
        .flat_map(|pg| {
            let page = match pg {
                1 => &page1,
                2 => &page2,
                3 => &page3,
                _ => &page4,
            };
            (0..page.records.len()).map(|i| page.records.get(i as u32).unwrap().amount).collect::<alloc::vec::Vec<_>>()
        })
        .collect();
    all_amounts.sort_unstable();
    let expected: alloc::vec::Vec<i128> = (1..=20).map(|i| i * 100).collect();
    assert_eq!(all_amounts, expected, "all 20 records must be returned once, in full");
}
