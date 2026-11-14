import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

// Every /v1 route needs a chat pass from the CRM (POST /api/v1/assistant/session).
// The pass says who the person is and which company they belong to; nothing
// the browser sends in a request body is ever trusted for that.
export const requireChatToken = (req, res, next) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Missing chat token.", code: "NO_TOKEN" });
  }

  try {
    const payload = jwt.verify(token, env.assistantTokenSecret, {
      audience: "chat-bot-service",
      issuer: "anvaya-crm",
      algorithms: ["HS256"],
    });

    if (!payload.id || !payload.tenant) {
      return res.status(401).json({ error: "Chat token is incomplete.", code: "BAD_TOKEN" });
    }

    req.auth = {
      userId: String(payload.id),
      tenantId: String(payload.tenant),
      roles: Array.isArray(payload.roles) ? payload.roles : [],
      name: payload.name,
      monthlyLimit: Number.isInteger(payload.limit) ? payload.limit : env.defaultMonthlyLimit,
      token,
    };

    return next();
  } catch (error) {
    const expired = error.name === "TokenExpiredError";
    return res.status(401).json({
      error: expired ? "Chat token expired. Request a new one." : "Invalid chat token.",
      code: expired ? "TOKEN_EXPIRED" : "BAD_TOKEN",
    });
  }
};
