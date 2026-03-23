import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { CRMAdapter, PipelineInfo } from './CRMAdapter';
import { ReportResult } from '../../types';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import { rateLimitedRequest, fetchAllPages, aggregateBy } from '../../utils/api';

/**
 * GoHighLevel CRM Adapter — API V2
 *
 * GHL does NOT have a native reporting/analytics endpoint.
 * We query object-level search endpoints with date filters and aggregate server-side.
 *
 * Endpoints used:
 *  - GET  /opportunities/search          — search opportunities (pipeline deals)
 *  - POST /contacts/search               — advanced contact search
 *  - GET  /conversations/search          — search conversations
 *  - GET  /calendars/events              — get calendar events by date range
 *  - GET  /opportunities/pipelines       — pipeline metadata (stages, names)
 *  - GET  /locations/{locationId}        — connection test
 *
 * Base URL: https://services.leadconnectorhq.com
 * Auth: Bearer token (OAuth2 or Private Integration Token)
 * Required header: Version: 2021-07-28
 * Rate limit: 100 req / 10s per app per resource, 200k/day
 */
export class GoHighLevelAdapter implements CRMAdapter {
  private client: AxiosInstance;
  private locationId: string;
  private pipelineCache: PipelineInfo[] | null = null;

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

  // ---------------------------------------------------------------------------
  // Public interface
  // ---------------------------------------------------------------------------

  async fetchReport(reportId: string, params: Record<string, unknown>): Promise<ReportResult> {
    const startDate = params.startDate as string;
    const endDate = params.endDate as string;

    if (!startDate || !endDate) {
      throw new Error('startDate and endDate are required');
    }

    logger.info('GHL fetchReport', { reportId, startDate, endDate });

    let data: Record<string, unknown>;

    switch (reportId) {
      case 'pipeline_summary':
        data = await this.buildPipelineReport(startDate, endDate, params);
        break;
      case 'pipeline_stages_detail':
        data = await this.buildPipelineStagesReport(startDate, endDate, params);
        break;
      case 'contacts_summary':
        data = await this.buildContactsReport(startDate, endDate);
        break;
      case 'conversations_summary':
        data = await this.buildConversationsReport(startDate, endDate);
        break;
      case 'calendar_summary':
        data = await this.buildCalendarReport(startDate, endDate);
        break;
      case 'opportunities_by_source':
        data = await this.buildOpportunitiesBySourceReport(startDate, endDate);
        break;
      case 'opportunities_by_status':
        data = await this.buildOpportunitiesByStatusReport(startDate, endDate);
        break;
      default:
        throw new Error(`Unknown GHL report: ${reportId}`);
    }

    return {
      templateId: reportId,
      templateName: this.getReportName(reportId),
      provider: 'gohighlevel',
      data,
      params: { startDate, endDate },
      generatedAt: new Date(),
    };
  }

  async listAvailableReports() {
    return [
      {
        id: 'pipeline_summary',
        name: 'Resumen de Pipeline',
        category: 'ventas',
        description: 'Total de oportunidades, valor monetario y distribución por etapa del pipeline.',
      },
      {
        id: 'pipeline_stages_detail',
        name: 'Detalle por Etapas del Pipeline',
        category: 'ventas',
        description: 'Desglose detallado de oportunidades por cada etapa con valores y conteos.',
      },
      {
        id: 'opportunities_by_status',
        name: 'Oportunidades por Estado',
        category: 'ventas',
        description: 'Distribución de oportunidades por estado (open, won, lost, abandoned).',
      },
      {
        id: 'opportunities_by_source',
        name: 'Oportunidades por Fuente',
        category: 'ventas',
        description: 'Origen de las oportunidades para medir efectividad de canales.',
      },
      {
        id: 'contacts_summary',
        name: 'Resumen de Contactos',
        category: 'contactos',
        description: 'Contactos nuevos creados en el período con distribución por tags.',
      },
      {
        id: 'conversations_summary',
        name: 'Resumen de Conversaciones',
        category: 'comunicación',
        description: 'Actividad de conversaciones: total, por tipo, abiertas vs cerradas.',
      },
      {
        id: 'calendar_summary',
        name: 'Resumen de Calendario',
        category: 'agenda',
        description: 'Citas programadas, confirmadas, completadas y canceladas en el período.',
      },
    ];
  }

  async testConnection(): Promise<boolean> {
    try {
      await rateLimitedRequest(this.client, {
        method: 'GET',
        url: `/locations/${this.locationId}`,
      });
      return true;
    } catch (error) {
      logger.error('GHL connection test failed', { error });
      return false;
    }
  }

