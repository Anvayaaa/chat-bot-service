import "dotenv/config";

export const env = {
  port: Number(process.env.PORT) || 5100,
  nodeEnv: process.env.NODE_ENV || "development",
  assistantTokenSecret: process.env.ASSISTANT_TOKEN_SECRET,
  mongoUri: process.env.MONGO_URI,
  groqApiKey: process.env.GROQ_API_KEY,
  groqModel: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
};

const required = ["assistantTokenSecret", "mongoUri", "groqApiKey"];

for (const key of required) {
  if (!env[key]) {
    throw new Error(`Missing setting: ${key}. Check your .env file.`);
  }
}
