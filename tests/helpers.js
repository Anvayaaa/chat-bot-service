import net from "node:net";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

// Test settings, set before the app is imported.
export const SECRET = "chat-bot-test-secret";
process.env.NODE_ENV = "test";
process.env.LLM_PROVIDER = "scripted";
process.env.ASSISTANT_TOKEN_SECRET = SECRET;
process.env.GROQ_API_KEY = "not-used-in-tests";
process.env.MONGO_URI = "mongodb://unused";
process.env.PER_MINUTE_LIMIT = "1000";

const freePort = () =>
  new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

// A throwaway MongoDB for this test run only. Point MONGOD_PATH at mongod if
// it isn't on PATH.
let mongod;
let dbPath;

export const startMongo = async () => {
  dbPath = mkdtempSync(path.join(tmpdir(), "chat-bot-test-"));
  const port = await freePort();
  mongod = spawn(process.env.MONGOD_PATH || "mongod", ["--dbpath", dbPath, "--port", String(port), "--bind_ip", "127.0.0.1", "--wiredTigerCacheSizeGB", "0.25"], {
    stdio: "ignore",
  });

  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      await mongoose.connect(`mongodb://127.0.0.1:${port}/chat-bot-test`, { serverSelectionTimeoutMS: 500 });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error("mongod did not start. Set MONGOD_PATH to the mongod binary.");
};

export const stopMongo = async () => {
  await mongoose.disconnect();
  mongod?.kill();
  await new Promise((resolve) => setTimeout(resolve, 500));
  rmSync(dbPath, { recursive: true, force: true });
};

// A pretend CRM that records every call made to it.
export const startFakeCrm = async () => {
  const calls = [];
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    calls.push({ method: req.method, path: req.path, query: req.query, body: req.body, auth: req.headers.authorization });
    next();
  });

  const lead = { _id: "6aa055ffe9bbde50dfa64001", name: "Rohan Desai", status: "negotiation", phone: "9999999999" };

  app.get("/api/v1/lead/find", (req, res) => res.json({ count: 1, data: [lead] }));
  app.get("/api/v1/lead/findOne/:id", (req, res) =>
    req.params.id === lead._id ? res.json({ data: lead }) : res.status(404).json({ message: "Lead not found." }),
  );
  app.get("/api/v1/payment/outstanding", (req, res) => res.status(403).json({ message: "You do not have permission." }));
  app.post("/api/v1/followup/create", (req, res) => res.status(201).json({ data: { _id: "6aa055ffe9bbde50dfa64999" } }));

  const port = await freePort();
  const server = await new Promise((resolve) => {
    const listening = app.listen(port, "127.0.0.1", () => resolve(listening));
  });
  process.env.CRM_API_URL = `http://127.0.0.1:${port}/api/v1`;

  return { calls, lead, stop: () => new Promise((resolve) => server.close(resolve)) };
};

export const chatToken = ({ userId = "6aa055ffe9bbde50dfa60001", tenant = "6aa055ffe9bbde50dfa6f001", limit = 300 } = {}) =>
  jwt.sign({ id: userId, tenant, roles: ["SALES"], name: "Asha", limit }, SECRET, {
    audience: "chat-bot-service",
    issuer: "anvaya-crm",
    expiresIn: "15m",
  });

// Reads a Server-Sent Events body into [{ event, data }].
export const parseSse = (body) =>
  body
    .split("\n\n")
    .map((block) => {
      const event = block.match(/^event: (.*)$/m)?.[1];
      const data = block.match(/^data: (.*)$/m)?.[1];
      return event ? { event, data: data ? JSON.parse(data) : null } : null;
    })
    .filter(Boolean);
