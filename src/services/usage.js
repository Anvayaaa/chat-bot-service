import Message from "../models/Message.model.js";

const TIME_ZONE = "Asia/Kolkata";
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// Midnight on the 1st of this month, Indian time.
const monthStart = (now = new Date()) => {
  const [year, month] = now.toLocaleDateString("en-CA", { timeZone: TIME_ZONE }).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1) - IST_OFFSET_MS);
};

const nextMonthStart = (now = new Date()) => {
  const start = monthStart(now);
  const ist = new Date(start.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() + 1, 1) - IST_OFFSET_MS);
};

// How many questions a company has asked this month, against its allowance
// (which comes from the CRM inside the chat pass).
export const monthlyUsage = async ({ tenantId, monthlyLimit }) => {
  const used = await Message.countDocuments({ tenantId, role: "user", createdAt: { $gte: monthStart() } });
  return { used, limit: monthlyLimit, remaining: Math.max(0, monthlyLimit - used), resetsOn: nextMonthStart().toISOString() };
};
