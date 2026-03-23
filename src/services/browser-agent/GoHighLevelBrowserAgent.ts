import { BrowserAgent, ExtractionResult } from './BrowserAgent';
import { ReportResult } from '../../types';
import { logger } from '../../utils/logger';

interface GHLCredentials {
  email: string;
  password: string;
  locationUrl?: string; // e.g., https://app.gohighlevel.com/location/xxx
}

/**
 * GoHighLevel Browser Agent
 *
 * Navigates the GHL dashboard to extract reports that are NOT available via API:
 * - Dashboard overview metrics (aggregate KPIs)
 * - Custom reporting dashboards
 * - Attribution reports
 * - Funnel/pipeline visual reports
 *
 * Login flow: app.gohighlevel.com → email/password → 2FA if needed → location dashboard
 *
 * Reports available in GHL UI but NOT in API:
 * - Agency-level rollup reports
 * - Attribution reporting
 * - Google/Facebook ad spend reports
 * - Conversion tracking dashboards
 * - Appointment show rate reports
 */
export class GoHighLevelBrowserAgent {
  private agent: BrowserAgent;
  private credentials: GHLCredentials;
  private isLoggedIn: boolean = false;

  constructor(credentials: GHLCredentials) {
    this.agent = new BrowserAgent();
    this.credentials = credentials;
  }

  /** Full login flow for GoHighLevel */
  async login(): Promise<boolean> {
    try {
      await this.agent.launch();
      await this.agent.goto('https://app.gohighlevel.com/login');
      await this.agent.getPage().waitForTimeout(2000);

      // Take screenshot to see login page
      const loginScreenshot = await this.agent.takeScreenshot('ghl_login');

      // Use AI to navigate the login form
      const loginActions = await this.agent.planNextActions(
        loginScreenshot,
        `Inicia sesión en GoHighLevel con el email "${this.credentials.email}" y contraseña. Busca los campos de email y password y el botón de login/sign in.`,
      );

      // Execute AI-planned login, but override with actual credentials
      await this.agent.executeActions([
        { type: 'type', selector: 'input[type="email"], input[name="email"], #email', value: this.credentials.email, description: 'Email' },
        { type: 'type', selector: 'input[type="password"], input[name="password"], #password', value: this.credentials.password, description: 'Password' },
        { type: 'click', selector: 'button[type="submit"], .login-btn, button:has-text("Sign In")', description: 'Login button' },
        { type: 'wait', delay: 5000, description: 'Wait for login' },
      ]);

      // Check if login was successful
      const postLoginScreenshot = await this.agent.takeScreenshot('ghl_post_login');
      const analysis = await this.agent.analyzeScreenshot(
        postLoginScreenshot,
        'Analiza si el login fue exitoso. ¿Estamos en el dashboard o hay un error? ¿Hay un paso de verificación 2FA? Responde con {"loggedIn": true/false, "needs2FA": true/false, "error": "mensaje si hay error"}',
      );

      if (analysis.needs2FA) {
        logger.warn('GHL login requires 2FA — manual intervention needed');
        return false;
      }

      if (analysis.loggedIn) {
        this.isLoggedIn = true;

        // Navigate to specific location if provided
        if (this.credentials.locationUrl) {
          await this.agent.goto(this.credentials.locationUrl);
          await this.agent.getPage().waitForTimeout(3000);
        }

        logger.info('GHL login successful');
        return true;
      }

      logger.error('GHL login failed', { analysis });
      return false;
    } catch (error) {
      logger.error('GHL login error', { error });
      return false;
    }
  }

  /**
   * Extract the main dashboard overview.
   * GHL dashboard shows: opportunities, revenue, contacts, appointments — aggregated.
   * These metrics are NOT available via API.
   */
  async extractDashboardOverview(): Promise<ReportResult> {
    this.ensureLoggedIn();

    // Navigate to dashboard
    await this.agent.goto(
      this.credentials.locationUrl
        ? `${this.credentials.locationUrl}/dashboard`
        : 'https://app.gohighlevel.com/dashboard',
    );
    await this.agent.getPage().waitForTimeout(3000);

    const result = await this.agent.executeGoal(
      'Estoy en el dashboard de GoHighLevel. Necesito extraer todas las métricas visibles: oportunidades, valor del pipeline, contactos nuevos, citas programadas, tasa de conversión, y cualquier otro KPI visible. Si hay filtros de fecha, asegúrate de capturar el período seleccionado.',
      5,
    );

    return this.toReportResult('dashboard_overview', 'Dashboard General (Browser Agent)', result);
  }

