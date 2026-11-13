import Groq from "groq-sdk";
import { env } from "../config/env.js";

const client = new Groq({ apiKey: env.groqApiKey });

export async function* streamChat({ messages }) {
  const stream = await client.chat.completions.create({
    model: env.groqModel,
    messages,
    stream: true,
    temperature: 0.3,
    max_completion_tokens: 1024,
  });

  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content;
    if (text) {
      yield { type: "text", text };
    }

    const usage = chunk.usage ?? chunk.x_groq?.usage;
    if (usage) {
      yield {
        type: "usage",
        usage: { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens },
      };
    }
  }
}
