import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import healthRoutes from "./routes/health.routes.js";

const app = express();

app.use(helmet());
app.use(express.json({limit: "100kb"}));
app.use(morgan("dev"));

app.use("/health", healthRoutes);

app.use((req, res) => {
    res.status(404).json({error: "Not Found"});
});

export default app;