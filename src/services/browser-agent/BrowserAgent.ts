import { chromium, Browser, Page, BrowserContext } from 'playwright';
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../config';
import { logger } from '../../utils/logger';

export interface BrowserAction {
  type: 'click' | 'type' | 'scroll' | 'wait' | 'screenshot' | 'navigate' | 'select';
  selector?: string;
  value?: string;
  url?: string;
  delay?: number;
  coordinates?: { x: number; y: number };
  description?: string;
}

export interface ExtractionResult {
  success: boolean;
  data: Record<string, unknown>;
  screenshots: string[]; // base64 encoded screenshots
  errors: string[];
}

/**
 * BrowserAgent: AI-powered browser automation for CRM report extraction.
 *
 * Uses Playwright for browser control and Claude Vision to:
 * 1. Navigate CRM dashboards
 * 2. Understand the UI visually (no fragile CSS selectors)
 * 3. Extract report data from screenshots
 * 4. Adapt when the UI changes
 *
 * Flow:
 *   login() → navigateToReport() → extractData() → cleanup()
 *
 * The AI "sees" the page via screenshots and decides what actions to take,
 * making it resilient to UI changes unlike traditional RPA.
 */
export class BrowserAgent {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private anthropic: Anthropic;
  private screenshots: string[] = [];

