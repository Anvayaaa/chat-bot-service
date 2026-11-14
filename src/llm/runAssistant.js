import { isMalformedToolCall, streamChat } from "./index.js";
import { runTool, toolDefinitions, toolLabel } from "../tools/index.js";

const MAX_STEPS = 5;

// One model turn, retried once if the model wrote a broken tool call.
async function* turn(messages, signal) {
  for (let attempt = 0; ; attempt++) {
    try {
      yield* streamChat({ messages, tools: toolDefinitions, signal });
      return;
    } catch (error) {
      if (attempt === 0 && isMalformedToolCall(error)) continue;
      throw error;
    }
  }
}

// The agent loop. Ask the model; if it wants tools, run them, hand back the
// results and ask again — until it answers in words (at most MAX_STEPS rounds).
//
// Yields what the chat route streams to the browser:
//   text · tool (a lookup started) · action (a change awaiting Confirm) · usage
export async function* runAssistant({ messages, auth, conversationId, signal }) {
  for (let step = 0; step < MAX_STEPS; step++) {
    let text = "";
    let toolCalls = [];

    for await (const part of turn(messages, signal)) {
      if (part.type === "text") {
        text += part.text;
        yield part;
      } else if (part.type === "tool_calls") {
        toolCalls = part.toolCalls;
      } else {
        yield part;
      }
    }

    if (!toolCalls.length) return;

    messages.push({ role: "assistant", content: text || null, tool_calls: toolCalls });

    for (const call of toolCalls) {
      yield { type: "tool", name: call.function.name, label: toolLabel(call.function.name) };

      const { result, action } = await runTool(call, { auth, conversationId });
      if (action) yield { type: "action", action };

      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }

  yield { type: "text", text: "\n\nI needed too many lookups for that one. Could you ask something more specific?" };
}
