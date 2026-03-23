import { Router, Request, Response } from 'express';
import { config } from '../config';
import { ConversationHandler } from '../services/ConversationHandler';
import { logger } from '../utils/logger';

const router = Router();
const handler = new ConversationHandler();

/** WhatsApp webhook verification (GET) */
router.get('/webhook', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === config.whatsapp.verifyToken) {
    logger.info('Webhook verified');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

/** WhatsApp webhook messages (POST) */
router.post('/webhook', async (req: Request, res: Response) => {
  // Always respond 200 quickly to avoid retries
  res.sendStatus(200);

  try {
    const body = req.body;
    const entry = body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    if (!value?.messages?.[0]) return;

    const message = value.messages[0];
    const from = message.from;

    let messageBody = '';
    let interactiveId: string | undefined;

    switch (message.type) {
      case 'text':
        messageBody = message.text?.body || '';
        break;
      case 'interactive':
        if (message.interactive?.type === 'button_reply') {
          interactiveId = message.interactive.button_reply?.id;
          messageBody = message.interactive.button_reply?.title || '';
        } else if (message.interactive?.type === 'list_reply') {
          interactiveId = message.interactive.list_reply?.id;
          messageBody = message.interactive.list_reply?.title || '';
        }
        break;
      default:
        logger.debug('Unsupported message type', { type: message.type });
        return;
    }

    await handler.handleIncomingMessage(from, messageBody, interactiveId);
  } catch (error) {
    logger.error('Webhook processing error', { error });
  }
});

export default router;
