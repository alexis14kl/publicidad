# CLAUDE.md — Bot Publicitario NoyeCode

## Proyecto

Bot de automatizacion publicitaria que genera contenido con IA (imagenes, reels, brochures), lo publica en redes sociales (Facebook, Instagram, LinkedIn, TikTok) y crea campanas de leads via Graph API. Combina RPA con navegador antideteccion (DICloak), ChatGPT via CDP, n8n como orquestador de workflows, y una GUI de escritorio Electron+React.

## Stack tecnologico

| Capa | Tecnologia |
|------|------------|
| Core (backend) | Python 3.10+, Playwright, Typer, Rich, Pillow |
| GUI | Electron 32, React 19, TypeScript 5.6, Vite 6 |
| Automatizacion | CDP (Chrome DevTools Protocol), DICloak (antidetect) |
| Workflows | n8n (prompts, publicacion, campanas) |
| Base de datos | SQLite3 (empresas, plataformas, runs/artifacts) |
| IA | ChatGPT (imagenes via CDP), Gemini 2.0 (imagenes via API), Google Flow Veo 3 (video) |
| Ads | Facebook Graph API v22.0, MCP fb-ads server |

## Estructura del proyecto

```
publicidad/
├── core/                          # Python — logica principal
│   ├── orchestrator.py            # Orquestador 10 pasos (entry point principal)
│   ├── server/
│   │   ├── job_poller.py          # Polling n8n (webhook/datatable/executions)
│   │   ├── bot_runner.py          # Ejecutor con lock (.bot_runner.lock)
│   │   └── server.py              # Stub MCP server
│   ├── cfg/
│   │   ├── platform.py            # Abstraccion cross-platform (Win/Mac/Linux)
│   │   ├── sqlite_store.py        # DB runs + artifacts
│   │   └── preflight.py           # Validacion de dependencias
│   ├── cdp/
│   │   ├── post_opening.py        # Automatizacion post-apertura perfil
│   │   ├── force_cdp.py           # Inyeccion CDP en perfil
│   │   └── detect_port.py         # Deteccion puerto debug real
│   ├── prompt/
│   │   └── page_pronmt.py         # Inyeccion prompt en ChatGPT via CDP
│   ├── n8n/
│   │   ├── public_img.py          # Upload FreeImage + publicar en redes
│   │   └── create_campaign.py     # Campanas via webhooks n8n
│   ├── perfil/
│   │   ├── account_rotation.py    # Rotacion cuentas ChatGPT (TTL 4h)
│   │   └── profile_memory.py      # Memoria de perfiles
│   ├── video_rpa/                 # RPA video (Google Flow/Veo 3)
│   ├── brochure_rpa/              # HTML → PDF brochure
│   ├── inicio/
│   │   └── cleanup.py             # Kill procesos, limpiar puertos
│   └── utils/
│       ├── logger.py              # Logger cross-platform con Rich
│       ├── overlay_logo.py        # Superponer logo en imagen (Pillow)
│       ├── service_rotation.py    # Round-robin servicios NoyeCode
│       ├── n8n_prompt_client.py   # Cliente generacion prompts
│       ├── n8n_post_text_client.py # Cliente generacion captions
│       └── AgenteMarketing/       # Definiciones agentes IA (md + CDP server)
│
├── gui/                           # Electron + React
│   ├── electron/
│   │   ├── bootstrap.js           # Entry Electron
│   │   ├── main.js                # Main process, registra IPC
│   │   ├── preload.js             # Context isolation bridge
│   │   ├── ipc/                   # Handlers IPC:
│   │   │   ├── bot.js             #   start/stop bot, status
│   │   │   ├── poller.js          #   start/stop poller, logs
│   │   │   ├── company.js         #   CRUD empresas
│   │   │   ├── config.js          #   Leer/escribir .env
│   │   │   ├── marketing.js       #   Creacion campanas
│   │   │   ├── logo.js            #   Gestion logos
│   │   │   └── brochure.js        #   Generacion brochures
│   │   ├── data/
│   │   │   └── db.js              # Acceso SQLite (empresas + plataformas)
│   │   ├── services/              # Logica de negocio Electron
│   │   └── log-watcher.js         # Tail logs → IPC events
│   └── src/                       # React frontend
│       ├── app/App.tsx            # Root component
│       ├── features/              # Modulos: home, image, video, marketing
│       ├── components/            # LogViewer, ControlPanel, StatusCard, etc.
│       └── api/                   # Types + IPC wrappers
│
├── Backend/                       # SQLite DBs empresas + plataformas
├── scripts/                       # .bat/.sh para iniciar (legacy)
├── assets/logos/                   # Logos empresas
├── output/                        # Generados: images/, videos/, brochures/
├── logs/                          # job_poller.log, bot_runner_last.log
└── memory/                        # Estado persistente (JSON)
```

## Entry points

