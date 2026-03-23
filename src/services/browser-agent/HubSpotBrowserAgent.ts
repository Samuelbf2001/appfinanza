import { BrowserAgent, ExtractionResult } from './BrowserAgent';
import { ReportResult } from '../../types';
import { logger } from '../../utils/logger';

interface HubSpotCredentials {
  email: string;
  password: string;
  portalId?: string; // HubSpot portal/account ID
}

/**
 * HubSpot Browser Agent
 *
 * Navigates HubSpot dashboards to extract reports not fully available via API:
 * - Custom Report Builder reports
 * - Sales Analytics dashboards (deal velocity, forecast, rep performance)
 * - Marketing dashboards (campaign performance, email analytics)
 * - Service dashboards (ticket resolution, SLA metrics)
 * - Attribution reports
 *
 * Login flow: app.hubspot.com → email → password → 2FA if needed → portal
 *
 * Key HubSpot dashboard URLs:
 * - /reports-dashboard — main reporting dashboards
 * - /contacts/reports  — contact analytics
 * - /sales/deals/board — pipeline board view
 * - /reports/sales     — sales analytics
 */
export class HubSpotBrowserAgent {
  private agent: BrowserAgent;
  private credentials: HubSpotCredentials;
  private isLoggedIn: boolean = false;

  constructor(credentials: HubSpotCredentials) {
    this.agent = new BrowserAgent();
    this.credentials = credentials;
  }

  /** Full login flow for HubSpot */
  async login(): Promise<boolean> {
    try {
      await this.agent.launch();
      await this.agent.goto('https://app.hubspot.com/login');
      await this.agent.getPage().waitForTimeout(2000);

      // HubSpot login is typically two-step: email first, then password
      const loginScreenshot = await this.agent.takeScreenshot('hs_login');

      // Step 1: Enter email
      await this.agent.executeActions([
        { type: 'type', selector: 'input[type="email"], input[name="email"], #username', value: this.credentials.email, description: 'Email' },
        { type: 'click', selector: 'button[type="submit"], #loginBtn, button:has-text("Next")', description: 'Next/Submit' },
        { type: 'wait', delay: 3000, description: 'Wait for password field' },
      ]);

      // Step 2: Enter password
      await this.agent.executeActions([
        { type: 'type', selector: 'input[type="password"], input[name="password"], #password', value: this.credentials.password, description: 'Password' },
        { type: 'click', selector: 'button[type="submit"], #loginBtn, button:has-text("Log in")', description: 'Login button' },
        { type: 'wait', delay: 5000, description: 'Wait for login' },
      ]);

      // Check if login was successful
      const postLoginScreenshot = await this.agent.takeScreenshot('hs_post_login');
      const analysis = await this.agent.analyzeScreenshot(
        postLoginScreenshot,
        'Analiza si el login en HubSpot fue exitoso. ¿Estamos en el dashboard/home? ¿Hay un paso de verificación 2FA? ¿Hay selector de portal/cuenta? Responde con {"loggedIn": true/false, "needs2FA": true/false, "needsPortalSelection": true/false, "error": "mensaje si hay error"}',
      );

      if (analysis.needs2FA) {
        logger.warn('HubSpot login requires 2FA — manual intervention needed');
        return false;
      }

      if (analysis.needsPortalSelection && this.credentials.portalId) {
        // Try to select the correct portal
        await this.agent.executeGoal(
          `Selecciona el portal/cuenta con ID ${this.credentials.portalId} de la lista de cuentas disponibles.`,
          3,
        );
      }

      if (analysis.loggedIn || analysis.needsPortalSelection) {
        this.isLoggedIn = true;
        logger.info('HubSpot login successful');
        return true;
      }

      logger.error('HubSpot login failed', { analysis });
      return false;
    } catch (error) {
      logger.error('HubSpot login error', { error });
      return false;
    }
  }

  /**
   * Extract a specific dashboard by its ID or URL.
   * HubSpot dashboards are at /reports-dashboard/{dashboardId}
   */
  async extractDashboard(dashboardId?: string): Promise<ReportResult> {
    this.ensureLoggedIn();

    const portalPath = this.credentials.portalId ? `/reports-dashboard/${this.credentials.portalId}` : '/reports-dashboard';
    const url = dashboardId
      ? `https://app.hubspot.com${portalPath}/${dashboardId}`
      : `https://app.hubspot.com${portalPath}`;

    await this.agent.goto(url);
    await this.agent.getPage().waitForTimeout(4000);

    const result = await this.agent.executeGoal(
      'Extrae todos los widgets, gráficos y métricas visibles en este dashboard de HubSpot. Para cada widget, captura: título, valor principal, tendencia (si hay), y cualquier desglose visible. Haz scroll down para capturar widgets que no sean visibles inicialmente.',
      8,
    );

    return this.toReportResult(
      `dashboard_${dashboardId || 'main'}`,
      'Dashboard HubSpot (Browser Agent)',
      result,
    );
  }

