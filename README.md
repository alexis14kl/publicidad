# Bot Publicitario NoyeCode

Bot end-to-end para automatizar la generacion y publicacion de piezas publicitarias de **NoyeCode** en Facebook/Instagram.

El flujo principal:
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

## Requisitos

- Node.js + Playwright (`npm install`)
- Python 3.10+
- Dependencias Python: `pip install -r requirements.txt`
- DICloak instalado y accesible

## Uso en Windows

```bat
iniciar.bat
```

Con parametros opcionales:

```bat
iniciar.bat "#1 Chat Gpt PRO" "" "" "" ""
```

## Uso en macOS

1. Preparar entorno:

```bash
cd /Users/ipadmini/Desktop/AgenteMarketing/publicidad
./setup_mac.sh
```

2. Detectar puerto CDP real del perfil (opcional):

```bash
./detectar_cdp_mac.sh
```

3. Abrir perfil por CDP:

```bash
./abrir_dicloak_y_chatgpt_mac.sh "#1 Chat Gpt PRO" "http://127.0.0.1:9333"
```

Alternativa equivalente al flujo completo de `iniciar.bat`:

```bash
./iniciar_mac.sh "#1 Chat Gpt PRO"
```

Si tienes ruta personalizada del JSON de DiCloak:

```bash
export DICLOAK_CDP_INFO_PATH="/ruta/a/cdp_debug_info.json"
```

## Datos del Negocio

- Empresa: NoyeCode
- Servicios: desarrollo a la medida, automatizaciones, legacy, RPAs, Android, desktop
- Contacto: +57 301 385 9952
- Web: noyecode.com
