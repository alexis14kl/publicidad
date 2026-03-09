# Checklist: Implementar Reels en Facebook

## Estado actual

- [x] Facebook Graph API v21.0 configurada
- [x] Credencial `facebookGraphApi` en n8n activa
- [x] Permiso `pages_manage_posts` otorgado
- [x] Page ID: `115406607722279`
- [x] Flujo de publicacion de imagenes funcionando
- [ ] Endpoint de Reels (`/video_reels`)
- [ ] Generacion de videos
- [ ] Workflow n8n para Reels
- [ ] Script Python de upload de video

---

## Fase 1: Generacion del video

El bot hoy genera **imagenes estaticas** con ChatGPT. Para Reels necesitamos **videos MP4**.

### Opciones para generar video

| Opcion | Descripcion | Costo | Complejidad |
|---|---|---|---|
| **A) Imagen → Video (Ken Burns)** | Tomar la imagen generada y aplicar efecto zoom/pan con FFmpeg | Gratis | Baja |
| **B) Imagen → Video (Plantilla)** | Usar plantilla de video con la imagen como fondo + texto animado | Gratis | Media |
| **C) API de video IA** | Usar Runway, Pika, Luma para generar video desde imagen | $15-100/mes | Media |
| **D) ChatGPT video (futuro)** | Cuando ChatGPT soporte generacion de video nativa | Incluido en PRO | Baja (cuando exista) |

### Tareas

- [ ] Decidir opcion de generacion de video (A, B, C o D)
- [ ] Si opcion A: instalar FFmpeg en la PC / incluir en instalador
- [ ] Si opcion C: crear cuenta en API de video y obtener API key
- [ ] Crear script `prompt/generate_reel_video.py`
- [ ] Definir duracion del Reel (recomendado: 15-30 segundos)
- [ ] Definir formato: vertical 9:16 (1080x1920)

---

## Fase 2: Upload de video a Facebook

### Endpoint de Reels (3 pasos)

```
1. POST https://graph.facebook.com/v21.0/{page-id}/video_reels
   Body: upload_phase=start&access_token=TOKEN
   Response: { video_id, upload_url }

2. POST {upload_url}
   Headers: file_size, Authorization
   Body: binario del video MP4
   Response: { success: true }

3. POST https://graph.facebook.com/v21.0/{page-id}/video_reels
   Body: upload_phase=finish&video_id=XXX&description=CAPTION&access_token=TOKEN
   Response: { success: true, post_id }
```

### Permisos necesarios

- [x] `pages_manage_posts` (ya lo tenemos)
- [ ] `pages_read_engagement` (verificar si ya esta otorgado)
- [ ] Verificar que el token de pagina tiene scope para video_reels

### Tareas

- [ ] Verificar permisos actuales del token en Graph API Explorer
- [ ] Crear script `n8n/public_reel.py` (equivalente a `public_img.py` pero para video)
- [ ] Implementar flujo de 3 pasos (start → upload → finish)
- [ ] Manejar errores de cada paso por separado
- [ ] Agregar logs claros de progreso

---

## Fase 3: Workflow n8n

### Tareas

- [ ] Crear workflow `PUBLICAR_REEL_FB.json` en n8n
- [ ] Webhook que reciba: video_url o video_base64, caption, metadata
- [ ] Nodo HTTP para los 3 pasos del upload de Reel
- [ ] Nodo de log/notificacion de resultado
- [ ] Agregar al bot_runner como nueva accion: `run_reel_cycle`

---

## Fase 4: Integracion con el bot

### Flujo propuesto

```
Worker recibe job "run_reel_cycle"
    |
    v
Generar prompt (igual que hoy)
    |
    v
Generar imagen con ChatGPT (igual que hoy)
    |
    v
Convertir imagen a video (nuevo)
    |
    v
Subir video como Reel a Facebook (nuevo)
    |
    v
Cleanup (igual que hoy)
```

### Tareas

- [ ] Agregar accion `run_reel_cycle` en `bot_runner.py`
- [ ] Crear orquestador `cdp/forzar_cdp_post_apertura_reel.bat`
- [ ] Integrar generacion de video despues de descarga de imagen
- [ ] Enviar video a n8n en lugar de imagen
- [ ] Actualizar instalador (.iss) si hay nuevas dependencias (FFmpeg)

---

## Fase 5: Testing

- [ ] Test manual: generar video desde imagen existente
- [ ] Test manual: subir video a Facebook como Reel via API
- [ ] Test manual: flujo completo end-to-end
- [ ] Verificar que el flujo de imagenes (actual) no se rompe
- [ ] Verificar en movil que el Reel se ve correctamente (9:16)

---

## Especificaciones tecnicas de Reels

| Parametro | Valor |
|---|---|
| Formato | MP4 (H.264) |
| Resolucion | 1080x1920 (9:16 vertical) |
| Duracion minima | 3 segundos |
| Duracion maxima | 90 segundos (recomendado 15-30s) |
| Tamano maximo | 1 GB |
| FPS | 30 |
| Audio | AAC (opcional, recomendado) |
| Codec video | H.264 |
| Bitrate recomendado | 5-8 Mbps |

---

## Prioridad sugerida

1. **Fase 1** (video) - Empezar con opcion A (FFmpeg, gratis y rapido)
2. **Fase 2** (upload) - Script Python independiente
3. **Fase 3** (n8n) - Workflow nuevo
4. **Fase 4** (integracion) - Conectar al bot
5. **Fase 5** (testing) - Validar todo

---

## Notas

- El flujo de **imagenes actual NO se modifica**. Reels es un flujo paralelo
- Se puede programar en n8n: lunes/miercoles/viernes = imagen, martes/jueves = reel
- La opcion A (FFmpeg) es la mas rapida de implementar: zoom lento sobre la imagen + texto animado = reel de 15s
- Facebook prioriza Reels en el algoritmo, por lo que el alcance organico seria mayor
