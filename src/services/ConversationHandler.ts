import { User, Conversation, ReportTemplate, ReportLog } from '../models';
import { createCRMAdapter } from './crm';
import { WhatsAppService } from './whatsapp';
import { AIEngine } from './ai';
import { getDateRange } from '../utils/dates';
import { logger } from '../utils/logger';

/**
 * Orchestrates the conversational flow:
 * receives WhatsApp messages, routes them through AI, fetches CRM data, and responds.
 */
export class ConversationHandler {
  private whatsapp: WhatsAppService;
  private ai: AIEngine;

  constructor() {
    this.whatsapp = new WhatsAppService();
    this.ai = new AIEngine();
  }

  /** Process an incoming WhatsApp message */
  async handleIncomingMessage(from: string, messageBody: string, interactiveId?: string): Promise<void> {
    const user = await User.findOne({ whatsappNumber: from, active: true });
    if (!user) {
      await this.whatsapp.sendText(from,
        'No tienes una cuenta configurada. Contacta a tu administrador para activar el asistente de reportes.');
      return;
    }

    // Get or create conversation context
    let conversation = await Conversation.findOne({ whatsappNumber: from });
    if (!conversation) {
      conversation = await Conversation.create({
        userId: user._id,
        whatsappNumber: from,
        history: [],
      });
    }

    // Determine the effective message (button ID or text)
    const effectiveMessage = interactiveId || messageBody;

    // Check if it's a direct action (button press)
    if (interactiveId) {
      await this.handleAction(user, conversation, interactiveId);
      return;
    }

    // Pass through AI for conversational handling
    const adapter = createCRMAdapter(user.crmProvider, user.crmCredentials as Record<string, string>);
    const availableReports = await adapter.listAvailableReports();

    const aiResponse = await this.ai.handleConversation(
      effectiveMessage,
      conversation.history.map(h => ({ role: h.role, content: h.content })),
      availableReports,
      conversation.lastReportData || undefined,
    );

    // Check if AI suggested a report action
    const reportAction = aiResponse.suggestedActions.find(a => a.id.startsWith('report_'));
    if (reportAction && effectiveMessage.toLowerCase().includes('reporte')) {
      // Auto-execute the suggested report
      const reportId = reportAction.id.replace('report_', '');
      await this.fetchAndDeliverReport(user, conversation, reportId, 'this_week');
    } else {
      // Send conversational response with options
      await this.whatsapp.sendReportWithOptions(
        from,
        aiResponse.summary,
        aiResponse.suggestedActions,
      );
    }

    // Update conversation
    conversation.history.push(
      { role: 'user', content: effectiveMessage, timestamp: new Date() },
      { role: 'assistant', content: aiResponse.summary, timestamp: new Date() },
    );
    conversation.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await conversation.save();
  }

  /** Handle a button/action press */
  private async handleAction(
    user: InstanceType<typeof User>,
    conversation: InstanceType<typeof Conversation>,
    actionId: string,
  ): Promise<void> {
    if (actionId.startsWith('report_')) {
      const reportId = actionId.replace('report_', '');
      await this.fetchAndDeliverReport(user, conversation, reportId, 'this_week');
    } else if (actionId.startsWith('period_')) {
      const period = actionId.replace('period_', '');
      const reportId = conversation.lastReportTemplateId;
      if (reportId) {
        await this.fetchAndDeliverReport(user, conversation, reportId, period);
      } else {
        await this.whatsapp.sendText(user.whatsappNumber,
          'No hay un reporte previo. ¿Qué reporte te gustaría consultar?');
      }
    } else if (actionId === 'refresh') {
      const reportId = conversation.lastReportTemplateId;
      if (reportId) {
        await this.fetchAndDeliverReport(user, conversation, reportId, 'this_week');
      }
    } else if (actionId === 'detail') {
      if (conversation.lastReportData) {
        const detail = JSON.stringify(conversation.lastReportData, null, 2).slice(0, 3000);
        await this.whatsapp.sendText(user.whatsappNumber, `📋 *Detalle del reporte:*\n\n${detail}`);
      }
    } else {
      await this.whatsapp.sendText(user.whatsappNumber, 'Acción no reconocida. ¿En qué puedo ayudarte?');
    }
  }

  /** Fetch a CRM report and deliver it via WhatsApp */
  private async fetchAndDeliverReport(
    user: InstanceType<typeof User>,
    conversation: InstanceType<typeof Conversation>,
    reportId: string,
    period: string,
  ): Promise<void> {
    try {
      const adapter = createCRMAdapter(user.crmProvider, user.crmCredentials as Record<string, string>);
      const dateRange = getDateRange(period);
      const report = await adapter.fetchReport(reportId, dateRange);
      const aiResponse = await this.ai.summarizeReport(report, user.language);

      // Build period options for drill-down
      const periodOptions = [
        { id: 'period_this_week', title: 'Esta semana' },
        { id: 'period_last_week', title: 'Semana pasada' },
        { id: 'period_this_month', title: 'Este mes' },
      ];
      const allOptions = [...aiResponse.suggestedActions, ...periodOptions].slice(0, 10);

      await this.whatsapp.sendReportWithOptions(
        user.whatsappNumber,
        aiResponse.summary,
        allOptions,
      );

      // Update conversation context
      conversation.lastReportTemplateId = reportId;
      conversation.lastReportData = report.data;
      conversation.history.push(
        { role: 'assistant', content: aiResponse.summary, timestamp: new Date() },
      );
      await conversation.save();

      // Log the report delivery
      await ReportLog.create({
        userId: user._id,
        reportTemplateId: reportId,
        params: dateRange,
        result: report.data,
        summary: aiResponse.summary,
        deliveredVia: 'on_demand',
      });
    } catch (error) {
      logger.error('Error fetching/delivering report', { reportId, error });
      await this.whatsapp.sendText(user.whatsappNumber,
        'Hubo un error al consultar el reporte. Por favor intenta de nuevo en unos momentos.');
    }
  }
}
