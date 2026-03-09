# Bot Publicitario NoyeCode

Bot end-to-end que automatiza la generacion y publicacion de piezas publicitarias para **NoyeCode** en Facebook/Instagram.

Genera prompts con IA (n8n), abre un perfil antidetect (DiCloak), pega el prompt en ChatGPT para generar imagenes 4K, las descarga, genera el caption comercial y publica todo via n8n a Facebook.

---

## Estructura del Proyecto

```
publicidad/
├── iniciar.bat                          # Orquestador principal (10 pasos)
├── README.md
├── requirements.txt
├── .prompt_last_send.json               # Lock deduplicacion de prompt
├── .account_rotation_state.json         # Estado de rotacion de cuentas ChatGPT
├── .service_rotation_state.json         # Estado de rotacion de servicios NoyeCode
│
├── cfg/
│   └── rutas.bat                        # Variables centralizadas de rutas
│
├── inicio/
│   └── cerrar_dicloak_avanzado.ps1      # Limpieza agresiva de procesos
│
├── perfil/
│   ├── abrir_perfil_dicloak.js          # Abre perfil DiCloak via CDP (~1500 lineas)
│   ├── force_open_profile_cdp.js        # Fallback apertura forzada
│   ├── account_rotation.py              # Rotacion de cuentas ChatGPT
│   └── change_count.py                  # Placeholder cambio de cuenta
│
├── cdp/
│   ├── forzar_cdp_perfil_dicloak.ps1    # Fuerza debug port en ginsbrowser
│   ├── forzar_cdp_post_apertura.bat     # Launcher paralelo post-apertura
│   └── obtener_puerto_perfil_cdp.ps1    # Detecta puerto CDP real
│
├── prompt/
│   ├── page_pronmt.py                   # Pega prompt en ChatGPT + rotacion cuentas
│   └── download_generated_image.py      # Descarga imagen generada de ChatGPT
│
├── n8n/
│   ├── public_img.py                    # Envia imagen a n8n -> Facebook
│   ├── PUBLICAR_IMG_LOCAL_FB.json       # Workflow n8n exportado
│   ├── copia facebook bot.json          # Workflow n8n (copia)
│   └── Telegram Bot.json               # Workflow n8n Telegram
│
├── utils/
│   ├── prontm.txt                       # Prompt actual (generado por IA)
│   ├── prompt_seed.txt                  # Brief base/semilla para generar prompts
│   ├── post_text.txt                    # Caption de Facebook generado
│   ├── n8n_prompt_client.py             # Genera prompt via webhook n8n
│   ├── n8n_post_text_client.py          # Genera caption via webhook n8n
│   └── service_rotation.py              # Rota servicios NoyeCode (round-robin)
│
├── server/
│   ├── server.py                        # MCP stub legado
│   ├── bot_runner.py                    # Ejecuta acciones locales del bot con lock
│   └── job_poller.py                    # Worker local que consulta jobs en n8n por polling
│
├── img_publicitarias/                   # Imagenes generadas descargadas
│   └── *.png
│
├── logs/                                # Logs de procesos en segundo plano
│   └── job_poller.log
│
├── debug/                               # Screenshots de diagnostico
│   └── *.png, *.gif
│
└── docs/                                # Documentacion y notas
    └── *.md, *.txt
```

---

## Flujo Completo (10 pasos)

```
iniciar.bat
│
├─ [1/10] Genera prompt con IA via n8n
│         prompt_seed.txt ──> n8n webhook ──> prontm.txt
│         prontm.txt ──> n8n webhook ──> post_text.txt
│
├─ [2/10] Taskkill forzado (DICloak, ginsbrowser, chrome)
│
├─ [3/10] Limpieza avanzada de procesos y servicios
│         cerrar_dicloak_avanzado.ps1
│
├─ [4/10] Inicia DICloak con CDP en puerto 9333
│         DICloak.exe --remote-debugging-port=9333
│
├─ [5/10] Espera CDP activo en 9333
│         (fallback: DevToolsActivePort)
│
├─ [6/10] Verifica Node.js disponible
│
├─ [7/10] Abre perfil "#1 Chat Gpt PRO"
│         abrir_perfil_dicloak.js (Playwright + CDP)
│         └── fallback: force_open_profile_cdp.js
│
├─ [8/10] Fuerza debug port 9225 en el perfil
│         forzar_cdp_perfil_dicloak.ps1
│
├─ [9/10] Detecta puerto real y abre /json
│         obtener_puerto_perfil_cdp.ps1
│
└─ [10/10] Perfil listo
           │
           └── En paralelo (forzar_cdp_post_apertura.bat):
               │
               ├─ Pega prompt en ChatGPT
               │  page_pronmt.py (via CDP puerto 9225)
               │  └── Si no hay tokens de imagen:
               │      └── Rota cuenta ChatGPT (account_rotation.py)
               │      └── Reintenta hasta 20 veces
               │
               ├─ Descarga imagen generada
               │  download_generated_image.py
               │  └── Guarda en img_publicitarias/
               │
               └─ Publica en Facebook via n8n
                  public_img.py
                  └── Sube a FreeImage.host + envia metadata a n8n
```

---

## Sistemas de Rotacion

