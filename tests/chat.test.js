import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { chatToken, parseSse, startFakeCrm, startMongo, stopMongo } from "./helpers.js";

const crm = await startFakeCrm();
const { default: app } = await import("../src/app.js");
const { setScript, received } = await import("../src/llm/scripted.provider.js");
const { default: Action } = await import("../src/models/Action.model.js");

let server;
let base;

const call = async (method, path, token, body) => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const isStream = response.headers.get("content-type")?.includes("text/event-stream");
  return { status: response.status, events: isStream ? parseSse(text) : null, json: isStream ? null : JSON.parse(text || "{}") };
};

const eventsOf = (events, name) => events.filter((event) => event.event === name).map((event) => event.data);

before(async () => {
  await startMongo();
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await crm.stop();
  await stopMongo();
});

describe("chat pass", () => {
  it("is required", async () => {
    const result = await call("POST", "/v1/chat", null, { message: "hi" });
    assert.equal(result.status, 401);
    assert.equal(result.json.code, "NO_TOKEN");
  });

  it("must be signed with the shared secret", async () => {
    const result = await call("POST", "/v1/chat", "not-a-real-token", { message: "hi" });
    assert.equal(result.status, 401);
  });
});

describe("answering with CRM data", () => {
  it("runs the tool the model asks for, as the user, and streams the answer", async () => {
    setScript([{ toolCalls: [{ name: "search_leads", args: { status: "negotiation" } }] }, { text: "You have **1 lead** in negotiation: Rohan Desai." }]);
    const token = chatToken();
    crm.calls.length = 0;

    const result = await call("POST", "/v1/chat", token, { message: "Which leads are in negotiation?", page: "Leads" });
    assert.equal(result.status, 200);

    const names = result.events.map((event) => event.event);
    assert.equal(names[0], "meta");
    assert.ok(names.includes("tool"));
    assert.equal(names.at(-1), "done");
    assert.equal(eventsOf(result.events, "delta").map((d) => d.text).join(""), "You have **1 lead** in negotiation: Rohan Desai.");
    assert.deepEqual(eventsOf(result.events, "done")[0].sources, ["Leads"]);

    const crmCall = crm.calls.find((entry) => entry.path === "/api/v1/lead/find");
    assert.equal(crmCall.auth, `Bearer ${token}`);
    assert.equal(crmCall.query.status, "negotiation");

    const toolResult = received[1].messages.find((message) => message.role === "tool");
    assert.ok(!toolResult.content.includes("9999999999"), "phone numbers must not be sent to the AI");
    assert.ok(received[0].messages[0].content.includes("Leads page"));
  });

  it("tells the model when the CRM refuses, instead of failing", async () => {
    setScript([{ toolCalls: [{ name: "payments_summary" }] }, { text: "You don't have access to payments." }]);
    const result = await call("POST", "/v1/chat", chatToken(), { message: "Who owes us money?" });
    assert.equal(result.status, 200);
    const toolResult = received[1].messages.find((message) => message.role === "tool");
    assert.match(toolResult.content, /does not have access/);
  });

  it("remembers the conversation", async () => {
    const token = chatToken({ userId: "6aa055ffe9bbde50dfa60002" });
    setScript([{ text: "Hello Asha." }]);
    const first = await call("POST", "/v1/chat", token, { message: "Hi" });
    const { conversationId } = eventsOf(first.events, "meta")[0];

    setScript([{ text: "You said hi." }]);
    await call("POST", "/v1/chat", token, { message: "What did I say?", conversationId });
    const replayed = received[0].messages.map((message) => message.content);
    assert.deepEqual(replayed.slice(1), ["Hi", "Hello Asha.", "What did I say?"]);
  });
});

