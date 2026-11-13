import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export const requireChatToken = (req, res, next) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Missing chat token." });
  }

  try {
    const payload = jwt.verify(token, env.assistantTokenSecret, {
      audience: "chat-bot-service",
      issuer: "anvaya-crm",
      algorithms: ["HS256"],
    });

    if (!payload.tenant) {
      return res.status(401).json({ error: "Chat token has no company." });
    }

    req.auth = {
      userId: payload.id,
      tenantId: payload.tenant,
      roles: payload.roles || [],
      token,
    };

    return next();
  } catch (error) {
    const message =
      error.name === "TokenExpiredError"
        ? "Chat token expired. Request a new one."
        : "Invalid chat token.";

    return res.status(401).json({ error: message });
  }
};
