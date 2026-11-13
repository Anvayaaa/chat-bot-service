import { Router } from "express";
import mongoose from "mongoose";
import Conversation from "../models/Conversation.model.js";
import Message from "../models/Message.model.js";
import { streamChat } from "../llm/index.js";
import { buildSystemPrompt } from "../llm/systemPrompt.js";

const router = Router();

const HISTORY_LIMIT = 20;
const MAX_MESSAGE_LENGTH = 4000;

router.post("/", async (req, res) => {
  const { tenantId, userId } = req.auth;
  const text = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  const { conversationId } = req.body ?? {};

  if (!text) {
    return res.status(400).json({ error: "Message is empty." });
  }
  if (text.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ error: `Message is too long (max ${MAX_MESSAGE_LENGTH} characters).` });
  }

  let conversation;
  if (conversationId) {
    if (!mongoose.isValidObjectId(conversationId)) {
      return res.status(404).json({ error: "Conversation not found." });
    }
    conversation = await Conversation.findOne({ _id: conversationId, tenantId, userId });
    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found." });
    }
  } else {
    conversation = await Conversation.create({ tenantId, userId, title: text.slice(0, 80) });
  }

  await Message.create({ conversationId: conversation._id, tenantId, role: "user", content: text });

  const recent = await Message.find({ conversationId: conversation._id })
    .sort({ createdAt: -1 })
    .limit(HISTORY_LIMIT)
    .lean();

  const messages = [
    { role: "system", content: buildSystemPrompt() },
    ...recent.reverse().map((m) => ({ role: m.role, content: m.content })),
  ];

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  send("meta", { conversationId: conversation._id });

  let reply = "";
  let usage;

  try {
    for await (const part of streamChat({ messages })) {
      if (part.type === "text") {
        reply += part.text;
        send("delta", { text: part.text });
      } else if (part.type === "usage") {
        usage = part.usage;
      }
    }

    await Message.create({
      conversationId: conversation._id,
      tenantId,
      role: "assistant",
      content: reply || "(empty reply)",
      usage,
    });
    await Conversation.updateOne({ _id: conversation._id }, { lastMessageAt: new Date() });

    send("done", { usage });
  } catch (error) {
    console.error("Chat stream error:", error);
    const message =
      error.status === 429
        ? "The assistant is busy right now. Please try again in a minute."
        : "The assistant couldn't reply. Please try again.";
    send("error", { message });
  }

  res.end();
});

export default router;
