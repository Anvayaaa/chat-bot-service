import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { env } from "./config/env.js";
import healthRoutes from "./routes/health.routes.js";
import meRoutes from "./routes/me.routes.js";
import chatRoutes from "./routes/chat.routes.js";
import conversationsRoutes from "./routes/conversations.routes.js";
import actionsRoutes from "./routes/actions.routes.js";
import usageRoutes from "./routes/usage.routes.js";
import { requireChatToken } from "./middlewares/auth.middleware.js";

const app = express();

app.use(helmet());
// The CRM's frontend runs on another address, so the browser must be told
// it may call us. Only the listed addresses are allowed.
app.use(cors({ origin: env.allowedOrigins, allowedHeaders: ["Authorization", "Content-Type"], maxAge: 600 }));
app.use(express.json({ limit: "100kb" }));
if (env.nodeEnv !== "test") app.use(morgan("dev"));

app.use("/health", healthRoutes);
app.use("/v1/me", requireChatToken, meRoutes);
app.use("/v1/chat", requireChatToken, chatRoutes);
app.use("/v1/conversations", requireChatToken, conversationsRoutes);
app.use("/v1/actions", requireChatToken, actionsRoutes);
app.use("/v1/usage", requireChatToken, usageRoutes);

app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "The request body is not valid JSON." });
  }
  console.error("Unhandled error:", err);
  if (res.headersSent) {
    return res.end();
  }
  res.status(500).json({ error: "Something went wrong." });
});

export default app;
