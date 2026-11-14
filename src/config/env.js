import "dotenv/config";

const list = (value, fallback) =>
  (value || fallback)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

export const env = {
  port: Number(process.env.PORT) || 5100,
  nodeEnv: process.env.NODE_ENV || "development",
  assistantTokenSecret: process.env.ASSISTANT_TOKEN_SECRET,
  mongoUri: process.env.MONGO_URI,
  groqApiKey: process.env.GROQ_API_KEY,
  groqModel: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
  crmApiUrl: process.env.CRM_API_URL,
  // Browsers on these addresses may call the service (the CRM's frontend).
  allowedOrigins: list(process.env.ALLOWED_ORIGINS, "http://localhost:5173"),
  // Used only when a chat pass carries no limit of its own.
  defaultMonthlyLimit: Number(process.env.DEFAULT_MONTHLY_LIMIT) || 300,
  // Messages one person may send per minute; protects the AI provider's quota.
  perMinuteLimit: Number(process.env.PER_MINUTE_LIMIT) || 8,
};

const required = ["assistantTokenSecret", "mongoUri", "groqApiKey", "crmApiUrl"];

for (const key of required) {
  if (!env[key]) {
    throw new Error(`Missing setting: ${key}. Check your .env file.`);
  }
}
