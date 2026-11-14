// A stand-in for the real AI, used by the automated tests (LLM_PROVIDER=scripted).
// Each call to streamChat plays the next scripted turn:
//   { text: "..." }                                  a plain answer
//   { toolCalls: [{ name: "search_leads", args: {} }] } a request to run tools
// It also records what it was sent, so tests can check the prompt and history.
let turns = [];
export const received = [];

export const setScript = (nextTurns) => {
  turns = [...nextTurns];
  received.length = 0;
};

export async function* streamChat({ messages, tools }) {
  received.push({ messages: structuredClone(messages), toolNames: (tools ?? []).map((tool) => tool.function.name) });

  const turn = turns.shift() ?? { text: "(no scripted reply)" };

  if (turn.text) {
    for (const word of turn.text.split(/(?<= )/)) yield { type: "text", text: word };
  }

  if (turn.toolCalls?.length) {
    yield {
      type: "tool_calls",
      toolCalls: turn.toolCalls.map((call, index) => ({
        id: `call_${received.length}_${index}`,
        type: "function",
        function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) },
      })),
    };
  }

  yield { type: "usage", usage: { inputTokens: 100, outputTokens: 20 } };
}

export const isMalformedToolCall = () => false;
