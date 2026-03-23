import { ReportResult } from '../../types';

/**
 * Abstract adapter that each CRM provider must implement.
 * Reports are not generated from scratch — the adapter queries
 * pre-existing report structures in the CRM and updates date/filter params.
 */
export interface CRMAdapter {
  /** Fetch a report by its CRM-native ID with the given params */
  fetchReport(reportId: string, params: Record<string, unknown>): Promise<ReportResult>;

  /** List available report IDs in the CRM */
  listAvailableReports(): Promise<Array<{ id: string; name: string; category: string }>>;

  /** Test the connection / credentials */
  testConnection(): Promise<boolean>;
}
