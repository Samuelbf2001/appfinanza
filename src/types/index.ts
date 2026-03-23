export type CRMProvider = 'gohighlevel' | 'hubspot';

export interface ReportTemplate {
  id: string;
  name: string;
  description: string;
  provider: CRMProvider;
  /** The CRM-native report/endpoint identifier */
  crmReportId: string;
  /** Default parameters for the report query */
  defaultParams: Record<string, unknown>;
  /** Related report template IDs for drill-down suggestions */
  relatedReports: string[];
}

export interface ReportResult {
  templateId: string;
  templateName: string;
  provider: CRMProvider;
  data: Record<string, unknown>;
  params: Record<string, unknown>;
  generatedAt: Date;
}

export interface ScheduleConfig {
  frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly';
  dayOfWeek?: number; // 0=Sunday, 1=Monday, ...
  hour: number; // 0-23
  minute: number; // 0-59
  timezone: string;
}

export interface ConversationContext {
  userId: string;
  lastReportTemplateId?: string;
  lastReportData?: Record<string, unknown>;
  pendingAction?: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface WhatsAppInteractiveButton {
  type: 'reply';
  reply: { id: string; title: string };
}

export interface WhatsAppListRow {
  id: string;
  title: string;
  description?: string;
}
