import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", required: true },
    tenantId: { type: String, required: true },
    role: { type: String, enum: ["user", "assistant"], required: true },
    content: { type: String, default: "" },
    // Which parts of the CRM the answer was read from ("Leads", "Payments").
    sources: [String],
    // Changes this reply proposed; each waits for the person's Confirm.
    actions: [{ type: mongoose.Schema.Types.ObjectId, ref: "Action" }],
    usage: {
      inputTokens: Number,
      outputTokens: Number,
    },
  },
  { timestamps: true },
);

messageSchema.index({ conversationId: 1, createdAt: -1 });
// Monthly usage counts: a company's own messages, by date.
messageSchema.index({ tenantId: 1, role: 1, createdAt: -1 });

export default mongoose.model("Message", messageSchema);
