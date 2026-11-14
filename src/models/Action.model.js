import mongoose from "mongoose";

// A change the assistant proposed (log a follow-up, create a task). Nothing
// happens in the CRM until the person clicks Confirm, and only the stored
// `payload` is ever sent — the browser can't swap in its own.
//
//   pending ──Confirm──> running ──> done | failed
//      └────Cancel / 15 min──> cancelled | expired
const actionSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true },
    userId: { type: String, required: true },
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", required: true },
    tool: { type: String, required: true },
    title: { type: String, required: true },
    details: [String],
    // Exactly what will be sent to the CRM on Confirm.
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    status: {
      type: String,
      enum: ["pending", "running", "done", "failed", "cancelled", "expired"],
      default: "pending",
    },
    result: {
      recordId: String,
      link: String,
      message: String,
    },
    expiresAt: { type: Date, required: true },
    decidedAt: Date,
  },
  { timestamps: true },
);

actionSchema.index({ tenantId: 1, userId: 1, status: 1 });

export const ACTION_TTL_MS = 15 * 60 * 1000;

export const toClientAction = (action) => ({
  id: action._id,
  tool: action.tool,
  title: action.title,
  details: action.details,
  status: action.status === "pending" && action.expiresAt < new Date() ? "expired" : action.status,
  result: action.result,
  expiresAt: action.expiresAt,
});

export default mongoose.model("Action", actionSchema);
