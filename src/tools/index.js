import Action, { ACTION_TTL_MS, toClientAction } from "../models/Action.model.js";
import { CrmError } from "../crm/crmClient.js";
import { readTools } from "./readTools.js";
import { writeTools } from "./writeTools.js";

const tools = [...readTools.map((tool) => ({ ...tool, kind: "read" })), ...writeTools.map((tool) => ({ ...tool, kind: "write" }))];
const byName = new Map(tools.map((tool) => [tool.name, tool]));

// The menu the AI chooses from (OpenAI-style function definitions).
export const toolDefinitions = tools.map(({ name, description, parameters }) => ({
  type: "function",
  function: { name, description, parameters },
}));

export const toolLabel = (name) => byName.get(name)?.label ?? name;

// A CRM refusal, in words the AI can pass on to the person.
const explain = (error, toolName) => {
  if (error instanceof CrmError) {
    if (error.status === 403) return { error: "This user's role does not have access to that." };
    if (error.status === 404) return { error: "Not found, or this user cannot access it." };
    if (error.status === 400) return { error: `The CRM did not accept it: ${error.message}` };
  }
  console.error(`[tool] ${toolName} failed:`, error);
  return { error: "The CRM could not be reached. Ask the user to try again." };
};

const parseArgs = (raw) => {
  try {
    const args = JSON.parse(raw || "{}");
    return args && typeof args === "object" && !Array.isArray(args) ? args : {};
  } catch {
    return null;
  }
};

// Runs one tool the AI asked for. Returns { result } for the AI to read and,
// for a write tool, { action } — the proposal to show as a confirmation card.
export const runTool = async (call, { auth, conversationId }) => {
  const tool = byName.get(call.function.name);
  if (!tool) return { result: { error: `There is no tool called ${call.function.name}.` } };

  const args = parseArgs(call.function.arguments);
  if (!args) return { result: { error: "The tool arguments were not valid JSON." } };

  // Watch the AI's decisions in the terminal while developing.
  if (process.env.NODE_ENV !== "test") console.log(`[tool] ${tool.name}`, args);

  try {
    if (tool.kind === "read") {
      return { result: await tool.run(args, auth) };
    }

    const proposal = await tool.prepare(args, auth);
    if (proposal.error) return { result: proposal };

    const action = await Action.create({
      tenantId: auth.tenantId,
      userId: auth.userId,
      conversationId,
      tool: tool.name,
      title: proposal.title,
      details: proposal.details,
      payload: proposal.payload,
      expiresAt: new Date(Date.now() + ACTION_TTL_MS),
    });

    return {
      action: toClientAction(action),
      result: {
        status: "waiting_for_user",
        summary: [proposal.title, ...proposal.details].join(" | "),
        note: "Nothing has been saved yet. The user sees this as a card with Confirm and Cancel. Tell them to review it and click Confirm. Do not say it is done.",
      },
    };
  } catch (error) {
    return { result: explain(error, tool.name) };
  }
};

// Called by POST /v1/actions/:id/confirm, never by the AI.
export const executeAction = async (action, auth) => {
  const tool = byName.get(action.tool);
  if (!tool?.execute) throw new Error(`No tool can run ${action.tool}.`);
  return tool.execute(action.payload, auth);
};