  async fetchPipelines(): Promise<PipelineInfo[]> {
    if (this.pipelineCache) return this.pipelineCache;

    try {
      const response = await rateLimitedRequest<{
        pipelines: Array<{
          id: string;
          name: string;
          stages: Array<{ id: string; name: string; position: number }>;
        }>;
      }>(this.client, {
        method: 'GET',
        url: '/opportunities/pipelines',
        params: { locationId: this.locationId },
      });

      this.pipelineCache = (response.data.pipelines || []).map(p => ({
        id: p.id,
        name: p.name,
        stages: (p.stages || []).map(s => ({
          id: s.id,
          name: s.name,
          position: s.position,
        })),
      }));

      return this.pipelineCache;
    } catch (error) {
      logger.error('GHL fetchPipelines error', { error });
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  // Report builders — each queries GHL endpoints and aggregates server-side
  // ---------------------------------------------------------------------------

  /**
   * Pipeline Summary: queries GET /opportunities/search with locationId + date filters.
   * Aggregates total count, total monetary value, and distribution by pipeline stage.
   * Resolves stage IDs to human-readable names via the pipelines endpoint.
   */
  private async buildPipelineReport(
    startDate: string,
    endDate: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const opportunities = await this.fetchOpportunities(startDate, endDate, {
      pipelineId: params.pipelineId as string | undefined,
    });
    const pipelines = await this.fetchPipelines();
    const stageMap = this.buildStageMap(pipelines);

    const totalValue = opportunities.reduce((sum, o) => sum + (Number(o.monetaryValue) || 0), 0);
    const avgValue = opportunities.length > 0 ? totalValue / opportunities.length : 0;

    const byStage = aggregateBy(
      opportunities,
      o => stageMap[o.pipelineStageId] || o.pipelineStageId || 'Sin etapa',
      o => Number(o.monetaryValue) || 0,
    );

    const wonOpps = opportunities.filter(o => o.status === 'won');
    const lostOpps = opportunities.filter(o => o.status === 'lost');
    const winRate = opportunities.length > 0
      ? ((wonOpps.length / opportunities.length) * 100).toFixed(1)
      : '0';

    return {
      totalOpportunities: opportunities.length,
      totalValue: Math.round(totalValue * 100) / 100,
      averageValue: Math.round(avgValue * 100) / 100,
      wonCount: wonOpps.length,
      wonValue: wonOpps.reduce((s, o) => s + (Number(o.monetaryValue) || 0), 0),
      lostCount: lostOpps.length,
      winRate: `${winRate}%`,
      byStage: Object.fromEntries(
        Object.entries(byStage).map(([stage, agg]) => [stage, { count: agg.count, value: agg.total }]),
      ),
      period: { startDate, endDate },
    };
  }

  /**
   * Pipeline Stages Detail: similar to summary but with per-stage breakdown
   * including individual opportunity status within each stage.
   */
  private async buildPipelineStagesReport(
    startDate: string,
    endDate: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const opportunities = await this.fetchOpportunities(startDate, endDate, {
      pipelineId: params.pipelineId as string | undefined,
    });
    const pipelines = await this.fetchPipelines();
    const stageMap = this.buildStageMap(pipelines);

    const stages: Record<string, { count: number; value: number; open: number; won: number; lost: number; abandoned: number }> = {};
    for (const opp of opportunities) {
      const stageName = stageMap[opp.pipelineStageId] || opp.pipelineStageId || 'Sin etapa';
      if (!stages[stageName]) {
        stages[stageName] = { count: 0, value: 0, open: 0, won: 0, lost: 0, abandoned: 0 };
      }
      stages[stageName].count++;
      stages[stageName].value += Number(opp.monetaryValue) || 0;
      const status = (opp.status || 'open') as 'open' | 'won' | 'lost' | 'abandoned';
      if (status in stages[stageName]) {
        stages[stageName][status]++;
      }
    }

    return { stages, totalOpportunities: opportunities.length, period: { startDate, endDate } };
  }

  /** Opportunities by Status: group by open/won/lost/abandoned */
  private async buildOpportunitiesByStatusReport(
    startDate: string,
    endDate: string,
  ): Promise<Record<string, unknown>> {
    const opportunities = await this.fetchOpportunities(startDate, endDate, {});
    const byStatus = aggregateBy(
      opportunities,
      o => o.status || 'open',
      o => Number(o.monetaryValue) || 0,
    );

    return {
      totalOpportunities: opportunities.length,
      byStatus: Object.fromEntries(
        Object.entries(byStatus).map(([status, agg]) => [status, { count: agg.count, value: agg.total }]),
      ),
      period: { startDate, endDate },
    };
  }

  /** Opportunities by Source: group by opportunity source field */
  private async buildOpportunitiesBySourceReport(
    startDate: string,
    endDate: string,
  ): Promise<Record<string, unknown>> {
    const opportunities = await this.fetchOpportunities(startDate, endDate, {});
    const bySource = aggregateBy(
      opportunities,
      o => o.source || 'Desconocido',
      o => Number(o.monetaryValue) || 0,
    );

    return {
      totalOpportunities: opportunities.length,
      bySource: Object.fromEntries(
        Object.entries(bySource).map(([source, agg]) => [source, { count: agg.count, value: agg.total }]),
      ),
      period: { startDate, endDate },
    };
  }

  /**
   * Contacts Summary: POST /contacts/search with date filters.
   * Counts new contacts and groups by tags.
   */
  private async buildContactsReport(startDate: string, endDate: string): Promise<Record<string, unknown>> {
    const contacts = await this.fetchContacts(startDate, endDate);

    const byTag: Record<string, number> = {};
    for (const contact of contacts) {
      const tags = (contact.tags || []) as string[];
      if (tags.length === 0) {
        byTag['Sin tags'] = (byTag['Sin tags'] || 0) + 1;
      } else {
        for (const tag of tags) {
          byTag[tag] = (byTag[tag] || 0) + 1;
        }
      }
    }

    const withEmail = contacts.filter(c => c.email).length;
    const withPhone = contacts.filter(c => c.phone).length;

    return {
      totalContacts: contacts.length,
      withEmail,
      withPhone,
      byTag,
      period: { startDate, endDate },
    };
  }

  /**
   * Conversations Summary: GET /conversations/search with locationId.
   * GHL conversations endpoint doesn't natively support date range filtering,
   * so we fetch recent conversations and filter by lastMessageDate client-side.
   */
  private async buildConversationsReport(startDate: string, endDate: string): Promise<Record<string, unknown>> {
    const startMs = new Date(startDate).getTime();
    const endMs = new Date(endDate + 'T23:59:59Z').getTime();

    const allConversations = await this.fetchConversations();

    // Filter by date range client-side (lastMessageDate)
    const conversations = allConversations.filter(c => {
      const msgDate = new Date(c.lastMessageDate || c.dateUpdated || 0).getTime();
      return msgDate >= startMs && msgDate <= endMs;
    });

    const byType: Record<string, number> = {};
    let unread = 0;
    let starred = 0;
    for (const conv of conversations) {
      const type = conv.type || 'unknown';
      byType[type] = (byType[type] || 0) + 1;
      if (conv.unreadCount > 0) unread++;
      if (conv.starred) starred++;
    }

    return {
      totalConversations: conversations.length,
      unreadConversations: unread,
      starredConversations: starred,
      byType,
      period: { startDate, endDate },
    };
  }

  /**
   * Calendar Summary: GET /calendars/events with startTime and endTime.
   * Aggregates by appointment status (confirmed, showed, noshow, cancelled).
   */
  private async buildCalendarReport(startDate: string, endDate: string): Promise<Record<string, unknown>> {
    const events = await this.fetchCalendarEvents(startDate, endDate);

    const byStatus: Record<string, number> = {};
    for (const event of events) {
      const status = event.appointmentStatus || event.status || 'scheduled';
      byStatus[status] = (byStatus[status] || 0) + 1;
    }

    const byCalendar: Record<string, number> = {};
    for (const event of events) {
      const calName = event.calendarId || 'default';
      byCalendar[calName] = (byCalendar[calName] || 0) + 1;
    }

    return {
      totalEvents: events.length,
      byStatus,
      byCalendar,
      period: { startDate, endDate },
    };
  }

  // ---------------------------------------------------------------------------
  // Raw API calls — each wraps a GHL V2 endpoint with pagination
  // ---------------------------------------------------------------------------

  /**
   * GET /opportunities/search
   * Params: locationId, pipelineId?, status?, q?, date?, startAfter, startAfterId, limit
   */
  private async fetchOpportunities(
    startDate: string,
    endDate: string,
    filters: { pipelineId?: string; status?: string },
  ): Promise<GHLOpportunity[]> {
    const baseParams: Record<string, unknown> = {
      location_id: this.locationId,
      limit: 100,
      date: `${startDate} - ${endDate}`,
    };
    if (filters.pipelineId) baseParams.pipeline_id = filters.pipelineId;
    if (filters.status) baseParams.status = filters.status;

    return fetchAllPages<GHLOpportunity>(this.client, {
      method: 'GET',
      url: '/opportunities/search',
      params: baseParams,
    }, {
      extractItems: (data) => {
        const d = data as { opportunities?: GHLOpportunity[] };
        return d.opportunities || [];
      },
      getNextPageConfig: (data, currentConfig) => {
        const d = data as { meta?: { nextPageUrl?: string; startAfter?: string; startAfterId?: string }; opportunities?: unknown[] };
        if (!d.meta?.startAfterId || (d.opportunities || []).length === 0) return null;
        return {
          ...currentConfig,
          params: { ...currentConfig.params as Record<string, unknown>, startAfter: d.meta.startAfter, startAfterId: d.meta.startAfterId },
        };
      },
      maxPages: 10,
    });
  }

  /**
   * POST /contacts/search (advanced search)
   * Body: locationId, filters with date range on dateAdded, limit, startAfter/startAfterId
   */
  private async fetchContacts(startDate: string, endDate: string): Promise<GHLContact[]> {
    return fetchAllPages<GHLContact>(this.client, {
      method: 'POST',
      url: '/contacts/search',
      data: {
        locationId: this.locationId,
        filters: [
          {
            field: 'dateAdded',
            operator: 'GTE',
            value: new Date(startDate).toISOString(),
          },
          {
            field: 'dateAdded',
            operator: 'LTE',
            value: new Date(endDate + 'T23:59:59Z').toISOString(),
          },
        ],
        page: 1,
        pageLimit: 100,
      },
    }, {
      extractItems: (data) => {
        const d = data as { contacts?: GHLContact[] };
        return d.contacts || [];
      },
      getNextPageConfig: (data, currentConfig) => {
        const d = data as { meta?: { nextPage?: number; total?: number }; contacts?: unknown[] };
        if (!d.meta?.nextPage || (d.contacts || []).length === 0) return null;
        const body = currentConfig.data as Record<string, unknown>;
        return { ...currentConfig, data: { ...body, page: d.meta.nextPage } };
      },
      maxPages: 10,
    });
  }

  /**
   * GET /conversations/search
   * Params: locationId, limit, startAfterDate (cursor)
   */
  private async fetchConversations(): Promise<GHLConversation[]> {
    return fetchAllPages<GHLConversation>(this.client, {
      method: 'GET',
      url: '/conversations/search',
      params: { locationId: this.locationId, limit: 100 },
    }, {
      extractItems: (data) => {
        const d = data as { conversations?: GHLConversation[] };
        return d.conversations || [];
      },
      getNextPageConfig: (data, currentConfig) => {
        const d = data as { conversations?: GHLConversation[]; nextPage?: string };
        if (!d.nextPage || (d.conversations || []).length === 0) return null;
        return {
          ...currentConfig,
          params: { ...currentConfig.params as Record<string, unknown>, startAfterDate: d.nextPage },
        };
      },
      maxPages: 5, // conversations can be large, limit pages
    });
  }

  /**
   * GET /calendars/events
   * Params: locationId, startTime (ISO), endTime (ISO)
   */
  private async fetchCalendarEvents(startDate: string, endDate: string): Promise<GHLEvent[]> {
    const response = await rateLimitedRequest<{ events: GHLEvent[] }>(this.client, {
      method: 'GET',
      url: '/calendars/events',
      params: {
        locationId: this.locationId,
        startTime: new Date(startDate).toISOString(),
        endTime: new Date(endDate + 'T23:59:59Z').toISOString(),
      },
    });

    return response.data.events || [];
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
      pipeline_summary: 'Resumen de Pipeline',
      pipeline_stages_detail: 'Detalle por Etapas del Pipeline',
      contacts_summary: 'Resumen de Contactos',
      conversations_summary: 'Resumen de Conversaciones',
      calendar_summary: 'Resumen de Calendario',
      opportunities_by_source: 'Oportunidades por Fuente',
      opportunities_by_status: 'Oportunidades por Estado',
    };
    return names[reportId] || reportId;
  }
}

// ---------------------------------------------------------------------------
// GHL object types (based on documented API response schemas)
// ---------------------------------------------------------------------------

interface GHLOpportunity {
  id: string;
  name: string;
  monetaryValue?: number;
  pipelineId?: string;
  pipelineStageId: string;
  status?: string; // open, won, lost, abandoned
  source?: string;
  assignedTo?: string;
  contactId?: string;
  dateAdded?: string;
}

interface GHLContact {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  tags?: string[];
  dateAdded?: string;
}

interface GHLConversation {
  id: string;
  type?: string;
  lastMessageDate?: string;
  dateUpdated?: string;
  unreadCount: number;
  starred?: boolean;
  assignedTo?: string;
}

interface GHLEvent {
  id: string;
  calendarId?: string;
  appointmentStatus?: string;
  status?: string;
  title?: string;
  startTime?: string;
  endTime?: string;
}
