// The one switch point for the AI provider. The rest of the app imports from
// here, never from a provider directly. To move to another AI (e.g. Claude),
// write a provider with the same streamChat() shape and choose it here.
const provider =
  process.env.LLM_PROVIDER === "scripted" ? await import("./scripted.provider.js") : await import("./groq.provider.js");

export const streamChat = (options) => provider.streamChat(options);
export const isMalformedToolCall = (error) => provider.isMalformedToolCall(error);
