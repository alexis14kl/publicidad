# Bot Publicitario NoyeCode

Bot end-to-end que automatiza la generacion y publicacion de piezas publicitarias para NoyeCode en Facebook e Instagram.

Genera prompts con IA en n8n, abre un perfil antidetect en DiCloak, pega el prompt en ChatGPT para generar imagenes 4K, descarga el resultado, genera el caption comercial y publica via n8n.

## Flujo Principal

1. Genera prompt y caption con n8n.
2. Abre perfil de DiCloak por CDP.
3. Pega prompt en ChatGPT y genera imagen.
4. Descarga la imagen generada.
5. Publica via n8n.

## Estructura Principal

```text
publicidad/
├── iniciar.bat
├── cfg/rutas.bat
├── prompt/page_pronmt.py
├── prompt/download_generated_image.py
├── perfil/account_rotation.py
├── utils/n8n_prompt_client.py
├── utils/n8n_post_text_client.py
├── utils/service_rotation.py
├── n8n/public_img.py
├── img_publicitarias/
└── debug/
```

## Sistemas de Rotacion

- Cuentas ChatGPT: `perfil/account_rotation.py` (TTL 4h, max 20 intentos).
- Servicios NoyeCode: `utils/service_rotation.py` (round-robin).
- Deduplicacion prompt: `.prompt_last_send.json` (ventana de 90s).

## Integraciones Externas

- n8n prompt: `n8n-dev.noyecode.com/webhook/py-prompt-imgs`
- n8n caption: `n8n-dev.noyecode.com/webhook/py-post-fb-text`
- n8n publicar: `n8n-dev.noyecode.com/webhook/publicar-img-local-fb`
- ChatGPT via CDP
- FreeImage.host para hosting temporal

## Uso

```bat
iniciar.bat
```

Con parametros opcionales:

```bat
iniciar.bat "#1 Chat Gpt PRO" "" "" "" ""
```

## Worker de n8n

Arranque normal:

```bat
iniciar_poller.bat
```

Prueba de una sola pasada:

```bat
iniciar_poller.bat --once
```

Autoarranque al iniciar sesion:

```bat
instalar_inicio_poller_sesion.bat
```

Quitar autoarranque:

```bat
desinstalar_inicio_poller_sesion.bat
```

## Uso en macOS

La variante para Mac vive en `publicidad_mac` y conserva el flujo de Windows sin modificar los scripts originales.

## Requisitos

- Windows 10 o 11
- DICloak instalado y accesible
- Node.js + Playwright
- Python 3.10+
- Acceso a n8n

## Datos del Negocio

- Empresa: NoyeCode
- Servicios: desarrollo a la medida, automatizaciones, legacy, RPAs, Android, desktop
- Contacto: +57 301 385 9952
- Web: noyecode.com
- Formato de salida: vertical 4:5, estilo premium 4K, optimizado para Facebook e Instagram