```bash
# CLI Python (definidos en pyproject.toml)
publicidad              # core.orchestrator:main — flujo completo 10 pasos
publicidad-worker       # core.server.job_poller:main — polling continuo n8n
publicidad-runner       # core.server.bot_runner:main — ejecutor de acciones

# GUI Electron
cd gui && npm run dev   # Desarrollo (Vite 5173 + Electron)
cd gui && npm run build # Produccion (Vite build + electron-builder)
cd gui && npm start     # Solo Electron (requiere build previo)
```

## Flujo principal del orquestador (core/orchestrator.py)

1. Generar prompt via n8n AI
2. Kill DICloak/ginsbrowser
3. Limpieza avanzada (servicios, procesos, puertos)
4. Iniciar DICloak en modo debug (puerto 9333)
5. Esperar CDP en 9333
6. Verificar Node.js
7. Abrir perfil via Node.js + CDP
8. Inyectar hook CDP en perfil
9. Detectar puerto debug real
10. Automatizacion post-apertura (pegar prompt → descargar imagen → logo → publicar)

**Fast path:** Si CDP ya responde en puerto 9225, salta pasos 2-5.

## Job Poller — modos de cola

| Modo | Fuente | Mecanismo |
|------|--------|-----------|
| webhook | n8n push | POST directo al bot |
| datatable | n8n Data Table | Poll filas status="pending" |
| executions | n8n Workflow | Poll ejecuciones del workflow |

El poller usa lock file `.bot_runner.lock` para evitar ejecucion concurrente (TTL 4h).

## Base de datos

### SQLite empresas (`Backend/`)

```sql
-- empresas: id, nombre(UNIQUE), logo, telefono, correo, sitio_web, activo, colores(primario/cta/acento/checks/fondo)
-- {platform}_form (facebook_form, instagram_form, etc.):
--   id, empresa_id(FK CASCADE), account_index, account_label, token, page_id, is_primary, activo
--   UNIQUE(empresa_id, account_index)
```

### SQLite tracking (`publicidad.sqlite3`)

```sql
-- runs: run_id(PK), action, status(running/success/error), payload_json, result_json, error_text
-- artifacts: artifact_id, run_id(FK), type, content, file_path, meta_json
```

## Variables de entorno (.env)

Copiar `.env.example` → `.env`. Variables criticas:

| Variable | Proposito |
|----------|-----------|
| `N8N_BASE_URL` | URL instancia n8n |
| `N8N_LOGIN_EMAIL/PASSWORD` | Credenciales n8n |
| `N8N_PROJECT_ID`, `N8N_TABLE_ID` | IDs proyecto/tabla n8n |
| `N8N_BOT_EXECUTION_WORKFLOW_ID` | Workflow a pollear |
| `N8N_WEBHOOK_PROMPT_IMGS` | Webhook generacion prompts |
| `N8N_WEBHOOK_PUBLICAR_IMG_LOCAL_FB` | Webhook publicacion |
| `FREEIMAGE_API_KEY` | API hosting imagenes |
| `CDP_DICLOAK_URL` | Endpoint DICloak (default 127.0.0.1:9333) |
| `CDP_CHATGPT_PORT` | Puerto perfil ChatGPT (default 9225) |
| `DICLOAK_API_PORT` | Puerto Open API local DICloak (default 52140) |
| `DICLOAK_API_KEY` | API Key de DICloak (Settings > Open API) |
| `DICLOAK_MCP_URL` | URL MCP DICloak Cloud (opcional) |
| `INITIAL_PROFILE` | Perfil DICloak principal |
| `FALLBACK_PROFILES` | Perfiles de rotacion (comma-separated) |
| `FB_ACCESS_TOKEN`, `FB_PAGE_ID` | Credenciales Facebook |
| `FB_AD_ACCOUNT_ID` | Cuenta publicitaria Facebook |
| `POLL_INTERVAL_SEC` | Intervalo polling (default 5s) |
| `RUN_TIMEOUT_SEC` | Timeout ejecucion (default 7200s) |
| `DEV_MODE` | 1=no cierra browser tras publicar |

## Comunicacion Frontend ↔ Backend

Electron IPC (no HTTP). Canales principales:

- `start-bot` / `stop-bot` / `get-bot-status` — control del bot
- `start-poller` / `stop-poller` / `is-poller-running` — control poller
- `list-company-records` / `save-company-record` / `delete-company-record` — CRUD empresas
- `get-env-config` / `save-env-config` — configuracion
- `run-preflight` — verificacion dependencias
- `log-new-lines` (event) — streaming logs al frontend
- `marketing-run-update` (event) — progreso campanas

## Pipeline de agentes IA (core/utils/AgenteMarketing/)

5 fases para campanas de leads:

```
Fase 1: ads-analyst (Sonnet)     → Analisis competencia + brief publicitario
Fase 2: image-creator (Sonnet)   → Generacion imagen via Gemini
Fase 3: marketing (Sonnet)       → QA copy/imagen, aprueba o rechaza
Fase 4: marketing (Sonnet)       → Ejecucion campana via MCP (Graph API)
Fase 5: marketing (Sonnet)       → Monitoreo metricas (CPM, CTR, CPL)
```

