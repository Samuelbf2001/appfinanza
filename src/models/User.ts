import mongoose, { Schema, Document } from 'mongoose';
import { CRMProvider, ScheduleConfig } from '../types';

export interface IUser extends Document {
  whatsappNumber: string;
  name: string;
  crmProvider: CRMProvider;
  crmCredentials: {
    apiKey?: string;
    accessToken?: string;
    locationId?: string;
  };
  schedules: Array<{
    reportTemplateId: string;
    config: ScheduleConfig;
    active: boolean;
  }>;
  subscribedReports: string[];
  language: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const scheduleSchema = new Schema({
  reportTemplateId: { type: String, required: true },
  config: {
    frequency: { type: String, enum: ['daily', 'weekly', 'biweekly', 'monthly'], default: 'weekly' },
    dayOfWeek: { type: Number, min: 0, max: 6 },
    hour: { type: Number, min: 0, max: 23, default: 9 },
    minute: { type: Number, min: 0, max: 59, default: 0 },
    timezone: { type: String, default: 'America/Bogota' },
  },
  active: { type: Boolean, default: true },
}, { _id: false });

const userSchema = new Schema<IUser>({
  whatsappNumber: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true },
  crmProvider: { type: String, enum: ['gohighlevel', 'hubspot'], required: true },
  crmCredentials: {
    apiKey: String,
    accessToken: String,
    locationId: String,
  },
  schedules: [scheduleSchema],
  subscribedReports: [String],
  language: { type: String, default: 'es' },
  active: { type: Boolean, default: true },
}, { timestamps: true });

export const User = mongoose.model<IUser>('User', userSchema);