  /**
   * Extract the reporting section.
   * GHL Reporting tab has: appointment reports, call reports, attribution reports.
   */
  async extractReportingSection(reportType: string = 'overview'): Promise<ReportResult> {
    this.ensureLoggedIn();

    const reportUrls: Record<string, { path: string; goal: string }> = {
      overview: {
        path: '/reporting',
        goal: 'Extrae todas las métricas del reporte general: llamadas, citas, emails enviados, conversiones, y cualquier gráfico o tabla con datos.',
      },
      appointments: {
        path: '/reporting/appointments',
        goal: 'Extrae el reporte de citas: total de citas, show rate, no-show rate, citas confirmadas, canceladas, y el desglose por calendario o usuario si está disponible.',
      },
      attribution: {
        path: '/reporting/attribution',
        goal: 'Extrae el reporte de atribución: fuentes de leads, canales de adquisición, conversión por fuente, y costos si están disponibles.',
      },
      calls: {
        path: '/reporting/calls',
        goal: 'Extrae el reporte de llamadas: total de llamadas, duración promedio, llamadas entrantes vs salientes, llamadas contestadas vs perdidas.',
      },
    };

    const reportConfig = reportUrls[reportType] || reportUrls.overview;
    const baseUrl = this.credentials.locationUrl || 'https://app.gohighlevel.com';

    await this.agent.goto(`${baseUrl}${reportConfig.path}`);
    await this.agent.getPage().waitForTimeout(3000);

    const result = await this.agent.executeGoal(reportConfig.goal, 6);

    return this.toReportResult(
      `reporting_${reportType}`,
      `Reporte ${reportType} (Browser Agent)`,
      result,
    );
  }

  /**
   * Extract opportunities/pipeline visual report.
   * The pipeline view in GHL shows a Kanban board — we extract counts and values per stage.
   */
  async extractPipelineView(pipelineName?: string): Promise<ReportResult> {
    this.ensureLoggedIn();

    const baseUrl = this.credentials.locationUrl || 'https://app.gohighlevel.com';
    await this.agent.goto(`${baseUrl}/opportunities/list`);
    await this.agent.getPage().waitForTimeout(3000);

    let goal = 'Extrae los datos del pipeline de oportunidades: cantidad por etapa, valor monetario por etapa, total de oportunidades y valor total. Si hay vista Kanban, captura los contadores de cada columna.';

    if (pipelineName) {
      goal = `Primero selecciona el pipeline "${pipelineName}", luego ${goal}`;
    }

    const result = await this.agent.executeGoal(goal, 6);

    return this.toReportResult('pipeline_visual', 'Pipeline Visual (Browser Agent)', result);
  }

  /** Set date range filter on the current page */
  async setDateFilter(startDate: string, endDate: string): Promise<void> {
    this.ensureLoggedIn();

    const screenshot = await this.agent.takeScreenshot('before_date_filter');
    const actions = await this.agent.planNextActions(
      screenshot,
      `Cambia el filtro de fecha para mostrar datos desde ${startDate} hasta ${endDate}. Busca un date picker, selector de rango de fechas o filtro de período.`,
    );
    await this.agent.executeActions(actions);
    await this.agent.getPage().waitForTimeout(2000);
  }

  /** Clean up browser resources */
  async cleanup(): Promise<void> {
    await this.agent.cleanup();
    this.isLoggedIn = false;
  }

  private ensureLoggedIn(): void {
    if (!this.isLoggedIn) {
      throw new Error('Not logged in to GoHighLevel. Call login() first.');
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
      provider: 'gohighlevel',
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
