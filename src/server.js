import { env } from "./config/env.js";
import { connectDB } from "./config/db.js";
import app from "./app.js";
import mongoose from "mongoose";

// The server only starts taking requests once the database is ready.
await connectDB();

const server = app.listen(env.port, () => {
  console.log(`chat-bot-service running on http://localhost:${env.port}`);
});

// On shutdown (Ctrl+C, a deploy restart) finish in-flight replies, then close.
const shutdown = (signal) => {
  console.log(`${signal} received, shutting down...`);
  server.close(async () => {
    await mongoose.disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
