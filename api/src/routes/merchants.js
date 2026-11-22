import { Router } from "express";
import { nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { invoke, view } from "../contractClient.js";

const router = Router();

/**
 * POST /api/merchants
 * Body: { merchant_address, name, description, contact_info, category }
 */
router.post("/", async (req, res, next) => {
  try {
    const { merchant_address, name, description, contact_info, category } = req.body;
    if (!merchant_address || !name || !description || !contact_info || !category) {
      return res.status(422).json({ error: { code: "InvalidInput", message: "Missing required fields" } });
    }
    console.log(JSON.stringify({
      level: "info",
      message: "Registering merchant",
      requestId: req.id,
      merchantAddress: merchant_address,
    }));
    await invoke("register_merchant", [
      nativeToScVal(merchant_address, { type: "address" }),
      nativeToScVal(name, { type: "string" }),
      nativeToScVal(description, { type: "string" }),
      nativeToScVal(contact_info, { type: "string" }),
      xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(category)]),
      xdr.ScVal.scvVoid(),
    ], { requestId: req.id });
    res.status(201).json({ message: "Merchant registered" });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/merchants/:id
 */
router.get("/:id", async (req, res, next) => {
  try {
    console.log(JSON.stringify({
      level: "info",
      message: "Fetching merchant",
      requestId: req.id,
      merchantId: req.params.id,
    }));
    const result = await view("get_merchant", [
      nativeToScVal(req.params.id, { type: "address" }),
    ], { requestId: req.id });
    res.json(scValToNative(result));
  } catch (err) {
    next(err);
  }
});

export default router;