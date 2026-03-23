import mongoose, { Schema, Document } from 'mongoose';
import { CRMProvider } from '../types';

export interface IReportTemplate extends Document {
  name: string;
  description: string;
  provider: CRMProvider;
  crmReportId: string;
  category: string;
  defaultParams: Record<string, unknown>;
  relatedReports: string[];
  active: boolean;
}

const reportTemplateSchema = new Schema<IReportTemplate>({
  name: { type: String, required: true },
  description: { type: String, required: true },
  provider: { type: String, enum: ['gohighlevel', 'hubspot'], required: true },
  crmReportId: { type: String, required: true },
  category: { type: String, required: true },
  defaultParams: { type: Schema.Types.Mixed, default: {} },
  relatedReports: [String],
  active: { type: Boolean, default: true },
}, { timestamps: true });

export const ReportTemplate = mongoose.model<IReportTemplate>('ReportTemplate', reportTemplateSchema);
