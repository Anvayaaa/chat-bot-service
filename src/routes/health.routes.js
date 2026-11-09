import { Router } from "express";

const router = Router();

router.get("/", (req, res) => {
    res.json({
        status: "ok",
        service: "chat-bot-service",
        uptimeSeconds: Math.round(process.uptime()),
    });
});

export default router;