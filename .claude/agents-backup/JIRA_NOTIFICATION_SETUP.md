# Configuración de Notificaciones Jira a Chatwoot en n8n

## Resumen Ejecutivo

Esta modificación agrega funcionalidad de notificación automática al workflow `JIRA_TAREA` para enviar mensajes a Chatwoot cada vez que se crea una nueva tarea en Jira.

## Arquitectura de la Solución

### Flujo de Notificación (Nuevo)
```
Jira Issue Created Event
    ↓
Jira Trigger (n8n)
    ↓
Format Jira Notification (Set Node)
    ↓
Send Chatwoot Notification (HTTP Request)
    ↓
Mensaje en Chatwoot Conversation
```

### Flujo Existente (Se mantiene)
```
Webhook (Chatwoot)
    ↓
Edit Fields
    ↓
HTTP Request (Get User)
    ↓
Board Info
    ↓
ActivateSprint
    ↓
Get many issues
    ↓
Get an issue
    ↓
AI Agent (JiraOps)
    ↓
Respuesta a Chatwoot
```

## Nodos Agregados

### 1. Jira Trigger - Issue Created
**Tipo:** `n8n-nodes-base.jiraTrigger`
**ID:** `jira-trigger-issue-created`
**Posición:** [-848, 320]

**Configuración:**
```json
{
  "parameters": {
    "events": ["issue:created"],
    "additionalFields": {}
  },
  "credentials": {
    "jiraSoftwareCloudApi": {
      "id": "MWM6UapvnzPhf3P6",
      "name": "Jira SW Cloud account 2"
    }
  }
}
```

**Función:**
- Detecta eventos de creación de issues en Jira
- Se activa automáticamente cuando se crea una nueva tarea
- Utiliza webhooks de Jira para recibir notificaciones en tiempo real

**Output:**
```json
{
  "issue": {
    "key": "PROJ-123",
    "fields": {
      "summary": "Título de la tarea",
      "creator": {
        "displayName": "Nombre del usuario"
      }
    }
  }
}
```

### 2. Format Jira Notification
**Tipo:** `n8n-nodes-base.set`
**ID:** `format-jira-notification`
**Posición:** [-624, 320]

**Configuración:**
```json
{
  "parameters": {
    "assignments": {
      "assignments": [
        {
          "name": "issueKey",
          "value": "={{ $json.issue.key }}",
          "type": "string"
        },
        {
          "name": "issueSummary",
          "value": "={{ $json.issue.fields.summary }}",
          "type": "string"
        },
        {
          "name": "issueCreator",
          "value": "={{ $json.issue.fields.creator.displayName || 'Usuario desconocido' }}",
          "type": "string"
        }
      ]
    }
  }
}
```

**Función:**
- Extrae y formatea los datos relevantes del issue creado
- Maneja casos donde el creador no esté disponible (fallback a "Usuario desconocido")
- Prepara los datos para el mensaje de Chatwoot

**Output:**
```json
{
  "issueKey": "PROJ-123",
  "issueSummary": "Implementar login con OAuth",
  "issueCreator": "Juan Pérez"
}
```

### 3. Send Chatwoot Notification
**Tipo:** `n8n-nodes-base.httpRequest`
**ID:** `send-chatwoot-notification`
**Posición:** [-320, 320]

**Configuración:**
```json
{
  "parameters": {
    "method": "POST",
    "url": "https://chatwoot-dev.noyecode.com/api/v1/accounts/1/conversations/11/messages/",
    "authentication": "genericCredentialType",
    "genericAuthType": "httpHeaderAuth",
    "sendBody": true,
    "specifyBody": "json",
    "jsonBody": "={\n  \"content\": \"🆕 Nueva tarea creada en Jira!\\n\\n📋 Key: {{ $json.issueKey }}\\n📝 Título: {{ $json.issueSummary }}\\n👤 Creador: {{ $json.issueCreator }}\"\n}"
  },
  "credentials": {
    "httpHeaderAuth": {
      "id": "4K1I229vhMOuv9of",
      "name": "Chat bot wathsapp"
    }
  }
}
```

**Función:**
- Envía el mensaje formateado a Chatwoot
- Utiliza la API de Chatwoot para crear un mensaje en la conversación 11
- Usa autenticación HTTP Header (credencial existente)