| Sistema | Archivo | Proposito |
|---------|---------|-----------|
| Rotacion de cuentas | `perfil/account_rotation.py` | Cuando ChatGPT agota tokens de imagen, cambia a otra cuenta. TTL 4h. Max 20 intentos. |
| Rotacion de servicios | `utils/service_rotation.py` | Round-robin entre 6 servicios NoyeCode para variar las piezas |
| Deduplicacion de prompt | `.prompt_last_send.json` | Evita enviar el mismo prompt en ventana de 90 segundos |

---

## Integraciones Externas

| Servicio | Uso | Endpoint |
|----------|-----|----------|
| n8n (prompt) | Genera prompt con IA | `n8n-dev.noyecode.com/webhook/py-prompt-imgs` |
| n8n (caption) | Genera texto publicacion | `n8n-dev.noyecode.com/webhook/py-post-fb-text` |
| n8n (publicar) | Publica imagen en FB | `n8n-dev.noyecode.com/webhook/publicar-img-local-fb` |
| FreeImage.host | Hosting temporal de imagen | API publica |
| ChatGPT | Genera imagenes 4K | Via CDP en perfil DiCloak |

---

## Puertos CDP

```
DICloak (app principal)     --> puerto 9333 (CDP)
  └── ginsbrowser (perfil)  --> puerto 9225 (CDP forzado)
      └── ChatGPT tab       --> prompt pegado via Playwright
```

---

## Stack Tecnologico

- **BAT** - orquestacion principal
- **PowerShell** - gestion de procesos, puertos CDP
- **Node.js + Playwright** - automatizacion de DiCloak y ChatGPT
- **Python** - logica de negocio (prompts, descargas, publicacion, rotacion)
- **n8n** - IA para prompts/captions + publicacion a Facebook
- **CDP** - Chrome DevTools Protocol
- **Polling worker** - activacion remota segura desde n8n hacia el bot local

---

## Activacion remota por polling

El bot puede quedar escuchando comandos desde n8n sin exponer puertos locales.

Modo recomendado actual: **polling sobre ejecuciones de `CHAT_IMGS`**.

```bat
set N8N_BASE_URL=https://n8n-dev.noyecode.com
set N8N_LOGIN_EMAIL=andersonbarbosadev@outlook.com
set N8N_LOGIN_PASSWORD=********
set N8N_BOT_QUEUE_MODE=executions
set N8N_BOT_EXECUTION_WORKFLOW_ID=5zKqthFIw2-FhYBIkCKnu

python server\job_poller.py
```

Flujo:

1. Telegram dispara el workflow `CHAT_IMGS`
2. `CHAT_IMGS` responde al usuario: solicitud recibida
3. `job_poller.py` consulta ejecuciones recientes de `CHAT_IMGS`
4. Si detecta un comando `/publicar ...`, extrae `action` y `payload`
5. `bot_runner.py` ejecuta `run_full_cycle` con lock local
6. El estado local queda registrado en `.job_poller_state.json`

Modo alterno experimental:

```bat
python server\job_poller.py --queue-mode datatable --n8n-project-id "bkrM241Q8UeW2zme" --n8n-table-id "LFM69EeeF7pa8yiO"
```

Modo legado/fallback:

```bat
python server\job_poller.py --queue-mode webhook --next-job-url "https://n8n-dev.noyecode.com/webhook/..." --update-job-url "https://n8n-dev.noyecode.com/webhook/..."
```

---

## Requisitos

- Windows 10/11
- [DICloak](https://www.dicloak.com/) instalado en `C:\Program Files\DICloak\`
- Node.js con Playwright (`npm install playwright`)
- Python 3.10+
- Acceso a n8n (`n8n-dev.noyecode.com`)

---

## Uso

```bat
rem Ejecucion completa (doble-click o desde CMD):
iniciar.bat

rem Con parametros opcionales:
iniciar.bat "#1 Chat Gpt PRO" "" "" "" ""
```

### Arrancar el worker de Telegram/n8n

```bat
iniciar_poller.bat
```

Opcionalmente puedes hacer una sola pasada de prueba:

```bat
iniciar_poller.bat --once
```

### Iniciar el worker automaticamente al iniciar sesion

Para este proyecto, la opcion segura es **inicio automatico en sesion de usuario**, no servicio Windows puro.
La razon es que el flujo visual de DICloak + ChatGPT necesita escritorio interactivo.

Instalar autoarranque:

```bat
instalar_inicio_poller_sesion.bat
```

Quitar autoarranque:

```bat
desinstalar_inicio_poller_sesion.bat
```

Esto crea una tarea programada llamada `NoyeCodeBotPoller` que:

- arranca al iniciar sesion
- lanza el worker oculto
- evita abrir la consola manualmente cada vez
- deja trazas en `logs\\job_poller.log`

Nota:
- `NSSM` si sirve para workers headless, pero **no** es la mejor opcion para este bot visual tal como esta hoy, porque DICloak/ChatGPT requieren sesion interactiva.

---

## Datos del Negocio

- **Empresa:** NoyeCode
- **Servicios:** desarrollo a la medida, automatizaciones, legacy, RPAs, Android, desktop
- **Contacto:** +57 301 385 9952
- **Web:** noyecode.com
- **Formato de salida:** Vertical 4:5, estilo premium 4K, optimizado para Facebook e Instagram
