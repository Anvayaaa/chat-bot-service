import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import healthRoutes from "./routes/health.routes.js";
import meRoutes from "./routes/me.routes.js";
import chatRoutes from "./routes/chat.routes.js";
import conversationsRoutes from "./routes/conversations.routes.js";
import { requireChatToken } from "./middlewares/auth.middleware.js";

const app = express();

app.use(helmet());
app.use(express.json({ limit: "100kb" }));
app.use(morgan("dev"));

app.use("/health", healthRoutes);
app.use("/v1/me", requireChatToken, meRoutes);
app.use("/v1/chat", requireChatToken, chatRoutes);
app.use("/v1/conversations", requireChatToken, conversationsRoutes);

app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  if (res.headersSent) {
    return res.end();
  }
  res.status(500).json({ error: "Something went wrong." });
});

export default app;
