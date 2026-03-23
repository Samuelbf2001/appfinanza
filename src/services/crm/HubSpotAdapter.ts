import axios, { AxiosInstance } from 'axios';
import { CRMAdapter, PipelineInfo } from './CRMAdapter';
import { ReportResult } from '../../types';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import { rateLimitedRequest, fetchAllPages, aggregateBy } from '../../utils/api';

/**
 * HubSpot CRM Adapter
 *
 * Two integration paths to get metrics WITHOUT managing all DB data:
 *
 * 1. **Analytics API** (pre-aggregated) — GET /analytics/v2/reports/{breakdown}/{period}
 *    Returns server-side aggregated traffic, sessions, contacts, bounceRate, etc.
 *    Breakdowns: totals, sources, geolocation, utm-*
 *    Periods: total, daily, weekly, monthly
 *    Requires scope: analytics.read (Marketing Hub Enterprise for API key auth)
 *
 * 2. **CRM Search API** — POST /crm/v3/objects/{type}/search
 *    Filter deals/contacts/tickets by date + properties.
 *    No server-side aggregation — we aggregate in our service layer.
 *    Good for: deals by stage, contacts by lifecycle, tickets by priority.
 *    Requires scope: crm.objects.read
 *
 * 3. **Pipelines API** — GET /crm/v3/pipelines/{objectType}
 *    Metadata for pipeline stages (resolve IDs → names).
 *    Used by deals and tickets reports.
 *
 * Base URL: https://api.hubapi.com
 * Auth: Bearer token (private app or OAuth)
 * Rate limit: 100 req / 10s (private apps), varies by tier
 */
export class HubSpotAdapter implements CRMAdapter {
  private client: AxiosInstance;
  private pipelineCache: Map<string, PipelineInfo[]> = new Map();