**Formato del Mensaje:**
```
🆕 Nueva tarea creada en Jira!

📋 Key: PROJ-123
📝 Título: Implementar login con OAuth
👤 Creador: Juan Pérez
```

## Conexiones Agregadas

```json
{
  "Jira Trigger - Issue Created": {
    "main": [[{
      "node": "Format Jira Notification",
      "type": "main",
      "index": 0
    }]]
  },
  "Format Jira Notification": {
    "main": [[{
      "node": "Send Chatwoot Notification",
      "type": "main",
      "index": 0
    }]]
  },
  "Send Chatwoot Notification": {
    "main": [[]]
  }
}
```

## Credenciales Utilizadas

### 1. Jira SW Cloud account 2
- **ID:** `MWM6UapvnzPhf3P6`
- **Tipo:** `jiraSoftwareCloudApi`
- **Uso:** Autenticación con Jira para recibir webhooks
- **Permisos requeridos:** Lectura de issues

### 2. Chat bot wathsapp
- **ID:** `4K1I229vhMOuv9of`
- **Tipo:** `httpHeaderAuth`
- **Uso:** Autenticación con API de Chatwoot
- **Permisos requeridos:** Crear mensajes en conversaciones

## Instalación y Actualización

### Método 1: Via Script (Recomendado)

```bash
cd /Users/ipadmini/Desktop/testeo
./update_workflow.sh
```

### Método 2: Via curl directo

```bash
curl -X PATCH "https://n8n-dev.noyecode.com/api/v1/workflows/TYpUwgKuCzH0NeQxskUsS" \
  -H "X-N8N-API-KEY: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2ZTQwNGQ2My0wNzQ3LTQzZTktYWM3Zi1jZjBlNzJlOWNiOTkiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwiaWF0IjoxNzcwMjE3MDI5fQ.wqjQZDY0fwUOY-O_VIOAnMx6dZlLv43hfVme4iY9Y5U" \
  -H "Content-Type: application/json" \
  -d @workflow_update.json
```

### Método 3: Via UI de n8n

1. Ir a https://n8n-dev.noyecode.com
2. Abrir workflow `JIRA_TAREA`
3. Agregar los 3 nodos manualmente según configuración arriba
4. Conectar los nodos según el diagrama de flujo
5. Activar el workflow

## Configuración del Webhook en Jira

### Verificación Automática

El nodo `Jira Trigger` de n8n crea automáticamente el webhook en Jira cuando:
1. El workflow se activa por primera vez
2. Las credenciales de Jira son válidas
3. El usuario tiene permisos de administrador en Jira

### Verificación Manual

Para verificar que el webhook está configurado:

1. **Ir a configuración de webhooks en Jira:**
   ```
   https://ingenierojavierbr-1769436388255.atlassian.net/plugins/servlet/webhooks
   ```

2. **Buscar webhook de n8n:**
   - Debe aparecer un webhook con URL: `https://n8n-dev.noyecode.com/webhook/...`
   - Estado: **ACTIVO**
   - Eventos: **Issue created**

3. **Configuración esperada del webhook:**
   ```
   URL: https://n8n-dev.noyecode.com/webhook/[webhook-id]
   Events:
     ☑ Issue > created
   Status: ✅ Enabled
   ```

### Configuración Manual del Webhook (Si es necesario)

Si el webhook no se crea automáticamente:

1. **Ir a Jira > Settings > System > WebHooks**

2. **Crear nuevo webhook:**
   - Name: `n8n - Jira Issue Created Notifications`
   - Status: **Enabled**
   - URL: Obtener desde n8n (ver sección siguiente)
   - Events: Seleccionar `Issue > created`

3. **Obtener URL del webhook desde n8n:**
   - Abrir el workflow en n8n
   - Click en el nodo `Jira Trigger - Issue Created`
   - Copiar la "Webhook URL" que aparece en el panel de configuración
   - Ejemplo: `https://n8n-dev.noyecode.com/webhook/jira-webhook-issue-created`

## Testing y Validación

### Test Básico

1. **Crear una nueva tarea en Jira:**
   ```
   Proyecto: [Tu proyecto]
   Tipo: Task
   Summary: Test de notificación n8n
   ```

