import { Router } from "express";
import rateLimit from "express-rate-limit";
import { nativeToScVal, scValToNative, xdr } from "@stellar/stellar-sdk";
import { invoke, view, validateStellarAddress } from "../contractClient.js";

const router = Router();

const PAYMENTS_RPM = parseInt(process.env.RATE_LIMIT_PAYMENTS_RPM, 10) || 20;

const paymentsLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: PAYMENTS_RPM,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next, options) => {
    const resetTime = req.rateLimit?.resetTime;
    const retryAfter = resetTime
      ? Math.max(0, Math.ceil((new Date(resetTime).getTime() - Date.now()) / 1000))
      : Math.ceil(options.windowMs / 1000);
    res.set("Retry-After", String(retryAfter));
    res.status(429).json({
      error: { code: "TooManyRequests", message: "Too many payment requests, please retry later" },
    });
  },
});

/**
 * POST /api/payments
 * Body: { payer, order: { order_id, merchant_address, payer, token, amount, description, expires_at }, signature }
 */
router.post("/", paymentsLimiter, async (req, res, next) => {
  try {
    const { payer, order, signature } = req.body;
    if (!payer || !order || !signature) {
      return res.status(422).json({ error: { code: "InvalidInput", message: "Missing required fields" } });
    }
    const addressFields = [
      ["payer", payer],
      ["order.merchant_address", order.merchant_address],
      ["order.payer", order.payer],
      ["order.token", order.token],
    ];
    for (const [field, value] of addressFields) {
      if (!validateStellarAddress(value)) {
        return res.status(422).json({ error: { code: "InvalidAddress", message: `${field} is not a valid Stellar address` } });
      }
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
      return res.status(422).json({ error: { code: "InvalidInput", message: "caller query param required" } });
    }
    if (!validateStellarAddress(caller)) {
      return res.status(422).json({ error: { code: "InvalidAddress", message: "caller is not a valid Stellar address" } });
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
      return res.status(422).json({ error: { code: "InvalidInput", message: "merchant query param required" } });
    }
    if (!validateStellarAddress(merchant)) {
      return res.status(422).json({ error: { code: "InvalidAddress", message: "merchant is not a valid Stellar address" } });
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
