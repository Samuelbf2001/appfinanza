# AppFinanza - Asistente de Reportes CRM vía WhatsApp

Sistema que permite a gerentes consumir información estratégica de su CRM de forma proactiva a través de WhatsApp, con interacción guiada por IA.

## Arquitectura

```
┌─────────────┐    ┌──────────────┐    ┌─────────────┐    ┌──────────────┐
│  WhatsApp   │◄──►│   Express    │◄──►│  AI Engine   │    │  Scheduler   │
│  (Meta API) │    │   Server     │    │  (Claude)    │    │  (Cron)      │
└─────────────┘    └──────┬───────┘    └─────────────┘    └──────┬───────┘
                          │                                       │
                   ┌──────▼───────┐                               │
                   │   MongoDB    │◄──────────────────────────────┘
                   └──────┬───────┘
                          │
              ┌───────────┴───────────┐
              │                       │
       ┌──────▼──────┐        ┌──────▼──────┐
       │ GoHighLevel  │        │   HubSpot   │
       │   Adapter    │        │   Adapter   │
       └─────────────┘        └─────────────┘
```

## Funcionalidades

- **Reportes automáticos programados** (diario, semanal, quincenal, mensual)
- **Interacción conversacional** con botones y listas interactivas de WhatsApp
- **Exploración guiada** de datos con sugerencias de IA
- **Consultas bajo demanda** con parámetros de fecha dinámicos
- **Soporte multi-CRM**: GoHighLevel y HubSpot

## Requisitos

- Node.js 20+
- MongoDB 7+
- Cuenta de WhatsApp Business API (Meta Cloud API)
- API key de Anthropic (Claude)
- Credenciales de GoHighLevel y/o HubSpot

## Instalación

```bash
# Clonar e instalar dependencias
npm install

# Configurar variables de entorno
cp .env.example .env
# Editar .env con tus credenciales

# Seed de plantillas de reportes
npx ts-node scripts/seed.ts

# Desarrollo
npm run dev

# Producción
npm run build && npm start
```

## Docker

```bash
docker-compose up -d
```

## API Endpoints

### Webhook WhatsApp
- `GET /api/webhook` — Verificación del webhook
- `POST /api/webhook` — Recepción de mensajes

### Administración
- `POST /api/admin/users` — Crear usuario
- `GET /api/admin/users` — Listar usuarios
- `PUT /api/admin/users/:id` — Actualizar usuario
- `POST /api/admin/users/:id/schedules` — Agregar horario de reporte
- `POST /api/admin/report-templates` — Crear plantilla de reporte
- `GET /api/admin/report-templates` — Listar plantillas
- `POST /api/admin/test-connection` — Probar conexión CRM
- `GET /api/admin/report-logs` — Ver historial de reportes
- `GET /health` — Health check

## Flujo de Conversación

1. El sistema envía un reporte programado al gerente
2. El gerente recibe botones interactivos para explorar más datos
3. Al presionar un botón, la IA consulta el CRM y presenta un nuevo resumen
4. El gerente puede cambiar el período, pedir más detalle, o solicitar otro reporte
5. La conversación se mantiene activa por 24 horas
