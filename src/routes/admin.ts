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

// --- Report Logs ---

router.get('/report-logs', async (req: Request, res: Response) => {
  const filter: Record<string, unknown> = {};
  if (req.query.userId) filter.userId = req.query.userId;
  const logs = await ReportLog.find(filter).sort({ deliveredAt: -1 }).limit(50);
  res.json(logs);
});

export default router;
