import mongoose from "mongoose";

const conversationSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true },
    userId: { type: String, required: true },
    title: { type: String, required: true, maxlength: 80 },
    lastMessageAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

conversationSchema.index({ tenantId: 1, userId: 1, lastMessageAt: -1 });

export default mongoose.model("Conversation", conversationSchema);
