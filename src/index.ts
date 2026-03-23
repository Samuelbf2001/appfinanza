import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import { config } from './config';
import { logger } from './utils/logger';
import { SchedulerService } from './services/scheduler';
import webhookRoutes from './routes/webhook';
import adminRoutes from './routes/admin';

const app = express();

app.use(cors());
app.use(express.json());

// Routes
app.use('/api', webhookRoutes);
app.use('/api/admin', adminRoutes);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

async function start() {
  try {
    await mongoose.connect(config.mongodbUri);
    logger.info('Connected to MongoDB');

    const scheduler = new SchedulerService();
    await scheduler.initialize();
    logger.info('Scheduler initialized');

    app.listen(config.port, () => {
      logger.info(`Server running on port ${config.port}`);
    });
  } catch (error) {
    logger.error('Failed to start server', { error });
    process.exit(1);
  }
}

start();

export default app;
