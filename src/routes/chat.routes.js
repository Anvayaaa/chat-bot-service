import { Router } from "express";
import mongoose from "mongoose";
import Conversation from "../models/Conversation.model.js";
import Message from "../models/Message.model.js";
import { runAssistant } from "../llm/runAssistant.js";
import { buildSystemPrompt } from "../llm/systemPrompt.js";
import { monthlyUsage } from "../services/usage.js";
import { takeSlot } from "../services/rateLimit.js";
import { env } from "../config/env.js";

const router = Router();

const HISTORY_LIMIT = 20;
const MAX_MESSAGE_LENGTH = 4000;
const HEARTBEAT_MS = 15_000;

// How a past reply is replayed to the model: its words, plus what it proposed
// and what became of it, so "did that go through?" can be answered.
const historyContent = (message) => {
  const proposals = (message.actions ?? [])
    .filter((action) => action && typeof action === "object")
    .map((action) => `[Proposed: ${action.title} (${action.details?.[0] ?? ""}) — ${action.status}]`);
  return [message.content, ...proposals].filter(Boolean).join("\n") || "(no reply)";
};

const friendlyError = (error) => {
  if (error?.status === 429) return "The assistant is busy right now. Please try again in a minute.";
  if (error?.status === 401 || error?.status === 403) return "The assistant's AI service key was refused. Please tell your administrator.";
  return "The assistant couldn't reply. Please try again.";
};

// POST /v1/chat  { message, conversationId?, page? }
// Answers as a stream of Server-Sent Events:
//   meta → (delta | tool | action)* → done   or   … → error
router.post("/", async (req, res) => {
  const { tenantId, userId } = req.auth;
  const text = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  const { conversationId } = req.body ?? {};
  const page = typeof req.body?.page === "string" ? req.body.page.trim().slice(0, 60) : "";

  if (!text) {
    return res.status(400).json({ error: "Message is empty.", code: "EMPTY" });
  }
  if (text.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ error: `Message is too long (max ${MAX_MESSAGE_LENGTH} characters).`, code: "TOO_LONG" });
  }

  const slot = takeSlot(userId, env.perMinuteLimit);
  if (!slot.allowed) {
    res.set("Retry-After", String(slot.retryAfterSeconds));
    return res.status(429).json({ error: `You're sending messages quickly. Try again in ${slot.retryAfterSeconds} seconds.`, code: "SLOW_DOWN" });
  }

  const usage = await monthlyUsage(req.auth);
  if (usage.remaining <= 0) {
    return res.status(429).json({
      error: "Your company has used this month's assistant messages. It resets on the 1st.",
      code: "MONTHLY_LIMIT",
      usage,
    });
  }

  let conversation;
  if (conversationId) {
    if (!mongoose.isValidObjectId(conversationId)) {
      return res.status(404).json({ error: "Conversation not found.", code: "NOT_FOUND" });
    }
    conversation = await Conversation.findOne({ _id: conversationId, tenantId, userId });
    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found.", code: "NOT_FOUND" });
    }
  } else {
    conversation = await Conversation.create({ tenantId, userId, title: text.slice(0, 80) });
  }

  await Message.create({ conversationId: conversation._id, tenantId, role: "user", content: text });

  const recent = await Message.find({ conversationId: conversation._id })
    .sort({ createdAt: -1 })
    .limit(HISTORY_LIMIT)
    .populate("actions", "title details status")
    .lean();

  const messages = [
    { role: "system", content: buildSystemPrompt({ userName: req.auth.name, page }) },
    ...recent.reverse().map((message) => ({
      role: message.role,
      content: message.role === "assistant" ? historyContent(message) : message.content,
    })),
  ];

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const send = (event, data) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Stop paying for an answer nobody is waiting for.
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  const heartbeat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);

  send("meta", { conversationId: conversation._id, title: conversation.title });

  let reply = "";
  const tokens = { inputTokens: 0, outputTokens: 0 };
  const sources = new Set();
  const actionIds = [];

  try {
    for await (const part of runAssistant({ messages, auth: req.auth, conversationId: conversation._id, signal: controller.signal })) {
      if (part.type === "text") {
        reply += part.text;
        send("delta", { text: part.text });
      } else if (part.type === "tool") {
        sources.add(part.label);
        send("tool", { name: part.name, label: part.label });
      } else if (part.type === "action") {
        actionIds.push(part.action.id);
        send("action", part.action);
      } else if (part.type === "usage") {
        tokens.inputTokens += part.usage.inputTokens || 0;
        tokens.outputTokens += part.usage.outputTokens || 0;
      }
    }

    send("done", { sources: [...sources], usage: { ...usage, used: usage.used + 1, remaining: usage.remaining - 1 } });
  } catch (error) {
    if (!controller.signal.aborted) {
      console.error("Chat stream error:", error);
      send("error", { message: friendlyError(error) });
    }
  } finally {
    clearInterval(heartbeat);

    try {
      await Message.create({
        conversationId: conversation._id,
        tenantId,
        role: "assistant",
        content: reply,
        sources: [...sources],
        actions: actionIds,
        usage: tokens,
      });
      await Conversation.updateOne({ _id: conversation._id }, { lastMessageAt: new Date() });
    } catch (error) {
      console.error("Could not save the reply:", error);
    }

    res.end();
  }
});

export default router;
