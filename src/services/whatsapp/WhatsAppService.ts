import axios, { AxiosInstance } from 'axios';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import { WhatsAppInteractiveButton, WhatsAppListRow } from '../../types';

export class WhatsAppService {
  private client: AxiosInstance;
  private phoneNumberId: string;

  constructor() {
    this.phoneNumberId = config.whatsapp.phoneNumberId;
    this.client = axios.create({
      baseURL: `${config.whatsapp.apiUrl}/${this.phoneNumberId}`,
      headers: {
        Authorization: `Bearer ${config.whatsapp.accessToken}`,
        'Content-Type': 'application/json',
      },
    });
  }

  /** Send a plain text message */
  async sendText(to: string, text: string): Promise<void> {
    // WhatsApp has a 4096 char limit; split if necessary
    const chunks = this.splitMessage(text, 4000);
    for (const chunk of chunks) {
      await this.client.post('/messages', {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: chunk },
      });
    }
    logger.info('Sent text message', { to, length: text.length });
  }

  /** Send an interactive message with reply buttons (max 3) */
  async sendButtons(to: string, body: string, buttons: WhatsAppInteractiveButton[]): Promise<void> {
    await this.client.post('/messages', {
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: body },
        action: { buttons: buttons.slice(0, 3) },
      },
    });
    logger.info('Sent button message', { to, buttonCount: buttons.length });
  }

  /** Send an interactive list message (max 10 rows per section) */
  async sendList(
    to: string,
    body: string,
    buttonText: string,
    sections: Array<{ title: string; rows: WhatsAppListRow[] }>,
  ): Promise<void> {
    await this.client.post('/messages', {
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: body },
        action: { button: buttonText, sections },
      },
    });
    logger.info('Sent list message', { to });
  }

  /** Send a report summary with drill-down buttons */
  async sendReportWithOptions(
    to: string,
    reportSummary: string,
    options: Array<{ id: string; title: string }>,
  ): Promise<void> {
    if (options.length <= 3) {
      const buttons: WhatsAppInteractiveButton[] = options.map(opt => ({
        type: 'reply' as const,
        reply: { id: opt.id, title: opt.title.slice(0, 20) },
      }));
      await this.sendButtons(to, reportSummary, buttons);
    } else {
      const rows: WhatsAppListRow[] = options.map(opt => ({
        id: opt.id,
        title: opt.title.slice(0, 24),
      }));
      await this.sendList(to, reportSummary, 'Ver opciones', [{ title: 'Reportes', rows }]);
    }
  }

  private splitMessage(text: string, maxLength: number): string[] {
    if (text.length <= maxLength) return [text];
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining);
        break;
      }
      let splitAt = remaining.lastIndexOf('\n', maxLength);
      if (splitAt === -1 || splitAt < maxLength / 2) {
        splitAt = remaining.lastIndexOf(' ', maxLength);
      }
      if (splitAt === -1) splitAt = maxLength;
      chunks.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt).trimStart();
    }
    return chunks;
  }
}
