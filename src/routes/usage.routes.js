import { Router } from "express";
import { monthlyUsage } from "../services/usage.js";

const router = Router();

// This month's messages for the person's company: { used, limit, remaining, resetsOn }.
router.get("/", async (req, res) => {
  res.json(await monthlyUsage(req.auth));
});

export default router;
