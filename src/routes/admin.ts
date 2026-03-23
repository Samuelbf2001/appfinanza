import { Router, Request, Response } from 'express';
import { User, ReportTemplate, ReportLog } from '../models';
import { createCRMAdapter } from '../services/crm';
import { SchedulerService } from '../services/scheduler';
import { logger } from '../utils/logger';

const router = Router();

// --- Users ---

router.post('/users', async (req: Request, res: Response) => {
  try {
    const user = await User.create(req.body);
    res.status(201).json(user);
  } catch (error) {
    logger.error('Create user error', { error });
    res.status(400).json({ error: 'Error creating user' });
  }
});

router.get('/users', async (_req: Request, res: Response) => {
  const users = await User.find({ active: true }).select('-crmCredentials');
  res.json(users);
});

router.get('/users/:id', async (req: Request, res: Response) => {
  const user = await User.findById(req.params.id).select('-crmCredentials');
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

router.put('/users/:id', async (req: Request, res: Response) => {
  const user = await User.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

// --- Report Templates ---

router.post('/report-templates', async (req: Request, res: Response) => {
  try {
    const template = await ReportTemplate.create(req.body);
    res.status(201).json(template);
  } catch (error) {
    logger.error('Create report template error', { error });
    res.status(400).json({ error: 'Error creating report template' });
  }
});

router.get('/report-templates', async (req: Request, res: Response) => {
  const filter: Record<string, unknown> = { active: true };
  if (req.query.provider) filter.provider = req.query.provider;
  const templates = await ReportTemplate.find(filter);
  res.json(templates);
});

// --- Schedules ---

router.post('/users/:id/schedules', async (req: Request, res: Response) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.schedules.push(req.body);
    await user.save();

    // Register with the scheduler
    const scheduler = new SchedulerService();
    await scheduler.upsertSchedule(user.id, user.whatsappNumber, user.crmProvider, req.body);

    res.status(201).json(user.schedules);
  } catch (error) {
    logger.error('Create schedule error', { error });
    res.status(400).json({ error: 'Error creating schedule' });
  }
});

// --- CRM Connection Test ---

router.post('/test-connection', async (req: Request, res: Response) => {
  try {
    const { provider, credentials } = req.body;
    const adapter = createCRMAdapter(provider, credentials);
    const connected = await adapter.testConnection();
    res.json({ connected });
  } catch (error) {
    res.json({ connected: false, error: 'Connection failed' });
  }
});

// --- CRM Diagnostics ---

/** List available reports directly from the CRM adapter */
router.post('/crm-reports', async (req: Request, res: Response) => {
  try {
    const { provider, credentials } = req.body;
    const adapter = createCRMAdapter(provider, credentials);
    const reports = await adapter.listAvailableReports();
    res.json({ provider, reports });
  } catch (error) {
    logger.error('List CRM reports error', { error });
    res.status(400).json({ error: 'Error listing CRM reports' });
  }
});

/** Fetch pipeline metadata from CRM (stage names, IDs) */
router.post('/crm-pipelines', async (req: Request, res: Response) => {
  try {
    const { provider, credentials, objectType } = req.body;
    const adapter = createCRMAdapter(provider, credentials);
    const pipelines = await adapter.fetchPipelines(objectType);
    res.json({ provider, pipelines });
  } catch (error) {
    logger.error('Fetch CRM pipelines error', { error });
    res.status(400).json({ error: 'Error fetching pipelines' });
  }
});

/** Preview a report: fetch from CRM, summarize with AI, return without sending to WhatsApp */
router.post('/preview-report', async (req: Request, res: Response) => {
  try {
    const { provider, credentials, reportId, startDate, endDate } = req.body;
    const adapter = createCRMAdapter(provider, credentials);
    const report = await adapter.fetchReport(reportId, { startDate, endDate });

    const { AIEngine } = await import('../services/ai');
    const ai = new AIEngine();
    const aiResponse = await ai.summarizeReport(report);

    res.json({
      report,
      aiSummary: aiResponse.summary,
      suggestedActions: aiResponse.suggestedActions,
    });
  } catch (error) {
    logger.error('Preview report error', { error });
    res.status(400).json({ error: 'Error previewing report' });
  }
});

// --- Hybrid CRM Service (API + Browser Agent) ---

/**
 * List ALL available reports: API-based + browser-only.
 * Browser-only reports require browserCredentials to be configured.
 */
router.post('/hybrid-reports', async (req: Request, res: Response) => {
  try {
    const { provider, apiCredentials, browserCredentials } = req.body;
    const { HybridCRMService } = await import('../services/crm/HybridCRMService');
    const service = new HybridCRMService(provider, apiCredentials, browserCredentials);
    const reports = await service.listAllAvailableReports();
    res.json({ provider, reports });
  } catch (error) {
    logger.error('List hybrid reports error', { error });
    res.status(400).json({ error: 'Error listing reports' });
  }
});

/**
 * Fetch a report using the hybrid approach (API first, browser fallback).
 * For browser-only reports, browserCredentials are required.
 */
router.post('/hybrid-fetch', async (req: Request, res: Response) => {
  try {
    const { provider, apiCredentials, browserCredentials, reportId, startDate, endDate } = req.body;
    const { HybridCRMService } = await import('../services/crm/HybridCRMService');
    const service = new HybridCRMService(provider, apiCredentials, browserCredentials);
    const report = await service.fetchReport(reportId, { startDate, endDate });

    const { AIEngine } = await import('../services/ai');
    const ai = new AIEngine();
    const aiResponse = await ai.summarizeReport(report);

    res.json({
      report,
      aiSummary: aiResponse.summary,
      suggestedActions: aiResponse.suggestedActions,
    });
  } catch (error) {
    logger.error('Hybrid fetch error', { error });
    res.status(400).json({ error: 'Error fetching report' });
  }
});

/** Test both API and browser connections */
router.post('/hybrid-test', async (req: Request, res: Response) => {
  try {
    const { provider, apiCredentials, browserCredentials } = req.body;
    const { HybridCRMService } = await import('../services/crm/HybridCRMService');
    const service = new HybridCRMService(provider, apiCredentials, browserCredentials);
    const result = await service.testConnection();
    res.json({ provider, ...result });
  } catch (error) {
    res.status(400).json({ error: 'Connection test failed' });
  }
});

// --- Report Logs ---

router.get('/report-logs', async (req: Request, res: Response) => {
  const filter: Record<string, unknown> = {};
  if (req.query.userId) filter.userId = req.query.userId;
  const logs = await ReportLog.find(filter).sort({ deliveredAt: -1 }).limit(50);
  res.json(logs);
});

export default router;
