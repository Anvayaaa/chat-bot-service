import { Router } from "express";
import mongoose from "mongoose";
import Conversation from "../models/Conversation.model.js";
import Message from "../models/Message.model.js";

const router = Router();

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
  const { tenantId, userId } = req.auth;
  const { id } = req.params;

  if (!mongoose.isValidObjectId(id)) {
    return res.status(404).json({ error: "Conversation not found." });
  }

  const conversation = await Conversation.findOne({ _id: id, tenantId, userId })
    .select("title lastMessageAt")
    .lean();
  if (!conversation) {
    return res.status(404).json({ error: "Conversation not found." });
  }

  const messages = await Message.find({ conversationId: id })
    .sort({ createdAt: 1 })
    .select("role content createdAt")
    .lean();

  res.json({ conversation, messages });
});

export default router;
