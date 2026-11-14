// Small helpers the tools share: tidy what the AI sends, and turn CRM records
// into short, readable facts (no phone numbers or emails ever leave the CRM).
export const TIME_ZONE = "Asia/Kolkata";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const OBJECT_ID = /^[0-9a-f]{24}$/i;

export const isId = (value) => OBJECT_ID.test(String(value ?? ""));
export const dateOf = (value) => (DATE.test(String(value ?? "")) ? value : undefined);
export const oneOf = (value, allowed) => (allowed.includes(value) ? value : undefined);
export const limitOf = (value, fallback = 5) => Math.min(Math.max(Number(value) || fallback, 1), 10);
export const textOf = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");
export const nameOf = (value) => (value && typeof value === "object" ? value.name : undefined);

export const day = (value) => {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toLocaleDateString("en-CA", { timeZone: TIME_ZONE });
};

export const todayKey = () => day(new Date());

// "2026-11-16" -> "Mon, 16 Nov"
export const dayLabel = (key) =>
  new Date(`${key}T12:00:00+05:30`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: TIME_ZONE });
