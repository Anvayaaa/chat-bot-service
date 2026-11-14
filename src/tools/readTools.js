import { crmGet } from "../crm/crmClient.js";
import { dateOf, day, isId, limitOf, nameOf, oneOf } from "./format.js";

const LEAD_STATUSES = ["new", "contacted", "qualified", "quoted", "negotiation", "won", "lost"];
const EVENT_STATUSES = ["booked", "confirmed", "in-progress", "completed", "cancelled"];

const leadSummary = (lead) => ({
  id: lead._id,
  name: lead.name,
  status: lead.status,
  eventType: nameOf(lead.eventType),
  tentativeDate: day(lead.tentativeDate),
  budget: lead.budgetRange,
  guests: lead.guestCountEstimate,
  assignedTo: nameOf(lead.assignedTo),
});

// What the AI sees: name, description, parameters. What we run: `run`.
// `label` is the friendly name shown to the person ("From Leads").
export const readTools = [
  {
    name: "search_leads",
    label: "Leads",
    description:
      "Search the user's leads (potential clients), newest first. Use for questions like 'leads in negotiation' or 'find the Mehta lead'. Also use it to find a lead's id before logging a follow-up.",
    parameters: {
      type: "object",
      properties: {
        search: { type: "string", description: "Name or text to look for. Leave out to list all." },
        status: { type: "string", enum: LEAD_STATUSES, description: "Pipeline stage to filter by." },
        limit: { type: "integer", minimum: 1, maximum: 10, description: "How many to return. Default 5." },
      },
    },
    run: async (args, auth) => {
      const body = await crmGet(
        "/lead/find",
        { search: args.search, status: oneOf(args.status, LEAD_STATUSES), limit: limitOf(args.limit), sort: "createdAt:desc" },
        auth,
      );
      return { totalMatching: body.count, leads: (body.data ?? []).map(leadSummary) };
    },
  },

  {
    name: "get_lead",
    label: "Lead details",
    description: "Get one lead's details by its id. Get the id from search_leads first.",
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "The lead id from search_leads." } },
      required: ["id"],
    },
    run: async (args, auth) => {
      if (!isId(args.id)) return { error: "That is not a valid lead id. Use search_leads first." };
      const { data: lead } = await crmGet(`/lead/findOne/${args.id}`, {}, auth);
      return {
        ...leadSummary(lead),
        source: lead.source,
        venue: nameOf(lead.venue),
        lostReason: lead.lostReason,
        createdAt: day(lead.createdAt),
      };
    },
  },

  {
    name: "find_events",
    label: "Events",
    description:
      "Find booked events between two dates, earliest first. Dates are YYYY-MM-DD. Also use it to find an event's id before creating a task.",
    parameters: {
      type: "object",
      properties: {
        from: { type: "string", description: "Start date, YYYY-MM-DD." },
        to: { type: "string", description: "End date, YYYY-MM-DD." },
        search: { type: "string", description: "Client name or text to look for." },
        status: { type: "string", enum: EVENT_STATUSES },
        limit: { type: "integer", minimum: 1, maximum: 10 },
      },
    },
    run: async (args, auth) => {
      const body = await crmGet(
        "/event/find",
        {
          eventDateFrom: dateOf(args.from),
          eventDateTo: dateOf(args.to),
          search: args.search,
          status: oneOf(args.status, EVENT_STATUSES),
          limit: limitOf(args.limit),
          sort: "eventDate:asc",
        },
        auth,
      );
      return {
        totalMatching: body.count,
        events: (body.data ?? []).map((event) => ({
          id: event._id,
          date: day(event.eventDate),
          status: event.status,
          client: nameOf(event.lead),
          eventType: nameOf(event.eventType),
          location: nameOf(event.location),
          venue: nameOf(event.venue),
          guests: event.guestCount,
        })),
      };
    },
  },

  {
    name: "stock_availability",
    label: "Inventory",
    description: "Check how many units of an inventory item are free on a date. Use for 'do we have 200 chairs on 20 Dec?'.",
    parameters: {
      type: "object",
      properties: {
        search: { type: "string", description: "Item name, e.g. 'chair'." },
        date: { type: "string", description: "Date to check, YYYY-MM-DD. Leave out for today." },
      },
      required: ["search"],
    },
    run: async (args, auth) => {
      const body = await crmGet("/inventory-item/find", { search: args.search, forDate: dateOf(args.date), limit: 10 }, auth);
      return {
        date: dateOf(args.date) ?? "today",
        items: (body.data ?? []).map((item) => ({
          name: item.name,
          unit: item.unit,
          available: item.availability?.available,
          reserved: item.availability?.reserved,
          damaged: item.availability?.damaged,
        })),
      };
    },
  },

  {
    name: "payments_summary",
    label: "Payments",
    description: "Money still owed by clients: total outstanding, total overdue, and the events with the largest dues.",
    parameters: {
      type: "object",
      properties: { onlyOverdue: { type: "boolean", description: "Only list overdue amounts." } },
    },
    run: async (args, auth) => {
      const { data } = await crmGet("/payment/outstanding", {}, auth);
      const rows = (data?.rows ?? []).filter((row) => !args.onlyOverdue || row.overdue || row.eventPassed);
      return {
        totalOutstanding: data?.summary?.outstanding ?? 0,
        totalOverdue: data?.summary?.overdue ?? 0,
        eventsWithDues: data?.summary?.events ?? 0,
        top: rows.slice(0, 10).map((row) => ({
          client: row.client,
          eventDate: day(row.eventDate),
          remaining: row.remaining,
          overdue: Boolean(row.overdue || row.eventPassed),
          invoice: row.invoice?.invoiceNumber,
        })),
      };
    },
  },

  {
    name: "quotations_awaiting_reply",
    label: "Quotations",
    description: "Quotations sent to clients that have no reply yet, oldest first.",
    parameters: {
      type: "object",
      properties: { limit: { type: "integer", minimum: 1, maximum: 10 } },
    },
    run: async (args, auth) => {
      const body = await crmGet("/quotation/find", { status: "sent", sort: "sentAt:asc", limit: limitOf(args.limit) }, auth);
      const now = Date.now();
      return {
        totalWaiting: body.count,
        quotations: (body.data ?? []).map((quotation) => ({
          number: quotation.quotationNumber,
          client: nameOf(quotation.lead),
          amount: quotation.grandTotal,
          sentOn: day(quotation.sentAt),
          daysWaiting: quotation.sentAt ? Math.floor((now - new Date(quotation.sentAt)) / 86_400_000) : undefined,
        })),
      };
    },
  },
];
