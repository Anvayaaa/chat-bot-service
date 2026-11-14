import { crmGet, crmPost } from "../crm/crmClient.js";
import { dateOf, day, dayLabel, isId, nameOf, oneOf, textOf, todayKey } from "./format.js";

const FOLLOW_UP_TYPES = ["call", "email", "meeting", "whatsapp", "other"];
const FOLLOW_UP_OUTCOMES = ["connected", "no-answer", "interested", "not-interested", "rescheduled", "other"];
const TASK_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"];

const TYPE_LABELS = { call: "Call", email: "Email", meeting: "Meeting", whatsapp: "WhatsApp", other: "Follow-up" };
const OUTCOME_LABELS = {
  connected: "Connected",
  "no-answer": "No answer",
  interested: "Interested",
  "not-interested": "Not interested",
  rescheduled: "Rescheduled",
  other: "Other",
};

// Write tools never change anything themselves. `prepare` checks the request,
// looks up what it refers to (with the person's own access), and describes
// the change for a confirmation card. `execute` runs only after Confirm.
export const writeTools = [
  {
    name: "log_follow_up",
    label: "Follow-ups",
    description:
      "Propose logging a follow-up (a call, WhatsApp, email or meeting that already happened) on a lead, optionally with the date of the next follow-up. The user must confirm it in the app before it is saved. Find the lead id with search_leads first.",
    parameters: {
      type: "object",
      properties: {
        leadId: { type: "string", description: "The lead id from search_leads." },
        type: { type: "string", enum: FOLLOW_UP_TYPES, description: "How the client was contacted." },
        outcome: { type: "string", enum: FOLLOW_UP_OUTCOMES, description: "How it went." },
        notes: { type: "string", description: "What was discussed, in a sentence or two." },
        date: { type: "string", description: "When it happened, YYYY-MM-DD. Leave out for today." },
        nextFollowUpDate: { type: "string", description: "When to follow up next, YYYY-MM-DD. Leave out to use the company's usual gap." },
      },
      required: ["leadId", "type", "outcome"],
    },
    prepare: async (args, auth) => {
      if (!isId(args.leadId)) return { error: "That is not a valid lead id. Use search_leads to find the lead first." };

      const type = oneOf(args.type, FOLLOW_UP_TYPES);
      const outcome = oneOf(args.outcome, FOLLOW_UP_OUTCOMES);
      if (!type) return { error: `type must be one of: ${FOLLOW_UP_TYPES.join(", ")}.` };
      if (!outcome) return { error: `outcome must be one of: ${FOLLOW_UP_OUTCOMES.join(", ")}.` };

      const date = dateOf(args.date) ?? todayKey();
      const next = dateOf(args.nextFollowUpDate);
      if (next && next < date) return { error: "The next follow-up date must be after the follow-up itself." };

      const { data: lead } = await crmGet(`/lead/findOne/${args.leadId}`, {}, auth);
      const notes = textOf(args.notes, 1000);

      return {
        title: "Log a follow-up",
        details: [
          `${TYPE_LABELS[type]} with ${lead.name} · ${date === todayKey() ? "today" : dayLabel(date)}`,
          `Outcome: ${OUTCOME_LABELS[outcome]}`,
          notes ? `Notes: ${notes}` : null,
          next ? `Next follow-up: ${dayLabel(next)}` : "Next follow-up: set by your follow-up settings",
        ].filter(Boolean),
        payload: {
          lead: args.leadId,
          type,
          outcome,
          notes,
          date,
          ...(next ? { nextFollowUpDate: next } : {}),
        },
      };
    },
    execute: async (payload, auth) => {
      const { data } = await crmPost("/followup/create", payload, auth);
      return { recordId: String(data?._id ?? ""), link: `/leads/${payload.lead}`, message: "Follow-up logged" };
    },
  },

  {
    name: "create_task",
    label: "Tasks",
    description:
      "Propose creating a checklist task for a booked event (e.g. 'arrange 40 more chairs'). The user must confirm it in the app before it is created. Find the event id with find_events first.",
    parameters: {
      type: "object",
      properties: {
        eventId: { type: "string", description: "The event id from find_events." },
        title: { type: "string", description: "Short task title, e.g. 'Arrange 40 extra chairs'." },
        description: { type: "string", description: "Optional details." },
        dueDate: { type: "string", description: "Due date, YYYY-MM-DD. Optional." },
        priority: { type: "string", enum: TASK_PRIORITIES, description: "Default MEDIUM." },
      },
      required: ["eventId", "title"],
    },
    prepare: async (args, auth) => {
      if (!isId(args.eventId)) return { error: "That is not a valid event id. Use find_events to find the event first." };

      const title = textOf(args.title, 120);
      if (!title) return { error: "The task needs a title." };

      const priority = oneOf(String(args.priority ?? "").toUpperCase(), TASK_PRIORITIES) ?? "MEDIUM";
      const dueDate = dateOf(args.dueDate);
      const description = textOf(args.description, 1000);

      const { data: event } = await crmGet(`/event/findOne/${args.eventId}`, {}, auth);
      const eventName = [nameOf(event.lead), nameOf(event.eventType)].filter(Boolean).join(" · ") || "the event";

      return {
        title: "Create a task",
        details: [
          title,
          `For ${eventName} on ${dayLabel(day(event.eventDate))}`,
          dueDate ? `Due ${dayLabel(dueDate)}` : null,
          `Priority: ${priority.charAt(0)}${priority.slice(1).toLowerCase()}`,
          description ? `Details: ${description}` : null,
        ].filter(Boolean),
        payload: { taskType: "EVENT", event: args.eventId, title, description, priority, ...(dueDate ? { dueDate } : {}) },
      };
    },
    execute: async (payload, auth) => {
      const { data } = await crmPost("/task/create", payload, auth);
      return { recordId: String(data?._id ?? ""), link: `/events/${payload.event}`, message: "Task created" };
    },
  },
];
