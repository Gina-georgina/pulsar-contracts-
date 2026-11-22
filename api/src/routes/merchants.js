import { Router } from "express";
import { nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { invoke, view } from "../contractClient.js";
import { ApiError } from "../errors.js";

const router = Router();

/**
 * POST /api/merchants
 * Body: { merchant_address, name, description, contact_info, category }
 */
router.post("/", async (req, res, next) => {
  try {
    const { merchant_address, name, description, contact_info, category } = req.body;
    if (!merchant_address || !name || !description || !contact_info || !category) {
      return next(
        new ApiError("InvalidInput", "Missing required fields", 422)
      );
    }
    await invoke("register_merchant", [
      nativeToScVal(merchant_address, { type: "address" }),
      nativeToScVal(name, { type: "string" }),
      nativeToScVal(description, { type: "string" }),
      nativeToScVal(contact_info, { type: "string" }),
      xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(category)]),
      xdr.ScVal.scvVoid(),
    ]);
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
    const result = await view("get_merchant", [
      nativeToScVal(req.params.id, { type: "address" }),
    ]);
    res.json(scValToNative(result));
  } catch (err) {
    next(err);
  }
});

export default router;