2. **Verificar en Chatwoot:**
   - Ir a conversación con ID 11
   - Buscar mensaje: "🆕 Nueva tarea creada en Jira!"
   - Verificar que incluya key, título y creador

3. **Verificar logs en n8n:**
   - Ir a: https://n8n-dev.noyecode.com/workflows/TYpUwgKuCzH0NeQxskUsS/executions
   - Buscar ejecución reciente
   - Verificar que todos los nodos se ejecutaron correctamente

### Test con cURL (Simulación)

Para probar sin crear un issue real en Jira:

```bash
# Nota: Esto NO funcionará directamente porque el webhook requiere firma de Jira
# Solo para referencia de estructura

curl -X POST "https://n8n-dev.noyecode.com/webhook/jira-webhook-issue-created" \
  -H "Content-Type: application/json" \
  -d '{
    "webhookEvent": "jira:issue_created",
    "issue": {
      "key": "TEST-123",
      "fields": {
        "summary": "Test de notificación",
        "creator": {
          "displayName": "Usuario Test"
        }
      }
    }
  }'
```

### Verificar Estado del Workflow

```bash
curl -X GET "https://n8n-dev.noyecode.com/api/v1/workflows/TYpUwgKuCzH0NeQxskUsS" \
  -H "X-N8N-API-KEY: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2ZTQwNGQ2My0wNzQ3LTQzZTktYWM3Zi1jZjBlNzJlOWNiOTkiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwiaWF0IjoxNzcwMjE3MDI5fQ.wqjQZDY0fwUOY-O_VIOAnMx6dZlLv43hfVme4iY9Y5U" \
  | grep -i "active"
```

## Troubleshooting

### Problema 1: No se reciben notificaciones

**Síntomas:**
- Se crea un issue en Jira
- No aparece mensaje en Chatwoot

**Soluciones:**

1. **Verificar que el workflow esté activo:**
   ```bash
   curl -X GET "https://n8n-dev.noyecode.com/api/v1/workflows/TYpUwgKuCzH0NeQxskUsS" \
     -H "X-N8N-API-KEY: [tu-api-key]" | grep "\"active\":true"
   ```

2. **Verificar webhook en Jira:**
   - Ir a webhooks en Jira
   - Verificar que esté activo
   - Ver historial de entregas (delivery history)

3. **Revisar logs de ejecución en n8n:**
   - Buscar errores en las ejecuciones recientes
   - Verificar que el trigger se haya activado

4. **Verificar credenciales:**
   - Jira SW Cloud account 2 debe estar válida
   - Chat bot wathsapp debe tener permisos

### Problema 2: Error de autenticación en Chatwoot

**Error:**
```
401 Unauthorized
```

**Soluciones:**

1. **Verificar credencial "Chat bot wathsapp":**
   - Ir a n8n > Credentials
   - Buscar ID: 4K1I229vhMOuv9of
   - Verificar que el token sea válido

2. **Probar manualmente:**
   ```bash
   curl -X POST "https://chatwoot-dev.noyecode.com/api/v1/accounts/1/conversations/11/messages/" \
     -H "api_access_token: [tu-token]" \
     -H "Content-Type: application/json" \
     -d '{"content": "Test"}'
   ```

### Problema 3: Webhook no se crea en Jira

**Síntomas:**
- No aparece webhook en configuración de Jira
- Trigger no se activa

**Soluciones:**

1. **Verificar permisos del usuario en Jira:**
   - Requiere permisos de administrador
   - Verificar en: User Management > Permissions

2. **Crear webhook manualmente:**
   - Ir a: https://ingenierojavierbr-1769436388255.atlassian.net/plugins/servlet/webhooks
   - Crear nuevo webhook con la URL del trigger
   - Seleccionar evento "Issue created"

3. **Re-activar el workflow:**
   - Desactivar workflow en n8n
   - Esperar 30 segundos
   - Activar nuevamente

### Problema 4: Error en formato del mensaje

**Error:**
```
Cannot read property 'key' of undefined
```

**Soluciones:**

1. **Verificar estructura del payload de Jira:**
   - Revisar logs de ejecución
   - Verificar que `$json.issue.key` exista

2. **Actualizar nodo Format Jira Notification:**
   - Agregar validaciones con operador `||`
   - Ejemplo: `{{ $json.issue?.key || 'N/A' }}`

