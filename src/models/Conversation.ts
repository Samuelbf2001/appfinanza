import mongoose, { Schema, Document } from 'mongoose';

export interface IConversation extends Document {
  userId: mongoose.Types.ObjectId;
  whatsappNumber: string;
  history: Array<{ role: 'user' | 'assistant'; content: string; timestamp: Date }>;
  lastReportTemplateId?: string;
  lastReportData?: Record<string, unknown>;
  pendingAction?: string;
  expiresAt: Date;
}

const messageSchema = new Schema({
  role: { type: String, enum: ['user', 'assistant'], required: true },
  content: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
}, { _id: false });

const conversationSchema = new Schema<IConversation>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  whatsappNumber: { type: String, required: true, index: true },
  history: [messageSchema],
  lastReportTemplateId: String,
  lastReportData: Schema.Types.Mixed,
  pendingAction: String,
  expiresAt: { type: Date, default: () => new Date(Date.now() + 24 * 60 * 60 * 1000) },
}, { timestamps: true });

// TTL index: auto-delete conversations after expiry
conversationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Conversation = mongoose.model<IConversation>('Conversation', conversationSchema);
