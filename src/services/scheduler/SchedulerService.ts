import { CronJob } from 'cron';
import { User } from '../../models';
import { ReportTemplate } from '../../models';
import { ReportLog } from '../../models';
import { createCRMAdapter } from '../crm';
import { WhatsAppService } from '../whatsapp';
import { AIEngine } from '../ai';
import { getDateRange } from '../../utils/dates';
import { logger } from '../../utils/logger';

export class SchedulerService {
  private jobs: Map<string, CronJob> = new Map();
  private whatsapp: WhatsAppService;
  private ai: AIEngine;

  constructor() {
    this.whatsapp = new WhatsAppService();
    this.ai = new AIEngine();
  }

  /** Initialize all scheduled jobs from the database */
  async initialize(): Promise<void> {
    const users = await User.find({ active: true, 'schedules.active': true });
    for (const user of users) {
      for (const schedule of user.schedules.filter(s => s.active)) {
        this.createJob(user.id, user.whatsappNumber, user.crmProvider, schedule);
      }
    }
    logger.info(`Scheduler initialized with ${this.jobs.size} jobs`);
  }

  /** Create a cron job for a user schedule */
  private createJob(
    userId: string,
    whatsappNumber: string,
    crmProvider: string,
    schedule: { reportTemplateId: string; config: { frequency: string; dayOfWeek?: number; hour: number; minute: number; timezone: string } },
  ): void {
    const cronExpression = this.toCron(schedule.config);
    const jobKey = `${userId}_${schedule.reportTemplateId}`;

    // Remove existing job if any
    this.removeJob(jobKey);

    const job = new CronJob(
      cronExpression,
      async () => {
        await this.executeScheduledReport(userId, whatsappNumber, crmProvider, schedule.reportTemplateId);
      },
      null,
      true,
      schedule.config.timezone,
    );

    this.jobs.set(jobKey, job);
    logger.info('Created scheduled job', { jobKey, cronExpression });
  }

  /** Execute a scheduled report delivery */
  private async executeScheduledReport(
    userId: string,
    whatsappNumber: string,
    crmProvider: string,
    reportTemplateId: string,
  ): Promise<void> {
    try {
      const template = await ReportTemplate.findOne({ _id: reportTemplateId, active: true });
      if (!template) {
        logger.warn('Report template not found for scheduled job', { reportTemplateId });
        return;
      }

      const user = await User.findById(userId);
      if (!user || !user.active) return;

      const adapter = createCRMAdapter(
        crmProvider as 'gohighlevel' | 'hubspot',
        user.crmCredentials as Record<string, string>,
      );

      // Use the default period or "this_week"
      const period = (template.defaultParams.period as string) || 'this_week';
      const dateRange = getDateRange(period);
      const params = { ...template.defaultParams, ...dateRange };

      const report = await adapter.fetchReport(template.crmReportId, params);
      const aiResponse = await this.ai.summarizeReport(report, user.language);

      await this.whatsapp.sendReportWithOptions(
        whatsappNumber,
        `📊 *Reporte Programado*\n\n${aiResponse.summary}`,
        aiResponse.suggestedActions,
      );

      await ReportLog.create({
        userId,
        reportTemplateId,
        params,
        result: report.data,
        summary: aiResponse.summary,
        deliveredVia: 'scheduled',
      });

      logger.info('Scheduled report delivered', { userId, reportTemplateId });
    } catch (error) {
      logger.error('Error executing scheduled report', { userId, reportTemplateId, error });
    }
  }

  /** Convert schedule config to cron expression */
  private toCron(cfg: { frequency: string; dayOfWeek?: number; hour: number; minute: number }): string {
    const { minute, hour, dayOfWeek } = cfg;
    switch (cfg.frequency) {
      case 'daily':
        return `${minute} ${hour} * * *`;
      case 'weekly':
        return `${minute} ${hour} * * ${dayOfWeek ?? 1}`;
      case 'biweekly':
        // Run weekly, the service will track and skip alternate weeks
        return `${minute} ${hour} * * ${dayOfWeek ?? 1}`;
      case 'monthly':
        return `${minute} ${hour} 1 * *`;
      default:
        return `${minute} ${hour} * * ${dayOfWeek ?? 1}`;
    }
  }

  removeJob(jobKey: string): void {
    const existing = this.jobs.get(jobKey);
    if (existing) {
      existing.stop();
      this.jobs.delete(jobKey);
    }
  }

  /** Add or update a schedule for a user */
  async upsertSchedule(
    userId: string,
    whatsappNumber: string,
    crmProvider: string,
    schedule: { reportTemplateId: string; config: { frequency: string; dayOfWeek?: number; hour: number; minute: number; timezone: string } },
  ): Promise<void> {
    this.createJob(userId, whatsappNumber, crmProvider, schedule);
  }

  stopAll(): void {
    for (const [key, job] of this.jobs) {
      job.stop();
      this.jobs.delete(key);
    }
    logger.info('All scheduled jobs stopped');
  }
}
