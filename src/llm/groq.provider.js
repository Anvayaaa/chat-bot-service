import Groq from "groq-sdk";
import { env } from "../config/env.js";

// The only file that knows about Groq. To switch providers, write another file
// with the same streamChat() shape and point src/llm/index.js at it.
const client = new Groq({ apiKey: env.groqApiKey });

// Streams one model turn. Yields:
//   { type: "text", text }            a piece of the reply, as it arrives
//   { type: "tool_calls", toolCalls } tools the model wants run (at the end)
//   { type: "usage", usage }          tokens used by this turn
export async function* streamChat({ messages, tools, signal }) {
  const stream = await client.chat.completions.create(
    {
      model: env.groqModel,
      messages,
      tools: tools?.length ? tools : undefined,
      stream: true,
      temperature: 0.3,
      max_completion_tokens: 1024,
    },
    { signal },
  );

  const toolCalls = [];

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;

    if (delta?.content) {
      yield { type: "text", text: delta.content };
    }

    // A tool request also streams in pieces; glue them back together by index.
    for (const piece of delta?.tool_calls ?? []) {
      toolCalls[piece.index] ??= { id: "", type: "function", function: { name: "", arguments: "" } };
      const call = toolCalls[piece.index];
      if (piece.id) call.id = piece.id;
      if (piece.function?.name) call.function.name += piece.function.name;
      if (piece.function?.arguments) call.function.arguments += piece.function.arguments;
    }

    const usage = chunk.usage ?? chunk.x_groq?.usage;
    if (usage) {
      yield {
        type: "usage",
        usage: { inputTokens: usage.prompt_tokens ?? 0, outputTokens: usage.completion_tokens ?? 0 },
      };
    }
  }

  const complete = toolCalls.filter((call) => call?.function.name);
  if (complete.length) {
    yield { type: "tool_calls", toolCalls: complete };
  }
}

// Groq answers 400 "tool_use_failed" when the model wrote a malformed tool
// call. Asking again usually works.
export const isMalformedToolCall = (error) =>
  error?.status === 400 && JSON.stringify(error?.error ?? error?.message ?? "").includes("tool_use_failed");