Agente orquestador (Opus) coordina, pide confirmacion antes de cada fase.

### MCP fb-ads-mcp-server — funciones clave

- `list_ad_accounts`, `get_campaigns_by_adaccount`
- `get_campaign_insights`, `get_adset_insights`, `get_ad_insights`
- `execute_lead_campaign_bundle` — crea campana completa en PAUSED

### Config campanas por defecto (Noyecode)

- Ad Account: `act_438871067037500`, Page: `115406607722279`
- Objetivo: `OUTCOME_LEADS`, Estado inicial: `PAUSED`
- Targeting: Colombia, 24-54 anos
- Lead form: full_name + email + phone_number
- Budget en centavos COP (ej: $150K = 15000000)

## Tipos de contenido soportados

| Tipo | Generador | Output | Directorio |
|------|-----------|--------|------------|
| image | ChatGPT 4K / Gemini | PNG/JPG | output/images/ |
| reel | Google Flow (Veo 3) | MP4 | output/videos/ |
| brochure | ChatGPT HTML → PDF | PDF | output/brochures/ |

## Convenciones de codigo

- **Python**: snake_case, docstrings en funciones publicas, logging via `core/utils/logger.py`
- **TypeScript/React**: features/ para modulos, components/ para reutilizables
- **Electron IPC**: handlers en `gui/electron/ipc/`, servicios en `gui/electron/services/`
- **Cross-platform**: toda logica de SO en `core/cfg/platform.py`, nunca hardcodear paths
- **Estado persistente**: JSON en `memory/`, no usar variables globales
- **Locks**: siempre usar context manager `bot_execution_lock()` para ejecuciones

## Comandos utiles

```bash
# Instalar dependencias Python
pip install -e .

# Instalar dependencias GUI
cd gui && npm install

# Preflight check
python -m core.cfg.preflight

# Ejecutar bot una vez
python -m core.orchestrator "#1 Chat Gpt PRO"

# Iniciar poller
python -m core.server.job_poller

# Ejecutar accion especifica
python -m core.server.bot_runner run_full_cycle '{"profile_name":"#1 Chat Gpt PRO"}'
```

## Skills de Marketing (.claude/skills/)

Skills modulares invocables en cualquier momento. Cada skill es autocontenido y puede ejecutarse en paralelo con otros.

### Fundacional
- `product-marketing-context` — Contexto de producto, audiencia, posicionamiento. Referenciado por todos los demás skills.

### Conversión
- `page-cro` — Optimización de landing pages (7 dimensiones)
- `ab-test-setup` — Diseño de A/B tests con rigor estadístico

### Contenido
- `copywriting` — Copy para páginas, ads, headlines, taglines
- `content-strategy` — Pilares de contenido, clusters, calendario editorial
- `email-sequence` — Secuencias de email (welcome, nurture, onboarding, re-engagement)
- `cold-email` — Emails de outreach frío para ventas

### Publicidad
- `paid-ads` — Estrategia de campañas pagadas (Meta, Google, LinkedIn, TikTok)
- `ad-creative` — Generación de copy y conceptos creativos para ads

### Estrategia
- `pricing-strategy` — Modelos de pricing, packaging, monetización
- `launch-strategy` — Lanzamiento de productos (modelo ORB, 5 fases)
- `lead-magnets` — Diseño de lead magnets y contenido gated
- `marketing-ideas` — Generador de ideas de marketing filtrado por etapa/presupuesto

### Growth & Retención
- `referral-program` — Programas de referidos y afiliados
- `free-tool-strategy` — Herramientas gratuitas como lead gen (engineering as marketing)
- `churn-prevention` — Flujos de cancelación, save offers, health scoring, dunning
- `marketing-psychology` — Modelos mentales y psicología aplicada al marketing

### SEO
- `seo-audit` — Auditoría técnica y on-page (5 tiers)

### Relación con AgenteMarketing

Los skills complementan (no reemplazan) los agentes de `core/utils/AgenteMarketing/`:
- **AgenteMarketing** = pipeline de 5 fases para crear campañas de Facebook Ads automáticamente
- **Skills** = frameworks reutilizables para cualquier tarea de marketing, invocables independientemente

## Notas para implementacion

- El bot requiere DICloak instalado y configurado con perfiles ChatGPT
- Playwright necesita browsers: `playwright install chromium`
- Los tokens de Facebook expiran; se extraen via CDP del browser logueado si es necesario
- Rotacion de cuentas ChatGPT: cuando se agotan tokens de imagen, rota al siguiente perfil (state en `memory/`)
- Deduplicacion de prompts: ventana de 90 segundos para evitar repeticiones
- La GUI comunica con Python via subprocesos (spawn), no via API HTTP
- Siempre crear campanas en estado PAUSED hasta aprobacion explicita del usuario
