/**
 * Stellar contract client — thin wrapper around stellar-sdk contract invocation.
 * Reads CONTRACT_ID, STELLAR_NETWORK, STELLAR_RPC_URL from environment.
 */
import {
  Contract,
  rpc,
  TransactionBuilder,
  Networks,
  Keypair,
  nativeToScVal,
} from "@stellar/stellar-sdk";

const CONTRACT_ID = process.env.CONTRACT_ID;
const NETWORK = process.env.STELLAR_NETWORK || "testnet";
const RPC_URL = process.env.STELLAR_RPC_URL || "https://soroban-testnet.stellar.org";
const SOURCE_SECRET = process.env.SOURCE_SECRET_KEY;

const NETWORK_PASSPHRASE =
  NETWORK === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;

let _server;
function server() {
  if (!_server) _server = new rpc.Server(RPC_URL);
  return _server;
}

/**
 * Invoke a read-only (view) contract function.
 */
export async function view(fn, args = []) {
  const contract = new Contract(CONTRACT_ID);
  const op = contract.call(fn, ...args);
  const result = await server().simulateTransaction(
    new TransactionBuilder(await _sourceAccount(), { fee: "100", networkPassphrase: NETWORK_PASSPHRASE })
      .addOperation(op)
      .setTimeout(30)
      .build()
  );
  if (rpc.Api.isSimulationError(result)) {
    throw new ContractError(result.error);
  }
  return result.result?.retval;
}

/**
 * Invoke a state-mutating contract function.
 */
export async function invoke(fn, args = []) {
  const keypair = Keypair.fromSecret(SOURCE_SECRET);
  const contract = new Contract(CONTRACT_ID);
  const account = await server().getAccount(keypair.publicKey());
  const op = contract.call(fn, ...args);

  let tx = new TransactionBuilder(account, { fee: "1000000", networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(op)
    .setTimeout(30)
    .build();

  const sim = await server().simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new ContractError(sim.error);

  tx = rpc.assembleTransaction(tx, sim).build();
  tx.sign(keypair);

  const sendResult = await server().sendTransaction(tx);
  if (sendResult.status === "ERROR") throw new ContractError(sendResult.errorResult?.result().toString());

  // Poll for result
  let getResult;
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    getResult = await server().getTransaction(sendResult.hash);
    if (getResult.status !== rpc.Api.GetTransactionStatus.NOT_FOUND) break;
  }
  if (getResult.status === rpc.Api.GetTransactionStatus.FAILED) {
    throw new ContractError("Transaction failed");
  }
  return getResult.returnValue;
}

/**
 * Fetch a page of refunds using cursor-based pagination.
 *
 * Mirrors the payment history pagination pattern: pass the cursor returned by
 * the previous page (or `null`/`undefined` for the first page) and a page size.
 * Returns the raw contract page result, which callers should treat as
 * `{ items, next_cursor }`.
 *
 * @param {string|null} [cursor] - Opaque cursor from the previous page.
 * @param {number} [limit] - Maximum number of refunds to return.
 */
export async function getRefundPage(cursor = null, limit = 20) {
  const args = [];
  if (cursor != null) {
    args.push(nativeToScVal(cursor, { type: "string" }));
  } else {
    args.push(nativeToScVal(null));
  }
  args.push(nativeToScVal(limit, { type: "u32" }));
  return view("get_refund_page", args);
}

/**
 * @deprecated `get_all_refunds` performs an unbounded scan and has been
 * replaced by {@link getRefundPage}. This wrapper is kept only for backwards
 * compatibility and will be removed in a future release.
 */
export async function getAllRefunds() {
  // eslint-disable-next-line no-console
  console.warn(
    "getAllRefunds is deprecated and performs an unbounded scan; use getRefundPage(cursor, limit) instead."
  );
  return view("get_all_refunds");
}

async function _sourceAccount() {
  const keypair = SOURCE_SECRET ? Keypair.fromSecret(SOURCE_SECRET) : Keypair.random();
  return server().getAccount(keypair.publicKey()).catch(() => ({ accountId: () => keypair.publicKey(), sequenceNumber: () => "0", incrementSequenceNumber: () => {} }));
}

export class ContractError extends Error {
  constructor(message) {
    super(message);
    this.name = "ContractError";
  }
}
