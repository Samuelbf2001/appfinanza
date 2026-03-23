/**
 * Seed script: populates default report templates for GoHighLevel and HubSpot.
 * Run: npx ts-node scripts/seed.ts
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

import { ReportTemplate } from '../src/models';

const templates = [
  // ---------------------------------------------------------------------------
  // GoHighLevel templates
  // GHL has no native reporting API — we query object endpoints and aggregate.
  // ---------------------------------------------------------------------------
  {
    name: 'Resumen de Pipeline',
    description: 'Total de oportunidades, valor monetario, tasa de cierre y distribución por etapa. Usa GET /opportunities/search + GET /opportunities/pipelines.',
    provider: 'gohighlevel',
    crmReportId: 'pipeline_summary',
    category: 'ventas',
    defaultParams: { period: 'this_week' },
    relatedReports: ['pipeline_stages_detail', 'opportunities_by_status', 'opportunities_by_source'],
  },
  {
    name: 'Detalle por Etapas del Pipeline',
    description: 'Desglose detallado de oportunidades por cada etapa con valores, conteos y estados. Usa GET /opportunities/search.',
    provider: 'gohighlevel',
    crmReportId: 'pipeline_stages_detail',
    category: 'ventas',
    defaultParams: { period: 'this_week' },
    relatedReports: ['pipeline_summary', 'opportunities_by_status'],
  },
  {
    name: 'Oportunidades por Estado',
    description: 'Distribución de oportunidades por estado (open, won, lost, abandoned). Usa GET /opportunities/search.',
    provider: 'gohighlevel',
    crmReportId: 'opportunities_by_status',
    category: 'ventas',
    defaultParams: { period: 'this_week' },
    relatedReports: ['pipeline_summary'],
  },
  {
    name: 'Oportunidades por Fuente',
    description: 'Origen de las oportunidades para medir efectividad de canales. Usa GET /opportunities/search.',
    provider: 'gohighlevel',
    crmReportId: 'opportunities_by_source',
    category: 'ventas',
    defaultParams: { period: 'this_month' },
    relatedReports: ['pipeline_summary', 'contacts_summary'],
  },
  {
    name: 'Resumen de Contactos',
    description: 'Contactos nuevos en el período con distribución por tags y datos de contacto. Usa POST /contacts/search (advanced).',
    provider: 'gohighlevel',
    crmReportId: 'contacts_summary',
    category: 'contactos',
    defaultParams: { period: 'this_week' },
    relatedReports: ['pipeline_summary', 'conversations_summary'],
  },
  {
    name: 'Resumen de Conversaciones',
    description: 'Actividad de conversaciones: total, por tipo, no leídas. Usa GET /conversations/search con filtro de fecha client-side.',
    provider: 'gohighlevel',
    crmReportId: 'conversations_summary',
    category: 'comunicación',
    defaultParams: { period: 'this_week' },
    relatedReports: ['contacts_summary', 'pipeline_summary'],
  },
  {
    name: 'Resumen de Calendario',
    description: 'Citas programadas, confirmadas, completadas y canceladas. Usa GET /calendars/events con startTime/endTime.',
    provider: 'gohighlevel',
    crmReportId: 'calendar_summary',
    category: 'agenda',
    defaultParams: { period: 'this_week' },
    relatedReports: ['pipeline_summary'],
  },

  // ---------------------------------------------------------------------------
  // HubSpot templates
  // Uses two paths: Analytics API (pre-aggregated) and CRM Search API.
  // ---------------------------------------------------------------------------
  {
    name: 'Resumen de Negocios',
    description: 'Total de negocios, valor, tasa de cierre y distribución por etapa. Usa POST /crm/v3/objects/deals/search + GET /crm/v3/pipelines/deals.',
    provider: 'hubspot',
    crmReportId: 'deals_summary',
    category: 'ventas',
    defaultParams: { period: 'this_week' },
    relatedReports: ['deals_by_pipeline', 'deals_forecast', 'contacts_summary'],
  },
  {
    name: 'Negocios por Pipeline',
    description: 'Desglose de negocios agrupados por pipeline y etapa. Usa POST /crm/v3/objects/deals/search + GET /crm/v3/pipelines/deals.',
    provider: 'hubspot',
    crmReportId: 'deals_by_pipeline',
    category: 'ventas',
    defaultParams: { period: 'this_month' },
    relatedReports: ['deals_summary', 'deals_forecast'],
  },
  {
    name: 'Pronóstico de Ventas',
    description: 'Valor ponderado del pipeline para pronóstico de ingresos por mes de cierre. Usa POST /crm/v3/objects/deals/search.',
    provider: 'hubspot',
    crmReportId: 'deals_forecast',
    category: 'ventas',
    defaultParams: { period: 'this_quarter' },
    relatedReports: ['deals_summary', 'deals_by_pipeline'],
  },
  {
    name: 'Resumen de Contactos',
    description: 'Contactos nuevos por etapa del ciclo de vida y estado de lead. Usa POST /crm/v3/objects/contacts/search.',
    provider: 'hubspot',
    crmReportId: 'contacts_summary',
    category: 'contactos',
    defaultParams: { period: 'this_week' },
    relatedReports: ['contacts_by_source', 'deals_summary'],
  },
  {
    name: 'Contactos por Fuente',
    description: 'Origen de los contactos nuevos (orgánico, directo, referido, etc.). Usa POST /crm/v3/objects/contacts/search con hs_analytics_source.',
    provider: 'hubspot',
    crmReportId: 'contacts_by_source',
    category: 'contactos',
    defaultParams: { period: 'this_month' },
    relatedReports: ['contacts_summary', 'traffic_by_source'],
  },
  {
    name: 'Resumen de Tickets',
    description: 'Tickets de soporte por prioridad y estado del pipeline. Usa POST /crm/v3/objects/tickets/search + GET /crm/v3/pipelines/tickets.',
    provider: 'hubspot',
    crmReportId: 'tickets_summary',
    category: 'soporte',
    defaultParams: { period: 'this_week' },
    relatedReports: ['deals_summary', 'contacts_summary'],
  },
  {
    name: 'Analítica de Tráfico',
    description: 'Sesiones, visitantes, contactos, tasa de rebote (datos pre-agregados). Usa GET /analytics/v2/reports/totals/daily. Requiere Marketing Hub Enterprise.',
    provider: 'hubspot',
    crmReportId: 'traffic_analytics',
    category: 'marketing',
    defaultParams: { period: 'this_week' },
    relatedReports: ['traffic_by_source', 'contacts_by_source'],
  },
  {
    name: 'Tráfico por Fuente',
    description: 'Desglose de tráfico por fuente: orgánico, directo, referido, social, email, paid (datos pre-agregados). Usa GET /analytics/v2/reports/sources/total.',
    provider: 'hubspot',
    crmReportId: 'traffic_by_source',
    category: 'marketing',
    defaultParams: { period: 'this_week' },
    relatedReports: ['traffic_analytics', 'contacts_by_source'],
  },
];

async function seed() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/appfinanza';
  await mongoose.connect(uri);
  console.log('Connected to MongoDB');

  await ReportTemplate.deleteMany({});
  const created = await ReportTemplate.insertMany(templates);
  console.log(`Seeded ${created.length} report templates`);

  // Summary
  const ghlCount = templates.filter(t => t.provider === 'gohighlevel').length;
  const hsCount = templates.filter(t => t.provider === 'hubspot').length;
  console.log(`  GoHighLevel: ${ghlCount} templates`);
  console.log(`  HubSpot: ${hsCount} templates`);

  await mongoose.disconnect();
}

seed().catch(err => {
  console.error('Seed error:', err);
  process.exit(1);
});
