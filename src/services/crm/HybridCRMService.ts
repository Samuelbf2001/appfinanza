import { CRMAdapter, PipelineInfo } from './CRMAdapter';
import { createCRMAdapter } from './index';
import { GoHighLevelBrowserAgent } from '../browser-agent/GoHighLevelBrowserAgent';
import { HubSpotBrowserAgent } from '../browser-agent/HubSpotBrowserAgent';
import { ReportResult, CRMProvider } from '../../types';
import { logger } from '../../utils/logger';

interface BrowserCredentials {
  email: string;
  password: string;
  locationUrl?: string;
  portalId?: string;
}

/**
 * HybridCRMService: combines API access + AI Browser Agent.
 *
 * Strategy:
 * 1. Try the API adapter first (fast, reliable, structured)
 * 2. If the report is not available via API, or the API fails,
 *    fall back to the Browser Agent (slower, but accesses any dashboard report)
 * 3. Some reports are ONLY available via Browser Agent
 *    (e.g., GHL attribution, HubSpot custom reports, visual dashboards)
 *
 * Browser-only reports (not available via API):
 *
 * GoHighLevel:
 *   - dashboard_overview     — Main dashboard KPIs
 *   - reporting_overview     — Reporting tab metrics
 *   - reporting_appointments — Appointment show/no-show rates
 *   - reporting_attribution  — Lead source attribution
 *   - reporting_calls        — Call analytics
 *   - pipeline_visual        — Pipeline Kanban board view
 *
 * HubSpot:
 *   - sales_analytics        — Sales Analytics dashboard
 *   - deal_board             — Deal pipeline board (Kanban)
 *   - marketing_analytics    — Marketing dashboard
 *   - custom_*               — Any custom report by name
 *   - dashboard_*            — Any dashboard by ID
 */
export class HybridCRMService {
  private apiAdapter: CRMAdapter;
  private provider: CRMProvider;
  private apiCredentials: Record<string, string>;
  private browserCredentials?: BrowserCredentials;

  constructor(
    provider: CRMProvider,
    apiCredentials: Record<string, string>,
    browserCredentials?: BrowserCredentials,
  ) {
    this.provider = provider;
    this.apiCredentials = apiCredentials;
    this.browserCredentials = browserCredentials;
    this.apiAdapter = createCRMAdapter(provider, apiCredentials);
  }

  /** Fetch a report using the best available method */
  async fetchReport(reportId: string, params: Record<string, unknown>): Promise<ReportResult> {
    // Check if this is a browser-only report
    if (this.isBrowserOnlyReport(reportId)) {
      return this.fetchViaBrowser(reportId, params);
    }

    // Try API first
    try {
      logger.info('Attempting API fetch', { provider: this.provider, reportId });
      return await this.apiAdapter.fetchReport(reportId, params);
    } catch (apiError) {
      logger.warn('API fetch failed, trying browser agent fallback', { reportId, apiError });

      // Fall back to browser agent if credentials are available
      if (this.browserCredentials) {
        return this.fetchViaBrowser(reportId, params);
      }

      throw apiError;
    }
  }

  /** List all available reports (API + browser-only) */
  async listAllAvailableReports(): Promise<Array<{ id: string; name: string; category: string; description: string; source: 'api' | 'browser' | 'both' }>> {
    const apiReports = await this.apiAdapter.listAvailableReports();
    const apiList = apiReports.map(r => ({ ...r, source: 'api' as const }));

    const browserReports = this.getBrowserOnlyReports();
    const browserList = browserReports.map(r => ({ ...r, source: 'browser' as const }));

    return [...apiList, ...browserList];
  }

  async testConnection(): Promise<{ api: boolean; browser: boolean }> {
    const apiOk = await this.apiAdapter.testConnection();
    let browserOk = false;

    if (this.browserCredentials) {
      const agent = this.createBrowserAgent();
      try {
        browserOk = await agent.login();
      } finally {
        await agent.cleanup();
      }
    }

    return { api: apiOk, browser: browserOk };
  }

  async fetchPipelines(objectType?: string): Promise<PipelineInfo[]> {
    return this.apiAdapter.fetchPipelines(objectType);
  }

  // ---------------------------------------------------------------------------
  // Browser agent execution
  // ---------------------------------------------------------------------------

  private async fetchViaBrowser(reportId: string, params: Record<string, unknown>): Promise<ReportResult> {
    if (!this.browserCredentials) {
      throw new Error('Browser credentials not configured. Cannot use browser agent.');
    }

    const agent = this.createBrowserAgent();

    try {
      const loggedIn = await agent.login();
      if (!loggedIn) {
        throw new Error('Browser agent failed to log in');
      }

      // Set date filter if provided
      if (params.startDate && params.endDate) {
        await agent.setDateFilter(params.startDate as string, params.endDate as string);
      }

      // Route to the appropriate extraction method
      return await this.executeExtraction(agent, reportId);
    } finally {
      await agent.cleanup();
    }
  }

