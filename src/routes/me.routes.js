import { Router } from "express";

const router = Router();

router.get("/", (req, res) => {
    const {userId, tenantId, roles} = req.auth;
    res.json({userId, tenantId, roles});
});

export default router;