  constructor() {
    this.anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });
  }

  /** Launch headless browser with stealth settings */
  async launch(): Promise<void> {
    this.browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
      ],
    });

    this.context = await this.browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      locale: 'es-ES',
      timezoneId: 'America/Bogota',
    });

    this.page = await this.context.newPage();
    logger.info('BrowserAgent launched');
  }

  /** Take a screenshot and return as base64 */
  async takeScreenshot(label?: string): Promise<string> {
    if (!this.page) throw new Error('Browser not launched');

    const buffer = await this.page.screenshot({ fullPage: false, type: 'png' });
    const base64 = buffer.toString('base64');
    this.screenshots.push(base64);
    logger.debug('Screenshot taken', { label, totalScreenshots: this.screenshots.length });
    return base64;
  }

  /**
   * Use Claude Vision to analyze a screenshot and extract structured data.
   * The AI interprets what it sees — tables, charts, numbers — and returns JSON.
   */
  async analyzeScreenshot(
    screenshotBase64: string,
    prompt: string,
  ): Promise<Record<string, unknown>> {
    const response = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: screenshotBase64,
            },
          },
          {
            type: 'text',
            text: `${prompt}\n\nResponde EXCLUSIVAMENTE en formato JSON válido. No incluyas explicaciones fuera del JSON.`,
          },
        ],
      }],
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map(block => block.text)
      .join('');

    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found');
      return JSON.parse(jsonMatch[0]);
    } catch {
      logger.warn('Failed to parse AI analysis as JSON', { text: text.slice(0, 200) });
      return { rawText: text, parseError: true };
    }
  }

  /**
   * Ask Claude Vision to determine what actions to take next
   * based on the current page screenshot and a goal.
   */
  async planNextActions(
    screenshotBase64: string,
    goal: string,
    previousActions: string[] = [],
  ): Promise<BrowserAction[]> {
    const response = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: screenshotBase64,
            },
          },
          {
            type: 'text',
            text: `Eres un agente de automatización de navegador. Analiza esta captura de pantalla y determina las acciones necesarias para lograr el siguiente objetivo.

Objetivo: ${goal}

Acciones previas ya realizadas:
${previousActions.length > 0 ? previousActions.map((a, i) => `${i + 1}. ${a}`).join('\n') : 'Ninguna'}

Responde en formato JSON con un array de acciones:
{
  "actions": [
    {"type": "click", "selector": "selector CSS o texto visible", "description": "qué hace este click"},
    {"type": "type", "selector": "selector del input", "value": "texto a escribir"},
    {"type": "wait", "delay": 2000, "description": "esperar a que cargue"},
    {"type": "scroll", "value": "down", "description": "scroll hacia abajo"},
    {"type": "screenshot", "description": "capturar el resultado"}
  ],
  "completed": false,
  "explanation": "breve explicación de por qué estas acciones"
}

Si el objetivo ya está logrado en la pantalla actual, pon "completed": true y "actions": [].
Usa selectores CSS robustos o texto visible del botón/link.`,
          },
        ],
      }],
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map(block => block.text)
      .join('');

    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return [];
      const parsed = JSON.parse(jsonMatch[0]);
      return parsed.actions || [];
    } catch {
      logger.warn('Failed to parse planned actions', { text: text.slice(0, 200) });
      return [];
    }
  }

  /**
   * Execute a sequence of browser actions.
   * Each action is logged so the AI can track what's been done.
   */
  async executeActions(actions: BrowserAction[]): Promise<string[]> {
    if (!this.page) throw new Error('Browser not launched');
    const log: string[] = [];

    for (const action of actions) {
      try {
        switch (action.type) {
          case 'navigate':
            if (action.url) {
              await this.page.goto(action.url, { waitUntil: 'networkidle', timeout: 30000 });
              log.push(`Navigated to ${action.url}`);
            }
            break;

          case 'click':
            if (action.coordinates) {
              await this.page.mouse.click(action.coordinates.x, action.coordinates.y);
              log.push(`Clicked at (${action.coordinates.x}, ${action.coordinates.y})`);
            } else if (action.selector) {
              // Try CSS selector first, then text-based
              try {
                await this.page.click(action.selector, { timeout: 5000 });
              } catch {
                // Fall back to text-based click
                await this.page.getByText(action.selector, { exact: false }).first().click({ timeout: 5000 });
              }
              log.push(`Clicked: ${action.selector}`);
            }
            break;

          case 'type':
            if (action.selector && action.value !== undefined) {
              try {
                await this.page.fill(action.selector, action.value);
              } catch {
                await this.page.getByPlaceholder(action.selector).first().fill(action.value);
              }
              log.push(`Typed "${action.value}" into ${action.selector}`);
            }
            break;

          case 'scroll':
            await this.page.mouse.wheel(0, action.value === 'up' ? -500 : 500);
            log.push(`Scrolled ${action.value || 'down'}`);
            break;

          case 'wait':
            await this.page.waitForTimeout(action.delay || 2000);
            log.push(`Waited ${action.delay || 2000}ms`);
            break;

          case 'screenshot':
            await this.takeScreenshot(action.description);
            log.push('Took screenshot');
            break;

          case 'select':
            if (action.selector && action.value) {
              await this.page.selectOption(action.selector, action.value);
              log.push(`Selected "${action.value}" in ${action.selector}`);
            }
            break;
        }
      } catch (error) {
        const msg = `Action failed: ${action.type} ${action.selector || ''} — ${(error as Error).message}`;
        logger.warn(msg);
        log.push(msg);
      }
    }

    return log;
  }

  /**
   * Autonomous loop: the agent takes a screenshot, asks Claude what to do next,
   * executes those actions, and repeats until the goal is achieved or max steps reached.
   */
  async executeGoal(goal: string, maxSteps: number = 10): Promise<ExtractionResult> {
    if (!this.page) throw new Error('Browser not launched');

    const allLogs: string[] = [];
    const errors: string[] = [];

    for (let step = 0; step < maxSteps; step++) {
      logger.info(`BrowserAgent step ${step + 1}/${maxSteps}`, { goal });

      // Take screenshot of current state
      const screenshot = await this.takeScreenshot(`step_${step}`);

      // Ask AI what to do
      const actions = await this.planNextActions(screenshot, goal, allLogs);

      if (actions.length === 0) {
        logger.info('Goal appears completed');
        break;
      }

      // Execute the planned actions
      const stepLogs = await this.executeActions(actions);
      allLogs.push(...stepLogs);

      // Small wait between steps
      await this.page.waitForTimeout(1000);
    }

    // Final screenshot for data extraction
    const finalScreenshot = await this.takeScreenshot('final');
    const extractedData = await this.analyzeScreenshot(
      finalScreenshot,
      `Extrae todos los datos numéricos, métricas, KPIs y tablas visibles en esta captura de pantalla de un dashboard/reporte de CRM. Organiza los datos de forma estructurada.`,
    );

    return {
      success: errors.length === 0,
      data: extractedData,
      screenshots: this.screenshots,
      errors,
    };
  }

  /** Navigate to a URL */
  async goto(url: string): Promise<void> {
    if (!this.page) throw new Error('Browser not launched');
    await this.page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  }

  /** Get the current page (for custom actions) */
  getPage(): Page {
    if (!this.page) throw new Error('Browser not launched');
    return this.page;
  }

  /** Close browser and clean up */
  async cleanup(): Promise<void> {
    if (this.context) await this.context.close();
    if (this.browser) await this.browser.close();
    this.page = null;
    this.context = null;
    this.browser = null;
    this.screenshots = [];
    logger.info('BrowserAgent cleaned up');
  }
}
