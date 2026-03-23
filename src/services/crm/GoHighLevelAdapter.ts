import axios, { AxiosInstance } from 'axios';
import { CRMAdapter } from './CRMAdapter';
import { ReportResult } from '../../types';
import { config } from '../../config';
import { logger } from '../../utils/logger';

export class GoHighLevelAdapter implements CRMAdapter {
  private client: AxiosInstance;
  private locationId: string;

  constructor(apiKey?: string, locationId?: string) {
    this.locationId = locationId || config.ghl.locationId;
    this.client = axios.create({
      baseURL: config.ghl.apiUrl,
      headers: {
        Authorization: `Bearer ${apiKey || config.ghl.apiKey}`,
        Version: '2021-07-28',
        'Content-Type': 'application/json',
      },
    });
  }

  async fetchReport(reportId: string, params: Record<string, unknown>): Promise<ReportResult> {
    const { startDate, endDate, ...filters } = params;

    try {
      // GoHighLevel report endpoints mapped by report type
      const reportEndpoints: Record<string, string> = {
        pipeline_summary: `/opportunities/search`,
        contacts_summary: `/contacts/`,
        conversations_summary: `/conversations/search`,
        calendar_summary: `/calendars/events`,
      };

      const endpoint = reportEndpoints[reportId] || `/opportunities/search`;
      const queryParams: Record<string, unknown> = {
        locationId: this.locationId,
        startDate,
        endDate,
        ...filters,
      };

      const response = await this.client.get(endpoint, { params: queryParams });

      return {
        templateId: reportId,
        templateName: reportId.replace(/_/g, ' '),
        provider: 'gohighlevel',
        data: this.transformResponse(reportId, response.data),
        params: { startDate, endDate, ...filters },
        generatedAt: new Date(),
      };
    } catch (error) {
      logger.error('GoHighLevel fetchReport error', { reportId, error });
      throw error;
    }
  }

  async listAvailableReports() {
    return [
      { id: 'pipeline_summary', name: 'Resumen de Pipeline', category: 'ventas' },
      { id: 'contacts_summary', name: 'Resumen de Contactos', category: 'contactos' },
      { id: 'conversations_summary', name: 'Resumen de Conversaciones', category: 'comunicación' },
      { id: 'calendar_summary', name: 'Resumen de Calendario', category: 'agenda' },
    ];
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.client.get(`/locations/${this.locationId}`);
      return true;
    } catch {
      return false;
    }
  }

  private transformResponse(reportId: string, raw: unknown): Record<string, unknown> {
    const data = raw as Record<string, unknown>;
    switch (reportId) {
      case 'pipeline_summary': {
        const opportunities = (data.opportunities || []) as Array<Record<string, unknown>>;
        const totalValue = opportunities.reduce((sum: number, o) => sum + (Number(o.monetaryValue) || 0), 0);
        const byStage: Record<string, number> = {};
        for (const opp of opportunities) {
          const stage = String(opp.pipelineStageId || 'unknown');
          byStage[stage] = (byStage[stage] || 0) + 1;
        }
        return { totalOpportunities: opportunities.length, totalValue, byStage };
      }
      case 'contacts_summary': {
        const contacts = (data.contacts || []) as unknown[];
        return { totalContacts: contacts.length };
      }
      default:
        return data;
    }
  }
}
