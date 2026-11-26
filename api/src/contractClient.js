/**
 * Stellar contract client — thin wrapper around stellar-sdk contract invocation.
 * Reads CONTRACT_ID, STELLAR_NETWORK, STELLAR_RPC_URL from environment.
 */
import { Contract, rpc, TransactionBuilder, Networks, Keypair, StrKey } from "@stellar/stellar-sdk";

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
 * Invoke process_payment_with_signature for a single order and return a
 * structured result instead of throwing. Used by batch submission so a single
 * failing order does not abort the whole batch.
 *
 * @param {object} order - payment order payload
 * @returns {Promise<{success: boolean, result?: any, error?: string}>}
 */
export async function invokePaymentWithSignature(order) {
  try {
    const result = await invoke("process_payment_with_signature", order.args ?? []);
    return { success: true, result };
  } catch (err) {
    return { success: false, error: err?.message ?? String(err) };
  }
}

/**
 * Submit each order as a separate Soroban transaction, collecting per-order
 * success/failure. Never throws for individual order failures; the caller
 * receives a result entry for every order in the input array.
 *
 * @param {Array<object>} orders - array of payment orders
 * @returns {Promise<Array<{success: boolean, result?: any, error?: string}>>}
 */
export async function batchInvoke(orders = []) {
  const results = [];
  for (const order of orders) {
    results.push(await invokePaymentWithSignature(order));
  }
  return results;
}

async function _sourceAccount() {
  const keypair = SOURCE_SECRET ? Keypair.fromSecret(SOURCE_SECRET) : Keypair.random();
  return server().getAccount(keypair.publicKey()).catch(() => ({ accountId: () => keypair.publicKey(), sequenceNumber: () => "0", incrementSequenceNumber: () => {} }));
}

/**
 * Validate that a value is a well-formed Stellar Ed25519 public key (G-address).
 * @param {unknown} address
 * @returns {boolean}
 */
export function validateStellarAddress(address) {
  if (typeof address !== "string") return false;
  try {
    return StrKey.isValidEd25519PublicKey(address);
  } catch {
    return false;
  }
}

export class ContractError extends Error {
  constructor(message) {
    super(message);
    this.name = "ContractError";
  }
}