  /**
   * Extract the Sales Analytics dashboard.
   * Shows: deal velocity, forecast, rep leaderboard, conversion rates.
   */
  async extractSalesAnalytics(): Promise<ReportResult> {
    this.ensureLoggedIn();

    const baseUrl = this.credentials.portalId
      ? `https://app.hubspot.com/reports/${this.credentials.portalId}/sales`
      : 'https://app.hubspot.com/reports/sales';

    await this.agent.goto(baseUrl);
    await this.agent.getPage().waitForTimeout(4000);

    const result = await this.agent.executeGoal(
      'Extrae las métricas de Sales Analytics de HubSpot: pronóstico de ventas (forecast), velocidad del pipeline (deal velocity), rendimiento por representante de ventas, tasas de conversión por etapa, y valor del pipeline. Captura todos los números, porcentajes y tendencias visibles.',
      8,
    );

    return this.toReportResult('sales_analytics', 'Sales Analytics (Browser Agent)', result);
  }

  /**
   * Extract the deal pipeline board view.
   * Captures the Kanban-style board with counts and values per column.
   */
  async extractDealBoard(): Promise<ReportResult> {
    this.ensureLoggedIn();

    const baseUrl = this.credentials.portalId
      ? `https://app.hubspot.com/contacts/${this.credentials.portalId}/deals/board`
      : 'https://app.hubspot.com/contacts/deals/board';

    await this.agent.goto(baseUrl);
    await this.agent.getPage().waitForTimeout(4000);

    const result = await this.agent.executeGoal(
      'Extrae los datos del pipeline board de HubSpot: para cada columna/etapa, captura el nombre de la etapa, la cantidad de negocios y el valor total. También captura el valor total del pipeline visible en la parte superior.',
      5,
    );

    return this.toReportResult('deal_board', 'Pipeline Board (Browser Agent)', result);
  }

  /**
   * Extract marketing analytics.
   * Captures: email performance, campaign metrics, landing page stats.
   */
  async extractMarketingAnalytics(): Promise<ReportResult> {
    this.ensureLoggedIn();

    const baseUrl = this.credentials.portalId
      ? `https://app.hubspot.com/reports/${this.credentials.portalId}/marketing`
      : 'https://app.hubspot.com/reports/marketing';

    await this.agent.goto(baseUrl);
    await this.agent.getPage().waitForTimeout(4000);

    const result = await this.agent.executeGoal(
      'Extrae las métricas de marketing de HubSpot: emails enviados y tasa de apertura, visitas al sitio web, leads generados, conversiones, rendimiento de campañas. Captura todos los números y porcentajes visibles.',
      8,
    );

    return this.toReportResult('marketing_analytics', 'Marketing Analytics (Browser Agent)', result);
  }

  /**
   * Extract a custom report by navigating to it.
   * The AI agent figures out how to get to the report and read it.
   */
  async extractCustomReport(reportName: string): Promise<ReportResult> {
    this.ensureLoggedIn();

    const baseUrl = this.credentials.portalId
      ? `https://app.hubspot.com/reports/${this.credentials.portalId}/list`
      : 'https://app.hubspot.com/reports/list';

    await this.agent.goto(baseUrl);
    await this.agent.getPage().waitForTimeout(3000);

    const result = await this.agent.executeGoal(
      `Busca y abre el reporte llamado "${reportName}" en la lista de reportes de HubSpot. Una vez abierto, extrae todos los datos: tablas, gráficos, métricas y KPIs visibles. Si hay un buscador, úsalo para encontrar el reporte más rápido.`,
      8,
    );

    return this.toReportResult(
      `custom_${reportName.replace(/\s+/g, '_').toLowerCase()}`,
      `${reportName} (Browser Agent)`,
      result,
    );
  }

  /** Set date range filter */
  async setDateFilter(startDate: string, endDate: string): Promise<void> {
    this.ensureLoggedIn();

    const screenshot = await this.agent.takeScreenshot('before_date_filter');
    const actions = await this.agent.planNextActions(
      screenshot,
      `Cambia el filtro de fecha para mostrar datos desde ${startDate} hasta ${endDate}. En HubSpot, busca el selector de fecha en la parte superior del dashboard o reporte.`,
    );
    await this.agent.executeActions(actions);
    await this.agent.getPage().waitForTimeout(2000);
  }

  /** Clean up */
  async cleanup(): Promise<void> {
    await this.agent.cleanup();
    this.isLoggedIn = false;
  }

  private ensureLoggedIn(): void {
    if (!this.isLoggedIn) {
      throw new Error('Not logged in to HubSpot. Call login() first.');
    }
  }

  private toReportResult(
    templateId: string,
    templateName: string,
    extraction: ExtractionResult,
  ): ReportResult {
    return {
      templateId,
      templateName,
      provider: 'hubspot',
      data: {
        ...extraction.data,
        _extractedBy: 'browser-agent',
        _screenshotCount: extraction.screenshots.length,
        _errors: extraction.errors,
      },
      params: {},
      generatedAt: new Date(),
    };
  }
}
