import "dotenv/config";

export const env = {
    port: Number(process.env.PORT) || 5100,
    nodeEnv: process.env.NODE_ENV || "development",
}