import { ReportResult } from '../../types';

/**
 * Abstract adapter that each CRM provider must implement.
 *
 * Strategy per CRM:
 * - GoHighLevel: No native reporting API. We query object endpoints
 *   (opportunities/search, contacts/search, calendars/events, conversations/search)
 *   with date/filter params and aggregate server-side.
 * - HubSpot: Two paths — (1) Analytics API /analytics/v2/reports for pre-aggregated
 *   traffic/session/conversion metrics, and (2) CRM Search API /crm/v3/objects/{type}/search
 *   for deals/contacts/tickets with server-side aggregation.
 *   Pipeline metadata via /crm/v3/pipelines/{objectType}.
 */
export interface CRMAdapter {
  /** Fetch a report by its CRM-native ID with the given params */
  fetchReport(reportId: string, params: Record<string, unknown>): Promise<ReportResult>;

  /** List available report IDs in the CRM */
  listAvailableReports(): Promise<Array<{ id: string; name: string; category: string; description: string }>>;

  /** Test the connection / credentials */
  testConnection(): Promise<boolean>;

  /** Fetch pipeline metadata (stages, names) for label resolution */
  fetchPipelines(): Promise<Array<PipelineInfo>>;
}

export interface PipelineInfo {
  id: string;
  name: string;
  stages: Array<{ id: string; name: string; position: number }>;
}
