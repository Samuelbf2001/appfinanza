import axios, { AxiosInstance } from 'axios';
import { CRMAdapter } from './CRMAdapter';
import { ReportResult } from '../../types';
import { config } from '../../config';
import { logger } from '../../utils/logger';

export class HubSpotAdapter implements CRMAdapter {
  private client: AxiosInstance;

  constructor(accessToken?: string) {
    this.client = axios.create({
      baseURL: config.hubspot.apiUrl,
      headers: {
        Authorization: `Bearer ${accessToken || config.hubspot.accessToken}`,
        'Content-Type': 'application/json',
      },
    });
  }

  async fetchReport(reportId: string, params: Record<string, unknown>): Promise<ReportResult> {
    const { startDate, endDate, ...filters } = params;

    try {
      const data = await this.queryHubSpot(reportId, startDate as string, endDate as string, filters);

      return {
        templateId: reportId,
        templateName: reportId.replace(/_/g, ' '),
        provider: 'hubspot',
        data,
        params: { startDate, endDate, ...filters },
        generatedAt: new Date(),
      };
    } catch (error) {
      logger.error('HubSpot fetchReport error', { reportId, error });
      throw error;
    }
  }

  private async queryHubSpot(
    reportId: string,
    startDate: string,
    endDate: string,
    filters: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const startMs = new Date(startDate).getTime();
    const endMs = new Date(endDate).getTime();

    switch (reportId) {
      case 'deals_summary': {
        const response = await this.client.post('/crm/v3/objects/deals/search', {
          filterGroups: [{
            filters: [
              { propertyName: 'createdate', operator: 'GTE', value: String(startMs) },
              { propertyName: 'createdate', operator: 'LTE', value: String(endMs) },
              ...Object.entries(filters).map(([key, value]) => ({
                propertyName: key, operator: 'EQ', value: String(value),
              })),
            ],
          }],
          properties: ['dealname', 'amount', 'dealstage', 'closedate', 'pipeline'],
          limit: 100,
        });
        return this.transformDeals(response.data);
      }

      case 'contacts_summary': {
        const response = await this.client.post('/crm/v3/objects/contacts/search', {
          filterGroups: [{
            filters: [
              { propertyName: 'createdate', operator: 'GTE', value: String(startMs) },
              { propertyName: 'createdate', operator: 'LTE', value: String(endMs) },
            ],
          }],
          properties: ['firstname', 'lastname', 'email', 'lifecyclestage'],
          limit: 100,
        });
        const results = response.data.results || [];
        const byStage: Record<string, number> = {};
        for (const contact of results) {
          const stage = contact.properties?.lifecyclestage || 'unknown';
          byStage[stage] = (byStage[stage] || 0) + 1;
        }
        return { totalContacts: response.data.total || results.length, byLifecycleStage: byStage };
      }

      case 'tickets_summary': {
        const response = await this.client.post('/crm/v3/objects/tickets/search', {
          filterGroups: [{
            filters: [
              { propertyName: 'createdate', operator: 'GTE', value: String(startMs) },
              { propertyName: 'createdate', operator: 'LTE', value: String(endMs) },
            ],
          }],
          properties: ['subject', 'hs_pipeline_stage', 'hs_ticket_priority'],
          limit: 100,
        });
        const tickets = response.data.results || [];
        return { totalTickets: response.data.total || tickets.length };
      }

      default:
        throw new Error(`Unknown HubSpot report: ${reportId}`);
    }
  }

  private transformDeals(raw: Record<string, unknown>): Record<string, unknown> {
    const results = (raw.results || []) as Array<Record<string, { amount?: string; dealstage?: string }>>;
    let totalValue = 0;
    const byStage: Record<string, number> = {};
    for (const deal of results) {
      totalValue += Number(deal.properties?.amount) || 0;
      const stage = deal.properties?.dealstage || 'unknown';
      byStage[stage] = (byStage[stage] || 0) + 1;
    }
    return { totalDeals: raw.total || results.length, totalValue, byStage };
  }

  async listAvailableReports() {
    return [
      { id: 'deals_summary', name: 'Resumen de Negocios', category: 'ventas' },
      { id: 'contacts_summary', name: 'Resumen de Contactos', category: 'contactos' },
      { id: 'tickets_summary', name: 'Resumen de Tickets', category: 'soporte' },
    ];
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.client.get('/crm/v3/objects/contacts?limit=1');
      return true;
    } catch {
      return false;
    }
  }
}
