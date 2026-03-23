import mongoose, { Schema, Document } from 'mongoose';

export interface IReportLog extends Document {
  userId: mongoose.Types.ObjectId;
  reportTemplateId: string;
  params: Record<string, unknown>;
  result: Record<string, unknown>;
  summary: string;
  deliveredVia: 'scheduled' | 'on_demand';
  deliveredAt: Date;
}

const reportLogSchema = new Schema<IReportLog>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  reportTemplateId: { type: String, required: true },
  params: { type: Schema.Types.Mixed, default: {} },
  result: { type: Schema.Types.Mixed, default: {} },
  summary: { type: String, required: true },
  deliveredVia: { type: String, enum: ['scheduled', 'on_demand'], required: true },
  deliveredAt: { type: Date, default: Date.now },
}, { timestamps: true });

export const ReportLog = mongoose.model<IReportLog>('ReportLog', reportLogSchema);
