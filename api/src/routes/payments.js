import { Router } from "express";
import { nativeToScVal, scValToNative, xdr } from "@stellar/stellar-sdk";
import { invoke, view } from "../contractClient.js";
import { ApiError } from "../errors.js";

const router = Router();

/**
 * POST /api/payments
 * Body: { payer, order: { order_id, merchant_address, payer, token, amount, description, expires_at }, signature }
 */
router.post("/", async (req, res, next) => {
  try {
    const { payer, order, signature } = req.body;
    if (!payer || !order || !signature) {
      throw new ApiError(422, "InvalidInput", "Missing required fields");
    }
    await invoke("process_payment_with_signature", [
      nativeToScVal(payer, { type: "address" }),
      orderToScVal(order),
      nativeToScVal(Buffer.from(signature, "hex"), { type: "bytes" }),
    ]);
    res.status(201).json({ message: "Payment processed" });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/payments/:id
 * Query: { caller }
 */
router.get("/:id", async (req, res, next) => {
  try {
    const { caller } = req.query;
    if (!caller) {
      throw new ApiError(422, "InvalidInput", "caller query param required");
    }
    const result = await view("get_payment_by_id", [
      nativeToScVal(caller, { type: "address" }),
      nativeToScVal(Buffer.from(req.params.id), { type: "bytes" }),
    ]);
    res.json(scValToNative(result));
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/payments
 * Query: { merchant, cursor, limit, date_start, date_end, amount_min, amount_max, status, sort_field, sort_order }
 */
router.get("/", async (req, res, next) => {
  try {
    const { merchant, cursor, limit = 10, date_start, date_end, amount_min, amount_max, status = "Any", sort_field = "Date", sort_order = "Descending" } = req.query;
    if (!merchant) {
      throw new ApiError(422, "InvalidInput", "merchant query param required");
    }

    const filter = buildFilter({ date_start, date_end, amount_min, amount_max, status });

    const result = await view("get_merchant_payment_history", [
      nativeToScVal(merchant, { type: "address" }),
      cursor ? nativeToScVal(Buffer.from(cursor), { type: "bytes" }) : xdr.ScVal.scvVoid(),
      nativeToScVal(parseInt(limit, 10), { type: "u32" }),
      filter,
      xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(sort_field)]),
      xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(sort_order)]),
    ]);
    res.json(scValToNative(result));
  } catch (err) {
    next(err);
  }
});

function orderToScVal(order) {
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("order_id"), val: nativeToScVal(Buffer.from(order.order_id), { type: "bytes" }) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("merchant_address"), val: nativeToScVal(order.merchant_address, { type: "address" }) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("payer"), val: nativeToScVal(order.payer, { type: "address" }) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("token"), val: nativeToScVal(order.token, { type: "address" }) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("amount"), val: nativeToScVal(BigInt(order.amount), { type: "i128" }) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("description"), val: nativeToScVal(order.description, { type: "string" }) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("expires_at"), val: nativeToScVal(BigInt(order.expires_at ?? 0), { type: "u64" }) }),
  ]);
}

function buildFilter({ date_start, date_end, amount_min, amount_max, status }) {
  const none = xdr.ScVal.scvVoid();
  const opt = (val, type) => val != null ? nativeToScVal(BigInt(val), { type }) : none;
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("date_start"), val: opt(date_start, "u64") }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("date_end"), val: opt(date_end, "u64") }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("amount_min"), val: opt(amount_min, "i128") }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("amount_max"), val: opt(amount_max, "i128") }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("token"), val: none }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("status"), val: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(status)]) }),
  ]);
}

export default router;
