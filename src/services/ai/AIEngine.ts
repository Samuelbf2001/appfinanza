import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../config';
import { ReportResult } from '../../types';
import { logger } from '../../utils/logger';

interface AIResponse {
  summary: string;
  suggestedActions: Array<{ id: string; title: string }>;
}

export class AIEngine {
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic({ apiKey: config.anthropic.apiKey });
  }

  /** Summarize a CRM report into a human-readable WhatsApp message */
  async summarizeReport(report: ReportResult, language: string = 'es'): Promise<AIResponse> {
    const systemPrompt = language === 'es'
      ? `Eres un asistente de reportes de CRM que presenta información de manera clara y concisa para gerentes vía WhatsApp.
Reglas:
- Usa formato de texto plano compatible con WhatsApp (negritas con *texto*, cursiva con _texto_).
- Sé conciso: máximo 500 caracteres para el resumen.
- Incluye los números y métricas clave.
- Sugiere 2-3 acciones de seguimiento relevantes como opciones de exploración.
- Responde siempre en español.`
      : `You are a CRM report assistant that presents information clearly and concisely for managers via WhatsApp.
Rules:
- Use plain text formatting compatible with WhatsApp (bold with *text*, italic with _text_).
- Be concise: maximum 500 characters for the summary.
- Include key numbers and metrics.
- Suggest 2-3 relevant follow-up actions as exploration options.`;

    const userMessage = `Genera un resumen del siguiente reporte de CRM y sugiere acciones de seguimiento.

Reporte: ${report.templateName}
Período: ${JSON.stringify(report.params)}
Datos: ${JSON.stringify(report.data)}

Responde en formato JSON con esta estructura:
{
  "summary": "texto del resumen para WhatsApp",
  "suggestedActions": [
    {"id": "action_id", "title": "Título corto (max 20 chars)"}
  ]
}`;

    try {
      const response = await this.client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      });

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map(block => block.text)
        .join('');

      return this.parseAIResponse(text);
    } catch (error) {
      logger.error('AI summarizeReport error', { error });
      return {
        summary: `📊 *${report.templateName}*\n\n${JSON.stringify(report.data, null, 2).slice(0, 400)}`,
        suggestedActions: [
          { id: 'refresh', title: 'Actualizar datos' },
          { id: 'detail', title: 'Ver detalle' },
        ],
      };
    }
  }

  /** Handle a conversational message from the user */
  async handleConversation(
    userMessage: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
    availableReports: Array<{ id: string; name: string; category: string }>,
    lastReportData?: Record<string, unknown>,
  ): Promise<AIResponse> {
    const systemPrompt = `Eres un asistente de CRM vía WhatsApp. Ayudas a gerentes a consultar y entender sus reportes de negocio.

Reportes disponibles:
${availableReports.map(r => `- ${r.id}: ${r.name} (${r.category})`).join('\n')}

${lastReportData ? `Último reporte consultado:\n${JSON.stringify(lastReportData).slice(0, 500)}` : ''}

Reglas:
- Responde en español, de forma concisa y amigable.
- Si el usuario pide un reporte, identifica cuál de los disponibles aplica.
- Sugiere siempre opciones de seguimiento como botones.
- Usa formato WhatsApp (*negrita*, _cursiva_).

Responde SIEMPRE en formato JSON:
{
  "summary": "tu respuesta al usuario",
  "suggestedActions": [
    {"id": "report_<report_id>", "title": "Título (max 20 chars)"},
    {"id": "period_<periodo>", "title": "Título (max 20 chars)"}
  ]
}

Los IDs de acción pueden ser:
- report_<id>: para solicitar un reporte específico
- period_<periodo>: para cambiar el período (today, this_week, last_week, this_month, last_month, this_quarter)
- refresh: para actualizar el último reporte
- detail: para ver más detalle del último reporte`;

    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
      ...history.slice(-10), // Keep last 10 messages for context
      { role: 'user', content: userMessage },
    ];

    try {
      const response = await this.client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: systemPrompt,
        messages,
      });

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map(block => block.text)
        .join('');

      return this.parseAIResponse(text);
    } catch (error) {
      logger.error('AI handleConversation error', { error });
      return {
        summary: 'Disculpa, tuve un problema procesando tu solicitud. ¿Puedes intentar de nuevo?',
        suggestedActions: [
          { id: 'report_pipeline_summary', title: 'Ver pipeline' },
          { id: 'report_contacts_summary', title: 'Ver contactos' },
        ],
      };
    }
  }

  private parseAIResponse(text: string): AIResponse {
    try {
      // Extract JSON from the response (it might be wrapped in markdown code blocks)
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found in response');
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        summary: parsed.summary || text,
        suggestedActions: (parsed.suggestedActions || []).slice(0, 10),
      };
    } catch {
      return {
        summary: text.slice(0, 500),
        suggestedActions: [{ id: 'refresh', title: 'Actualizar' }],
      };
    }
  }
}
