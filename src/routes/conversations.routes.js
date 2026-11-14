import { Router } from "express";
import mongoose from "mongoose";
import Conversation from "../models/Conversation.model.js";
import Message from "../models/Message.model.js";
import Action, { toClientAction } from "../models/Action.model.js";

const router = Router();

// Every lookup is limited to the person's own company and their own chats.
const findOwn = (req, id) => Conversation.findOne({ _id: id, tenantId: req.auth.tenantId, userId: req.auth.userId });

router.get("/", async (req, res) => {
  const { tenantId, userId } = req.auth;

  const conversations = await Conversation.find({ tenantId, userId })
    .sort({ lastMessageAt: -1 })
    .limit(30)
    .select("title lastMessageAt")
    .lean();

  res.json({ conversations });
});

router.get("/:id", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ error: "Conversation not found." });
  }

  const conversation = await findOwn(req, req.params.id).select("title lastMessageAt").lean();
  if (!conversation) {
    return res.status(404).json({ error: "Conversation not found." });
  }

  const messages = await Message.find({ conversationId: conversation._id })
    .sort({ createdAt: 1 })
    .select("role content sources actions createdAt")
    .populate("actions")
    .lean();

  res.json({
    conversation,
    messages: messages.map((message) => ({
      id: message._id,
      role: message.role,
      content: message.content,
      sources: message.sources ?? [],
      actions: (message.actions ?? []).filter(Boolean).map(toClientAction),
      createdAt: message.createdAt,
    })),
  });
});

router.delete("/:id", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ error: "Conversation not found." });
  }

  const conversation = await findOwn(req, req.params.id);
  if (!conversation) {
    return res.status(404).json({ error: "Conversation not found." });
  }

  await Promise.all([
    Message.deleteMany({ conversationId: conversation._id }),
    Action.deleteMany({ conversationId: conversation._id, status: { $in: ["pending", "cancelled", "expired"] } }),
    conversation.deleteOne(),
  ]);

  res.json({ deleted: true });
});

export default router;
