/**
 * Seed script: populates default report templates for GoHighLevel and HubSpot.
 * Run: npx ts-node scripts/seed.ts
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

import { ReportTemplate } from '../src/models';

const templates = [
  // GoHighLevel templates
  {
    name: 'Resumen de Pipeline',
    description: 'Muestra el estado actual del pipeline de ventas con valores y etapas.',
    provider: 'gohighlevel',
    crmReportId: 'pipeline_summary',
    category: 'ventas',
    defaultParams: { period: 'this_week' },
    relatedReports: ['contacts_summary', 'conversations_summary'],
  },
  {
    name: 'Resumen de Contactos',
    description: 'Cantidad de contactos nuevos en el período seleccionado.',
    provider: 'gohighlevel',
    crmReportId: 'contacts_summary',
    category: 'contactos',
    defaultParams: { period: 'this_week' },
    relatedReports: ['pipeline_summary'],
  },
  {
    name: 'Resumen de Conversaciones',
    description: 'Actividad de conversaciones con leads y clientes.',
    provider: 'gohighlevel',
    crmReportId: 'conversations_summary',
    category: 'comunicación',
    defaultParams: { period: 'this_week' },
    relatedReports: ['pipeline_summary', 'contacts_summary'],
  },
  {
    name: 'Resumen de Calendario',
    description: 'Citas y eventos programados en el período.',
    provider: 'gohighlevel',
    crmReportId: 'calendar_summary',
    category: 'agenda',
    defaultParams: { period: 'this_week' },
    relatedReports: ['pipeline_summary'],
  },
  // HubSpot templates
  {
    name: 'Resumen de Negocios',
    description: 'Estado del pipeline de negocios en HubSpot con valores y etapas.',
    provider: 'hubspot',
    crmReportId: 'deals_summary',
    category: 'ventas',
    defaultParams: { period: 'this_week' },
    relatedReports: ['contacts_summary', 'tickets_summary'],
  },
  {
    name: 'Resumen de Contactos',
    description: 'Contactos nuevos agrupados por etapa del ciclo de vida.',
    provider: 'hubspot',
    crmReportId: 'contacts_summary',
    category: 'contactos',
    defaultParams: { period: 'this_week' },
    relatedReports: ['deals_summary'],
  },
  {
    name: 'Resumen de Tickets',
    description: 'Tickets de soporte creados en el período.',
    provider: 'hubspot',
    crmReportId: 'tickets_summary',
    category: 'soporte',
    defaultParams: { period: 'this_week' },
    relatedReports: ['deals_summary', 'contacts_summary'],
  },
];

async function seed() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/appfinanza';
  await mongoose.connect(uri);
  console.log('Connected to MongoDB');

  await ReportTemplate.deleteMany({});
  const created = await ReportTemplate.insertMany(templates);
  console.log(`Seeded ${created.length} report templates`);

  await mongoose.disconnect();
}

seed().catch(err => {
  console.error('Seed error:', err);
  process.exit(1);
});
