import { Router } from "express";
import mongoose from "mongoose";
import Action, { toClientAction } from "../models/Action.model.js";
import { executeAction } from "../tools/index.js";
import { CrmError } from "../crm/crmClient.js";

const router = Router();

// Why a proposal can no longer be confirmed or cancelled, in plain words.
const notOpen = (action) => {
  if (!action) return { status: 404, error: "That proposal was not found." };
  if (action.status === "done") return { status: 409, error: "That change was already made." };
  if (action.status === "running") return { status: 409, error: "That change is already being made." };
  if (action.status === "cancelled") return { status: 409, error: "That proposal was cancelled." };
  return { status: 409, error: "That proposal expired. Ask the assistant again." };
};

// Claims the proposal in one step (pending -> next status) so two clicks, or
// two tabs, can never make the same change twice.
const claim = (req, nextStatus) =>
  Action.findOneAndUpdate(
    {
      _id: req.params.id,
      tenantId: req.auth.tenantId,
      userId: req.auth.userId,
      status: "pending",
      expiresAt: { $gt: new Date() },
    },
    { $set: { status: nextStatus, decidedAt: new Date() } },
    { returnDocument: "after" },
  );

const refuse = async (req, res) => {
  const action = await Action.findOne({ _id: req.params.id, tenantId: req.auth.tenantId, userId: req.auth.userId });
  if (action?.status === "pending") {
    action.status = "expired";
    await action.save();
  }
  const { status, error } = notOpen(action);
  return res.status(status).json({ error, action: action ? toClientAction(action) : undefined });
};

router.param("id", (req, res, next, id) => {
  if (!mongoose.isValidObjectId(id)) return res.status(404).json({ error: "That proposal was not found." });
  return next();
});

// POST /v1/actions/:id/confirm — the person clicked Confirm. Only now does
// anything change in the CRM, and only exactly what the card showed.
router.post("/:id/confirm", async (req, res) => {
  const action = await claim(req, "running");
  if (!action) return refuse(req, res);

  try {
    const result = await executeAction(action, req.auth);
    action.status = "done";
    action.result = result;
  } catch (error) {
    action.status = "failed";
    action.result = {
      message: error instanceof CrmError ? error.message : "The change could not be made. Please try again from the app.",
    };
    if (!(error instanceof CrmError)) console.error("Action failed:", error);
  }

  await action.save();
  return res.json({ action: toClientAction(action) });
});

router.post("/:id/cancel", async (req, res) => {
  const action = await claim(req, "cancelled");
  if (!action) return refuse(req, res);
  return res.json({ action: toClientAction(action) });
});

export default router;