  private async executeExtraction(
    agent: GoHighLevelBrowserAgent | HubSpotBrowserAgent,
    reportId: string,
  ): Promise<ReportResult> {
    if (this.provider === 'gohighlevel') {
      const ghlAgent = agent as GoHighLevelBrowserAgent;
      switch (reportId) {
        case 'dashboard_overview':
          return ghlAgent.extractDashboardOverview();
        case 'reporting_overview':
          return ghlAgent.extractReportingSection('overview');
        case 'reporting_appointments':
          return ghlAgent.extractReportingSection('appointments');
        case 'reporting_attribution':
          return ghlAgent.extractReportingSection('attribution');
        case 'reporting_calls':
          return ghlAgent.extractReportingSection('calls');
        case 'pipeline_visual':
          return ghlAgent.extractPipelineView();
        default:
          // Try API report names as fallback in reporting section
          return ghlAgent.extractReportingSection('overview');
      }
    } else {
      const hsAgent = agent as HubSpotBrowserAgent;
      switch (reportId) {
        case 'sales_analytics':
          return hsAgent.extractSalesAnalytics();
        case 'deal_board':
          return hsAgent.extractDealBoard();
        case 'marketing_analytics':
          return hsAgent.extractMarketingAnalytics();
        default:
          if (reportId.startsWith('dashboard_')) {
            const dashboardId = reportId.replace('dashboard_', '');
            return hsAgent.extractDashboard(dashboardId);
          }
          if (reportId.startsWith('custom_')) {
            const reportName = reportId.replace('custom_', '').replace(/_/g, ' ');
            return hsAgent.extractCustomReport(reportName);
          }
          return hsAgent.extractDashboard();
      }
    }
  }

  private createBrowserAgent(): GoHighLevelBrowserAgent | HubSpotBrowserAgent {
    if (this.provider === 'gohighlevel') {
      return new GoHighLevelBrowserAgent({
        email: this.browserCredentials!.email,
        password: this.browserCredentials!.password,
        locationUrl: this.browserCredentials!.locationUrl,
      });
    } else {
      return new HubSpotBrowserAgent({
        email: this.browserCredentials!.email,
        password: this.browserCredentials!.password,
        portalId: this.browserCredentials!.portalId,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Report catalogs
  // ---------------------------------------------------------------------------

  private isBrowserOnlyReport(reportId: string): boolean {
    const browserOnly = this.getBrowserOnlyReports();
    return browserOnly.some(r => r.id === reportId) || reportId.startsWith('custom_') || reportId.startsWith('dashboard_');
  }

  private getBrowserOnlyReports(): Array<{ id: string; name: string; category: string; description: string }> {
    if (this.provider === 'gohighlevel') {
      return [
        { id: 'dashboard_overview', name: 'Dashboard General', category: 'overview', description: 'KPIs agregados del dashboard principal de GHL (solo via browser).' },
        { id: 'reporting_overview', name: 'Reporte General', category: 'reporting', description: 'Métricas del tab de Reporting: llamadas, citas, emails (solo via browser).' },
        { id: 'reporting_appointments', name: 'Reporte de Citas', category: 'reporting', description: 'Show rate, no-show rate, citas confirmadas/canceladas (solo via browser).' },
        { id: 'reporting_attribution', name: 'Reporte de Atribución', category: 'reporting', description: 'Fuentes de leads y canales de adquisición (solo via browser).' },
        { id: 'reporting_calls', name: 'Reporte de Llamadas', category: 'reporting', description: 'Llamadas entrantes/salientes, duración, tasa de respuesta (solo via browser).' },
        { id: 'pipeline_visual', name: 'Pipeline Visual (Kanban)', category: 'ventas', description: 'Vista Kanban del pipeline con contadores y valores por columna (solo via browser).' },
      ];
    } else {
      return [
        { id: 'sales_analytics', name: 'Sales Analytics', category: 'ventas', description: 'Forecast, deal velocity, rendimiento por rep (solo via browser).' },
        { id: 'deal_board', name: 'Pipeline Board', category: 'ventas', description: 'Vista Kanban del pipeline con contadores por etapa (solo via browser).' },
        { id: 'marketing_analytics', name: 'Marketing Analytics', category: 'marketing', description: 'Email performance, campañas, landing pages (solo via browser).' },
      ];
    }
  }
}
