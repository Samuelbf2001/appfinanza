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
  /** Browser credentials for AI agent dashboard access (encrypted at rest) */
  browserCredentials?: {
    email?: string;
    password?: string; // Should be encrypted in production
    locationUrl?: string; // GHL location URL
    portalId?: string; // HubSpot portal ID
  };
  /** Preferred report extraction method */
  extractionMode: 'api' | 'browser' | 'hybrid';
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
  browserCredentials: {
    email: String,
    password: String,
    locationUrl: String,
    portalId: String,
  },
  extractionMode: { type: String, enum: ['api', 'browser', 'hybrid'], default: 'api' },
  schedules: [scheduleSchema],
  subscribedReports: [String],
  language: { type: String, default: 'es' },
  active: { type: Boolean, default: true },
}, { timestamps: true });

export const User = mongoose.model<IUser>('User', userSchema);