describe("changes need a Confirm click", () => {
  let actionId;
  const token = chatToken();

  it("proposes instead of acting", async () => {
    crm.calls.length = 0;
    setScript([
      { toolCalls: [{ name: "log_follow_up", args: { leadId: crm.lead._id, type: "whatsapp", outcome: "interested", notes: "Shared the menu", nextFollowUpDate: "2099-01-05" } }] },
      { text: "Ready for you to confirm." },
    ]);

    const result = await call("POST", "/v1/chat", token, { message: "Log today's WhatsApp with Rohan, call him on 5 Jan 2099" });
    const [action] = eventsOf(result.events, "action");
    assert.equal(action.status, "pending");
    assert.equal(action.title, "Log a follow-up");
    assert.match(action.details[0], /WhatsApp with Rohan Desai/);
    assert.ok(!crm.calls.some((entry) => entry.method === "POST"), "nothing may be written before Confirm");
    actionId = action.id;
  });

  it("cannot be confirmed by someone else", async () => {
    const other = chatToken({ userId: "6aa055ffe9bbde50dfa60009" });
    const result = await call("POST", `/v1/actions/${actionId}/confirm`, other);
    assert.equal(result.status, 404);
  });

  it("makes exactly the shown change on Confirm, once", async () => {
    const result = await call("POST", `/v1/actions/${actionId}/confirm`, token);
    assert.equal(result.status, 200);
    assert.equal(result.json.action.status, "done");
    assert.equal(result.json.action.result.link, `/leads/${crm.lead._id}`);

    const writes = crm.calls.filter((entry) => entry.method === "POST");
    assert.equal(writes.length, 1);
    assert.equal(writes[0].path, "/api/v1/followup/create");
    assert.equal(writes[0].body.nextFollowUpDate, "2099-01-05");
    assert.equal(writes[0].auth, `Bearer ${token}`);

    const again = await call("POST", `/v1/actions/${actionId}/confirm`, token);
    assert.equal(again.status, 409);
    assert.equal(crm.calls.filter((entry) => entry.method === "POST").length, 1);
  });

  it("can be cancelled, and an old proposal expires", async () => {
    setScript([{ toolCalls: [{ name: "log_follow_up", args: { leadId: crm.lead._id, type: "call", outcome: "no-answer" } }] }, { text: "Ready." }]);
    const proposed = await call("POST", "/v1/chat", token, { message: "Log a missed call with Rohan" });
    const [action] = eventsOf(proposed.events, "action");

    const cancelled = await call("POST", `/v1/actions/${action.id}/cancel`, token);
    assert.equal(cancelled.json.action.status, "cancelled");

    setScript([{ toolCalls: [{ name: "log_follow_up", args: { leadId: crm.lead._id, type: "call", outcome: "no-answer" } }] }, { text: "Ready." }]);
    const second = await call("POST", "/v1/chat", token, { message: "Log it again" });
    const [stale] = eventsOf(second.events, "action");
    await Action.updateOne({ _id: stale.id }, { expiresAt: new Date(Date.now() - 1000) });

    const late = await call("POST", `/v1/actions/${stale.id}/confirm`, token);
    assert.equal(late.status, 409);
    assert.equal(late.json.action.status, "expired");
  });

  it("rejects a proposal with an invented id without calling the CRM to write", async () => {
    setScript([{ toolCalls: [{ name: "log_follow_up", args: { leadId: "not-an-id", type: "call", outcome: "connected" } }] }, { text: "I need the lead first." }]);
    const result = await call("POST", "/v1/chat", token, { message: "Log a call" });
    assert.equal(eventsOf(result.events, "action").length, 0);
    const toolResult = received[1].messages.find((message) => message.role === "tool");
    assert.match(toolResult.content, /not a valid lead id/);
  });
});

describe("privacy and limits", () => {
  it("keeps conversations inside their company and owner", async () => {
    const owner = chatToken({ userId: "6aa055ffe9bbde50dfa60003" });
    setScript([{ text: "Hi." }]);
    const first = await call("POST", "/v1/chat", owner, { message: "Hello" });
    const { conversationId } = eventsOf(first.events, "meta")[0];

    assert.equal((await call("GET", `/v1/conversations/${conversationId}`, owner)).status, 200);

    const otherCompany = chatToken({ userId: "6aa055ffe9bbde50dfa60003", tenant: "6aa055ffe9bbde50dfa6f002" });
    assert.equal((await call("GET", `/v1/conversations/${conversationId}`, otherCompany)).status, 404);
    assert.equal((await call("POST", "/v1/chat", otherCompany, { message: "x", conversationId })).status, 404);
  });

  it("stops at the company's monthly allowance", async () => {
    const token = chatToken({ tenant: "6aa055ffe9bbde50dfa6f003", limit: 1 });
    setScript([{ text: "First answer." }]);
    assert.equal((await call("POST", "/v1/chat", token, { message: "One" })).status, 200);

    const usage = await call("GET", "/v1/usage", token);
    assert.equal(usage.json.used, 1);
    assert.equal(usage.json.remaining, 0);

    const blocked = await call("POST", "/v1/chat", token, { message: "Two" });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.json.code, "MONTHLY_LIMIT");
  });

  it("rejects empty and oversized messages", async () => {
    assert.equal((await call("POST", "/v1/chat", chatToken(), { message: "   " })).status, 400);
    assert.equal((await call("POST", "/v1/chat", chatToken(), { message: "x".repeat(4001) })).status, 400);
  });
});