### Problema 5: Conversación 11 no existe

**Error:**
```
404 Conversation not found
```

**Soluciones:**

1. **Verificar ID de conversación:**
   ```bash
   curl -X GET "https://chatwoot-dev.noyecode.com/api/v1/accounts/1/conversations" \
     -H "api_access_token: [tu-token]"
   ```

2. **Actualizar URL en el nodo:**
   - Cambiar el ID 11 por el correcto en el nodo "Send Chatwoot Notification"

## Monitoreo y Logs

### Logs en n8n

**Ver ejecuciones:**
```
https://n8n-dev.noyecode.com/workflows/TYpUwgKuCzH0NeQxskUsS/executions
```

**Filtrar por nodo:**
- Buscar ejecuciones del nodo "Jira Trigger - Issue Created"
- Revisar output de cada nodo

### Logs en Jira

**Ver historial de webhooks:**
```
Jira > Settings > System > WebHooks > [tu webhook] > View details
```

**Información útil:**
- Requests enviados
- Status codes recibidos
- Payloads enviados
- Errores de entrega

### Logs en Chatwoot

**Ver mensajes en conversación:**
```
https://chatwoot-dev.noyecode.com/app/accounts/1/conversations/11
```

## Mantenimiento

### Actualizaciones Futuras

Para modificar el mensaje de notificación:

1. Editar el nodo "Send Chatwoot Notification"
2. Modificar el campo `jsonBody`
3. Mantener las expresiones de n8n: `{{ $json.campo }}`
4. Guardar y probar

### Agregar Más Eventos

Para notificar otros eventos de Jira:

1. Duplicar el flujo "Jira Trigger → Format → Send"
2. Modificar el parámetro `events` del trigger:
   - `issue:updated`
   - `issue:deleted`
   - `issue:assigned`
3. Ajustar el mensaje según el evento

### Notificar a Múltiples Conversaciones

Para enviar a varias conversaciones:

1. Agregar un nodo "Split In Batches"
2. Definir array de conversation IDs
3. Duplicar nodo "Send Chatwoot Notification" dentro del loop

## Recursos Adicionales

### Documentación

- **n8n Jira Trigger:** https://docs.n8n.io/integrations/builtin/trigger-nodes/n8n-nodes-base.jiratrigger/
- **Jira Webhooks:** https://developer.atlassian.com/server/jira/platform/webhooks/
- **Chatwoot API:** https://www.chatwoot.com/docs/product/channels/api/client-apis

### URLs Importantes

- **n8n Instance:** https://n8n-dev.noyecode.com
- **Jira Instance:** https://ingenierojavierbr-1769436388255.atlassian.net
- **Chatwoot Instance:** https://chatwoot-dev.noyecode.com
- **Workflow ID:** TYpUwgKuCzH0NeQxskUsS

## Diagrama Visual

```
┌─────────────────────────────────────────────────────────────────┐
│                     WORKFLOW JIRA_TAREA                         │
│                                                                 │
│  FLUJO EXISTENTE (Consultas desde Chatwoot)                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                                                         │   │
│  │  Webhook (Chatwoot) → Edit Fields → Get User          │   │
│  │       ↓                                                │   │
│  │  Board Info → ActivateSprint → Get Issues             │   │
│  │       ↓                                                │   │
│  │  Get Issue → AI Agent → Respuesta Chatwoot            │   │
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  FLUJO NUEVO (Notificaciones desde Jira) ✨                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                                                         │   │
│  │  Jira Trigger (issue:created)                          │   │
│  │       ↓                                                │   │
│  │  Format Jira Notification (Set)                        │   │
│  │       ↓                                                │   │
│  │  Send Chatwoot Notification (HTTP)                     │   │
│  │       ↓                                                │   │
│  │  ✅ Mensaje en Chatwoot Conversation 11                │   │
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Changelog

### Version 1.0 - 2026-02-04
- Agregado Jira Trigger para detectar issues creados
- Agregado nodo de formateo de notificaciones
- Agregado envío automático a Chatwoot
- Documentación completa del setup

---

**Autor:** Claude Code (Sonnet 4.5)
**Fecha:** 2026-02-04
**Workflow ID:** TYpUwgKuCzH0NeQxskUsS
**n8n Instance:** https://n8n-dev.noyecode.com