  constructor(accessToken?: string) {
    this.client = axios.create({
      baseURL: config.hubspot.apiUrl,
      headers: {
        Authorization: `Bearer ${accessToken || config.hubspot.accessToken}`,
        'Content-Type': 'application/json',
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Public interface
  // ---------------------------------------------------------------------------

  async fetchReport(reportId: string, params: Record<string, unknown>): Promise<ReportResult> {
    const startDate = params.startDate as string;
    const endDate = params.endDate as string;

    if (!startDate || !endDate) {
      throw new Error('startDate and endDate are required');
    }

    logger.info('HubSpot fetchReport', { reportId, startDate, endDate });

    let data: Record<string, unknown>;

    switch (reportId) {
      case 'deals_summary':
        data = await this.buildDealsSummary(startDate, endDate, params);
        break;
      case 'deals_by_pipeline':
        data = await this.buildDealsByPipeline(startDate, endDate);
        break;
      case 'deals_forecast':
        data = await this.buildDealsForecast(startDate, endDate);
        break;
      case 'contacts_summary':
        data = await this.buildContactsSummary(startDate, endDate);
        break;
      case 'contacts_by_source':
        data = await this.buildContactsBySource(startDate, endDate);
        break;
      case 'tickets_summary':
        data = await this.buildTicketsSummary(startDate, endDate);
        break;
      case 'traffic_analytics':
        data = await this.buildTrafficAnalytics(startDate, endDate);
        break;
      case 'traffic_by_source':
        data = await this.buildTrafficBySource(startDate, endDate);
        break;
      default:
        throw new Error(`Unknown HubSpot report: ${reportId}`);
    }

    return {
      templateId: reportId,
      templateName: this.getReportName(reportId),
      provider: 'hubspot',
      data,
      params: { startDate, endDate },
      generatedAt: new Date(),
    };
  }

  async listAvailableReports() {
    return [
      {
        id: 'deals_summary',
        name: 'Resumen de Negocios',
        category: 'ventas',
        description: 'Total de negocios, valor, tasa de cierre y distribución por etapa (CRM Search API).',
      },
      {
        id: 'deals_by_pipeline',
        name: 'Negocios por Pipeline',
        category: 'ventas',
        description: 'Desglose de negocios agrupados por pipeline y etapa (CRM Search + Pipelines API).',
      },
      {
        id: 'deals_forecast',
        name: 'Pronóstico de Ventas',
        category: 'ventas',
        description: 'Valor ponderado del pipeline para pronóstico de ingresos (CRM Search API).',
      },
      {
        id: 'contacts_summary',
        name: 'Resumen de Contactos',
        category: 'contactos',
        description: 'Contactos nuevos por etapa del ciclo de vida (CRM Search API).',
      },
      {
        id: 'contacts_by_source',
        name: 'Contactos por Fuente',
        category: 'contactos',
        description: 'Origen de los contactos nuevos para medir canales (CRM Search API).',
      },
      {
        id: 'tickets_summary',
        name: 'Resumen de Tickets',
        category: 'soporte',
        description: 'Tickets por prioridad y estado del pipeline de soporte (CRM Search API).',
      },
      {
        id: 'traffic_analytics',
        name: 'Analítica de Tráfico',
        category: 'marketing',
        description: 'Sesiones, visitantes, contactos y tasa de rebote (Analytics API — pre-agregado).',
      },
      {
        id: 'traffic_by_source',
        name: 'Tráfico por Fuente',
        category: 'marketing',
        description: 'Desglose de tráfico por fuente: orgánico, directo, referido, etc. (Analytics API).',
      },
    ];
  }

  async testConnection(): Promise<boolean> {
    try {
      await rateLimitedRequest(this.client, {
        method: 'GET',
        url: '/crm/v3/objects/contacts',
        params: { limit: 1 },
      });
      return true;
    } catch (error) {
      logger.error('HubSpot connection test failed', { error });
      return false;
    }
  }

  async fetchPipelines(objectType: string = 'deals'): Promise<PipelineInfo[]> {
    if (this.pipelineCache.has(objectType)) return this.pipelineCache.get(objectType)!;

    try {
      const response = await rateLimitedRequest<{
        results: Array<{
          id: string;
          label: string;
          stages: Array<{ id: string; label: string; displayOrder: number }>;
        }>;
      }>(this.client, {
        method: 'GET',
        url: `/crm/v3/pipelines/${objectType}`,
      });

      const pipelines: PipelineInfo[] = (response.data.results || []).map(p => ({
        id: p.id,
        name: p.label,
        stages: (p.stages || []).map(s => ({
          id: s.id,
          name: s.label,
          position: s.displayOrder,
        })),
      }));

      this.pipelineCache.set(objectType, pipelines);
      return pipelines;
    } catch (error) {
      logger.error('HubSpot fetchPipelines error', { objectType, error });
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  // CRM Search API based reports (POST /crm/v3/objects/{type}/search)
  // ---------------------------------------------------------------------------

  /**
   * Deals Summary: search deals by createdate, aggregate by stage.
   * Resolves stage IDs to names via Pipelines API.
   */
  private async buildDealsSummary(
    startDate: string,
    endDate: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const deals = await this.searchDeals(startDate, endDate, params.pipeline as string | undefined);
    const pipelines = await this.fetchPipelines('deals');
    const stageMap = this.buildStageMap(pipelines);

    const totalValue = deals.reduce((sum, d) => sum + (Number(d.properties.amount) || 0), 0);
    const avgValue = deals.length > 0 ? totalValue / deals.length : 0;

    const byStage = aggregateBy(
      deals,
      d => stageMap[d.properties.dealstage || ''] || d.properties.dealstage || 'Sin etapa',
      d => Number(d.properties.amount) || 0,
    );

    const closedWon = deals.filter(d => d.properties.dealstage === 'closedwon');
    const closedLost = deals.filter(d => d.properties.dealstage === 'closedlost');
    const winRate = (closedWon.length + closedLost.length) > 0
      ? ((closedWon.length / (closedWon.length + closedLost.length)) * 100).toFixed(1)
      : 'N/A';

    return {
      totalDeals: deals.length,
      totalValue: Math.round(totalValue * 100) / 100,
      averageValue: Math.round(avgValue * 100) / 100,
      closedWonCount: closedWon.length,
      closedWonValue: closedWon.reduce((s, d) => s + (Number(d.properties.amount) || 0), 0),
      closedLostCount: closedLost.length,
      winRate: `${winRate}%`,
      byStage: Object.fromEntries(
        Object.entries(byStage).map(([stage, agg]) => [stage, { count: agg.count, value: agg.total }]),
      ),
      period: { startDate, endDate },
    };
  }

  /** Deals by Pipeline: group deals by pipeline then stage */
  private async buildDealsByPipeline(startDate: string, endDate: string): Promise<Record<string, unknown>> {
    const deals = await this.searchDeals(startDate, endDate);
    const pipelines = await this.fetchPipelines('deals');
    const stageMap = this.buildStageMap(pipelines);
    const pipelineMap = Object.fromEntries(pipelines.map(p => [p.id, p.name]));

    const byPipeline: Record<string, { count: number; value: number; stages: Record<string, { count: number; value: number }> }> = {};

    for (const deal of deals) {
      const pipelineId = deal.properties.pipeline || 'default';
      const pipelineName = pipelineMap[pipelineId] || pipelineId;
      const stageName = stageMap[deal.properties.dealstage || ''] || deal.properties.dealstage || 'unknown';
      const amount = Number(deal.properties.amount) || 0;

      if (!byPipeline[pipelineName]) {
        byPipeline[pipelineName] = { count: 0, value: 0, stages: {} };
      }
      byPipeline[pipelineName].count++;
      byPipeline[pipelineName].value += amount;

      if (!byPipeline[pipelineName].stages[stageName]) {
        byPipeline[pipelineName].stages[stageName] = { count: 0, value: 0 };
      }
      byPipeline[pipelineName].stages[stageName].count++;
      byPipeline[pipelineName].stages[stageName].value += amount;
    }

    return { totalDeals: deals.length, byPipeline, period: { startDate, endDate } };
  }

  /**
   * Deals Forecast: estimates weighted pipeline value.
   * Uses deal probability (hs_deal_stage_probability) if available,
   * otherwise estimates based on stage position in pipeline.
   */
  private async buildDealsForecast(startDate: string, endDate: string): Promise<Record<string, unknown>> {
    const deals = await this.searchDeals(startDate, endDate, undefined, [
      'dealname', 'amount', 'dealstage', 'closedate', 'pipeline', 'hs_deal_stage_probability',
    ]);
    const pipelines = await this.fetchPipelines('deals');
    const stageMap = this.buildStageMap(pipelines);

    // Build probability map from stage position
    const stageProbability: Record<string, number> = {};
    for (const pipeline of pipelines) {
      const total = pipeline.stages.length;
      for (const stage of pipeline.stages) {
        stageProbability[stage.id] = (stage.position + 1) / total;
      }
    }

    let totalWeightedValue = 0;
    let totalUnweightedValue = 0;
    const byMonth: Record<string, { weighted: number; unweighted: number; count: number }> = {};

    for (const deal of deals) {
      const amount = Number(deal.properties.amount) || 0;
      const probability = Number(deal.properties.hs_deal_stage_probability)
        || stageProbability[deal.properties.dealstage || '']
        || 0.5;
      const weighted = amount * probability;

      totalUnweightedValue += amount;
      totalWeightedValue += weighted;

      const closeMonth = deal.properties.closedate
        ? deal.properties.closedate.substring(0, 7)
        : 'Sin fecha';
      if (!byMonth[closeMonth]) byMonth[closeMonth] = { weighted: 0, unweighted: 0, count: 0 };
      byMonth[closeMonth].weighted += weighted;
      byMonth[closeMonth].unweighted += amount;
      byMonth[closeMonth].count++;
    }

    return {
      totalDeals: deals.length,
      totalUnweightedValue: Math.round(totalUnweightedValue),
      totalWeightedValue: Math.round(totalWeightedValue),
      byExpectedCloseMonth: byMonth,
      period: { startDate, endDate },
    };
  }

  /** Contacts Summary: new contacts grouped by lifecycle stage */
  private async buildContactsSummary(startDate: string, endDate: string): Promise<Record<string, unknown>> {
    const contacts = await this.searchContacts(startDate, endDate, ['firstname', 'lastname', 'email', 'lifecyclestage', 'hs_lead_status']);

    const byLifecycle = aggregateBy(contacts, c => c.properties.lifecyclestage || 'unknown');
    const byLeadStatus = aggregateBy(contacts, c => c.properties.hs_lead_status || 'Sin estado');

    return {
      totalContacts: contacts.length,
      byLifecycleStage: Object.fromEntries(
        Object.entries(byLifecycle).map(([k, v]) => [k, v.count]),
      ),
      byLeadStatus: Object.fromEntries(
        Object.entries(byLeadStatus).map(([k, v]) => [k, v.count]),
      ),
      period: { startDate, endDate },
    };
  }

  /** Contacts by Source: original source of new contacts */
  private async buildContactsBySource(startDate: string, endDate: string): Promise<Record<string, unknown>> {
    const contacts = await this.searchContacts(startDate, endDate, [
      'firstname', 'lastname', 'hs_analytics_source', 'hs_analytics_source_data_1',
    ]);

    const bySource = aggregateBy(contacts, c => c.properties.hs_analytics_source || 'Desconocido');

    return {
      totalContacts: contacts.length,
      bySource: Object.fromEntries(
        Object.entries(bySource).map(([k, v]) => [k, v.count]),
      ),
      period: { startDate, endDate },
    };
  }

  /** Tickets Summary: tickets by priority and pipeline stage */
  private async buildTicketsSummary(startDate: string, endDate: string): Promise<Record<string, unknown>> {
    const tickets = await this.searchTickets(startDate, endDate);
    const pipelines = await this.fetchPipelines('tickets');
    const stageMap = this.buildStageMap(pipelines);

    const byPriority = aggregateBy(tickets, t => t.properties.hs_ticket_priority || 'Sin prioridad');
    const byStage = aggregateBy(
      tickets,
      t => stageMap[t.properties.hs_pipeline_stage || ''] || t.properties.hs_pipeline_stage || 'unknown',
    );

    return {
      totalTickets: tickets.length,
      byPriority: Object.fromEntries(Object.entries(byPriority).map(([k, v]) => [k, v.count])),
      byStage: Object.fromEntries(Object.entries(byStage).map(([k, v]) => [k, v.count])),
      period: { startDate, endDate },
    };
  }

  // ---------------------------------------------------------------------------
  // Analytics API based reports (GET /analytics/v2/reports/{breakdown}/{period})
  // These return PRE-AGGREGATED data — no need to process all records
  // ---------------------------------------------------------------------------

  /**
   * Traffic Analytics: GET /analytics/v2/reports/totals/daily
   * Returns: sessions, visitors, contacts, bounceRate, sessionToContactRate per day.
   * This endpoint delivers metrics already aggregated by HubSpot — no raw data processing needed.
   */
  private async buildTrafficAnalytics(startDate: string, endDate: string): Promise<Record<string, unknown>> {
    try {
      const response = await rateLimitedRequest<HubSpotAnalyticsResponse>(this.client, {
        method: 'GET',
        url: '/analytics/v2/reports/totals/daily',
        params: {
          start: startDate,
          end: endDate,
        },
      });

      const totals = response.data.totals || {};
      const breakdowns = response.data.breakdowns || [];

      // Daily trend for the period
      const dailyTrend = breakdowns.map((day: Record<string, unknown>) => ({
        date: day.date,
        sessions: day.sessions || 0,
        visitors: day.visitors || 0,
        contacts: day.contacts || 0,
        bounceRate: day.bounceRate || 0,
      }));

      return {
        totals: {
          sessions: totals.sessions || 0,
          visitors: totals.visitors || 0,
          contacts: totals.contacts || 0,
          leads: totals.leads || 0,
          bounceRate: totals.bounceRate ? `${(Number(totals.bounceRate) * 100).toFixed(1)}%` : 'N/A',
          sessionToContactRate: totals.sessionToContactRate
            ? `${(Number(totals.sessionToContactRate) * 100).toFixed(2)}%`
            : 'N/A',
          avgSessionDuration: totals.timePerSession
            ? `${Math.round(Number(totals.timePerSession))}s`
            : 'N/A',
        },
        dailyTrend,
        period: { startDate, endDate },
        source: 'HubSpot Analytics API (pre-aggregated)',
      };
    } catch (error) {
      logger.warn('HubSpot Analytics API not available, falling back to CRM search', { error });
      // Fallback: return basic contact counts from CRM Search
      const contacts = await this.searchContacts(startDate, endDate, ['email']);
      return {
        totals: { newContacts: contacts.length },
        note: 'Analytics API no disponible. Mostrando datos básicos del CRM.',
        period: { startDate, endDate },
      };
    }
  }

  /**
   * Traffic by Source: GET /analytics/v2/reports/sources/daily
   * Returns sessions/contacts/visitors broken down by traffic source.
   * Pre-aggregated by HubSpot — gives organic, direct, referral, social, email, paid, etc.
   */
  private async buildTrafficBySource(startDate: string, endDate: string): Promise<Record<string, unknown>> {
    try {
      const response = await rateLimitedRequest<HubSpotAnalyticsResponse>(this.client, {
        method: 'GET',
        url: '/analytics/v2/reports/sources/total',
        params: {
          start: startDate,
          end: endDate,
        },
      });

      const breakdowns = response.data.breakdowns || [];
      const bySrc: Record<string, { sessions: number; contacts: number; visitors: number }> = {};

      for (const source of breakdowns) {
        const name = (source.breakdown as string) || 'unknown';
        bySrc[name] = {
          sessions: Number(source.sessions) || 0,
          contacts: Number(source.contacts) || 0,
          visitors: Number(source.visitors) || 0,
        };
      }

      return {
        totalSessions: response.data.totals?.sessions || 0,
        bySource: bySrc,
        period: { startDate, endDate },
        source: 'HubSpot Analytics API (pre-aggregated)',
      };
    } catch (error) {
      logger.warn('HubSpot Analytics sources API not available', { error });
      return {
        note: 'Analytics API (sources) no disponible. Requiere Marketing Hub Enterprise.',
        period: { startDate, endDate },
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Raw CRM Search API calls with pagination
  // ---------------------------------------------------------------------------

  /** POST /crm/v3/objects/deals/search with date filter and pagination */
  private async searchDeals(
    startDate: string,
    endDate: string,
    pipelineId?: string,
    properties?: string[],
  ): Promise<HubSpotObject[]> {
    const startMs = new Date(startDate).getTime();
    const endMs = new Date(endDate + 'T23:59:59Z').getTime();

    const filters: HubSpotFilter[] = [
      { propertyName: 'createdate', operator: 'GTE', value: String(startMs) },
      { propertyName: 'createdate', operator: 'LTE', value: String(endMs) },
    ];
    if (pipelineId) {
      filters.push({ propertyName: 'pipeline', operator: 'EQ', value: pipelineId });
    }

    return this.searchObjects('deals', filters, properties || [
      'dealname', 'amount', 'dealstage', 'closedate', 'pipeline',
    ]);
  }

  /** POST /crm/v3/objects/contacts/search */
  private async searchContacts(
    startDate: string,
    endDate: string,
    properties: string[],
  ): Promise<HubSpotObject[]> {
    const startMs = new Date(startDate).getTime();
    const endMs = new Date(endDate + 'T23:59:59Z').getTime();

    return this.searchObjects('contacts', [
      { propertyName: 'createdate', operator: 'GTE', value: String(startMs) },
      { propertyName: 'createdate', operator: 'LTE', value: String(endMs) },
    ], properties);
  }

  /** POST /crm/v3/objects/tickets/search */
  private async searchTickets(startDate: string, endDate: string): Promise<HubSpotObject[]> {
    const startMs = new Date(startDate).getTime();
    const endMs = new Date(endDate + 'T23:59:59Z').getTime();

    return this.searchObjects('tickets', [
      { propertyName: 'createdate', operator: 'GTE', value: String(startMs) },
      { propertyName: 'createdate', operator: 'LTE', value: String(endMs) },
    ], ['subject', 'hs_pipeline_stage', 'hs_ticket_priority', 'hs_pipeline']);
  }

  /**
   * Generic paginated CRM search.
   * HubSpot search API paginates via `after` cursor, max 100 results per page,
   * max 10,000 results total.
   */
  private async searchObjects(
    objectType: string,
    filters: HubSpotFilter[],
    properties: string[],
  ): Promise<HubSpotObject[]> {
    return fetchAllPages<HubSpotObject>(this.client, {
      method: 'POST',
      url: `/crm/v3/objects/${objectType}/search`,
      data: {
        filterGroups: [{ filters }],
        properties,
        limit: 100,
      },
    }, {
      extractItems: (data) => {
        const d = data as { results?: HubSpotObject[] };
        return d.results || [];
      },
      getNextPageConfig: (data, currentConfig) => {
        const d = data as { paging?: { next?: { after: string } }; results?: unknown[] };
        if (!d.paging?.next?.after || (d.results || []).length === 0) return null;
        const body = currentConfig.data as Record<string, unknown>;
        return { ...currentConfig, data: { ...body, after: d.paging.next.after } };
      },
      maxPages: 100, // HubSpot allows up to 10,000 results (100 pages × 100)
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private buildStageMap(pipelines: PipelineInfo[]): Record<string, string> {
    const map: Record<string, string> = {};
    for (const pipeline of pipelines) {
      for (const stage of pipeline.stages) {
        map[stage.id] = stage.name;
      }
    }
    return map;
  }

  private getReportName(reportId: string): string {
    const names: Record<string, string> = {
      deals_summary: 'Resumen de Negocios',
      deals_by_pipeline: 'Negocios por Pipeline',
      deals_forecast: 'Pronóstico de Ventas',
      contacts_summary: 'Resumen de Contactos',
      contacts_by_source: 'Contactos por Fuente',
      tickets_summary: 'Resumen de Tickets',
      traffic_analytics: 'Analítica de Tráfico',
      traffic_by_source: 'Tráfico por Fuente',
    };
    return names[reportId] || reportId;
  }
}

// ---------------------------------------------------------------------------
// HubSpot API types
// ---------------------------------------------------------------------------

interface HubSpotFilter {
  propertyName: string;
  operator: string;
  value: string;
}

interface HubSpotObject {
  id: string;
  properties: Record<string, string>;
  createdAt?: string;
  updatedAt?: string;
}

interface HubSpotAnalyticsResponse {
  totals?: Record<string, unknown>;
  breakdowns?: Array<Record<string, unknown>>;
  offset?: number;
  total?: number;
}
