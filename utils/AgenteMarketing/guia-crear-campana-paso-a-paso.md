# Guia Paso a Paso: Crear Campana de Facebook Ads (Lead Generation)

## Objetivo
Esta guia entrena al bot Agente Marketing para crear campanas completas de Lead Generation en Facebook Ads usando el MCP `fb-ads-mcp-server`. Cada campo se documenta con su valor esperado, formato y ejemplo.

---

## PASO 1 — Recopilar Informacion del Usuario

El bot debe preguntar directamente en la conversacion:

| # | Pregunta | Campo que alimenta | Ejemplo de respuesta |
|---|----------|--------------------|--------------------|
| 1 | Que servicio o producto quieres promocionar? | `creative.message`, brief | "Automatizacion empresarial RPA" |
| 2 | Cual es tu objetivo? | `campaign.objective` | "Generar leads/contactos" |
| 3 | A quien va dirigido? (edad, ubicacion, intereses) | `adset.targeting` | "Colombia, 25-50 anos, duenos de empresa" |
| 4 | Presupuesto total en COP? | `adset.lifetime_budget` | "$150.000 COP" |
| 5 | Fechas de inicio y fin? | `adset.start_time`, `adset.end_time` | "Del 20 marzo al 5 abril 2026" |

**Si es para Noyecode**, usar los valores por defecto del contexto sin preguntar.

---

## PASO 2 — Analizar Campanas Previas (MCP)

Ejecutar en este orden:

```
1. list_ad_accounts
   -> Obtener: ad_account_id (ej: act_438871067037500)

2. get_campaigns_by_adaccount(ad_account_id)
   -> Ver campanas existentes y su estado

3. get_campaign_insights(campaign_id, date_preset="last_30d")
   -> Analizar: CTR, CPM, CPL, impresiones, resultados

4. Delegar a sub-agente ads-analyst para generar brief publicitario
```

---

## PASO 3 — Generar Imagen Publicitaria

Delegar al sub-agente `image-creator` con estas especificaciones:

| Parametro | Valor |
|-----------|-------|
| Formato | Vertical 4:5 |
| Resolucion | 1080 x 1350 px |
| Franja superior | 15% vacia para logo (fondo claro) |
| Bordes | Full-bleed, sin margenes negros |
| Colores Noyecode | Morado #3469ED, Naranja #fd9102, Cyan #00bcd4 |

La imagen se guarda localmente y su ruta se usa en `creative.image_path`.

---

## PASO 4 — Crear Campana via MCP (create_lead_campaign_bundle)

### Estructura completa del JSON con TODOS los campos

```json
{
  "ad_account_id": "act_438871067037500",
  "page_id": "115406607722279",

  "campaign": {
    "name": "Leads | Automatizacion RPA | Mar 2026",
    "objective": "OUTCOME_LEADS",
    "status": "PAUSED",
    "is_adset_budget_sharing_enabled": false,
    "special_ad_categories": []
  },

  "adset": {
    "name": "Conjunto Leads | Empresarios CO | 20mar -> 05abr",
    "lifetime_budget": "15000000",
    "billing_event": "IMPRESSIONS",
    "optimization_goal": "LEAD_GENERATION",
    "bid_strategy": "LOWEST_COST_WITHOUT_CAP",
    "destination_type": "ON_AD",
    "status": "PAUSED",
    "start_time": "2026-03-20T00:00:00-0500",
    "end_time": "2026-04-05T23:59:59-0500",
    "targeting": {
      "geo_locations": {
        "countries": ["CO"]
      },
      "age_min": 24,
      "age_max": 54,
      "targeting_automation": {
        "advantage_audience": 0
      }
    },
    "promoted_object": {
      "page_id": "115406607722279"
    }
  },

  "lead_form": {
    "page_id": "115406607722279",
    "discover": true,
    "create_if_missing": true,
    "required_fields": ["full_name", "email", "phone_number"],
    "name": "Formulario Lead | RPA | Mar 2026",
    "locale": "es_LA",
    "privacy_policy_url": "https://www.noyecode.com/privacidad",
    "follow_up_action_url": "https://www.noyecode.com"
  },

  "creative": {
    "image_path": "/ruta/local/imagen-campana.png",
    "message": "Tu equipo pierde 20 horas semanales en tareas repetitivas?\n\nCon automatizacion RPA eliminamos el trabajo manual y reducimos errores un 90%.\n\nMas de 50 empresas en Colombia ya lo implementaron.\n\nDeja tus datos y te mostramos como funciona.",
    "headline": "Automatiza y ahorra tiempo",
    "name": "Creative | RPA | Mar 2026",
    "call_to_action_type": "SIGN_UP"
  },

  "ad": {
    "name": "Ad | RPA Leads | Mar 2026",
    "status": "PAUSED"
  }
}
```

---

## DETALLE DE CADA CAMPO

### 4.1 — Campos de nivel raiz

| Campo | Tipo | Obligatorio | Descripcion | Ejemplo |
|-------|------|:-----------:|-------------|---------|
| `ad_account_id` | string | SI | ID de la cuenta publicitaria con prefijo `act_` | `"act_438871067037500"` |
| `page_id` | string | SI | ID de la pagina de Facebook asociada | `"115406607722279"` |

---

### 4.2 — Objeto `campaign`

| Campo | Tipo | Obligatorio | Descripcion | Valores posibles | Ejemplo |
|-------|------|:-----------:|-------------|-----------------|---------|
| `name` | string | SI | Nombre descriptivo de la campana | Texto libre | `"Leads \| RPA \| Mar 2026"` |
| `objective` | string | SI | Objetivo de la campana | `OUTCOME_LEADS`, `OUTCOME_TRAFFIC`, `OUTCOME_AWARENESS` | `"OUTCOME_LEADS"` |
| `status` | string | SI | Estado inicial (SIEMPRE crear en PAUSED) | `PAUSED`, `ACTIVE` | `"PAUSED"` |
| `is_adset_budget_sharing_enabled` | boolean | NO | Compartir presupuesto entre adsets (CBO) | `true`, `false` | `false` |
| `special_ad_categories` | array | NO | Categorias especiales (credito, empleo, vivienda, politica) | `["CREDIT"]`, `["EMPLOYMENT"]`, `[]` | `[]` |

**Regla:** Para Lead Generation SIEMPRE usar `"objective": "OUTCOME_LEADS"`.

---

### 4.3 — Objeto `adset`

| Campo | Tipo | Obligatorio | Descripcion | Ejemplo |
|-------|------|:-----------:|-------------|---------|
| `name` | string | SI | Nombre del conjunto de anuncios | `"Conjunto Leads \| Empresarios CO \| 20mar -> 05abr"` |
| `lifetime_budget` | string | SI | Presupuesto total en **centavos** de la moneda local (COP) | `"15000000"` (= $150.000 COP) |
| `billing_event` | string | NO | Evento de facturacion | `"IMPRESSIONS"` (por defecto) |
| `optimization_goal` | string | SI | Meta de optimizacion | `"LEAD_GENERATION"` |
| `bid_strategy` | string | NO | Estrategia de puja | `"LOWEST_COST_WITHOUT_CAP"` (por defecto) |
| `destination_type` | string | SI | Donde se muestra el formulario | `"ON_AD"` (formulario instantaneo) |
| `status` | string | SI | Estado del adset | `"PAUSED"` |
| `start_time` | string | SI | Fecha/hora de inicio (ISO 8601 con timezone) | `"2026-03-20T00:00:00-0500"` |
| `end_time` | string | SI | Fecha/hora de fin (ISO 8601 con timezone) | `"2026-04-05T23:59:59-0500"` |

#### 4.3.1 — Sub-objeto `targeting`

| Campo | Tipo | Obligatorio | Descripcion | Ejemplo |
|-------|------|:-----------:|-------------|---------|
| `geo_locations.countries` | array | SI | Paises (codigo ISO 2 letras) | `["CO"]` |
| `geo_locations.cities` | array | NO | Ciudades especificas | `[{"key": "2673660"}]` (Bogota) |
| `age_min` | integer | SI | Edad minima (18-65) | `24` |
| `age_max` | integer | SI | Edad maxima (18-65) | `54` |
| `genders` | array | NO | Genero: 1=hombre, 2=mujer | `[1, 2]` (ambos) |
| `targeting_automation.advantage_audience` | integer | NO | 0=desactivado, 1=activado | `0` |
| `flexible_spec` | array | NO | Intereses y comportamientos | Ver ejemplo abajo |

**Ejemplo de targeting con intereses:**
```json
{
  "geo_locations": {"countries": ["CO"]},
  "age_min": 25,
  "age_max": 50,
  "targeting_automation": {"advantage_audience": 0},
  "flexible_spec": [
    {
      "interests": [
        {"id": "6003139266461", "name": "Small business"}
      ]
    }
  ]
}
```

#### 4.3.2 — Sub-objeto `promoted_object`

| Campo | Tipo | Obligatorio | Descripcion | Ejemplo |
|-------|------|:-----------:|-------------|---------|
| `page_id` | string | SI (para leads) | ID de la pagina de Facebook | `"115406607722279"` |

**Regla:** Si no se proporciona `promoted_object`, el MCP lo genera automaticamente a partir de `page_id`.

---

### 4.4 — Objeto `lead_form`

| Campo | Tipo | Obligatorio | Descripcion | Ejemplo |
|-------|------|:-----------:|-------------|---------|
| `page_id` | string | SI | Misma pagina de Facebook | `"115406607722279"` |
| `discover` | boolean | SI | Buscar formularios existentes en la pagina | `true` |
| `create_if_missing` | boolean | SI | Crear formulario si no encuentra uno compatible | `true` |
| `form_id` | string | NO | ID de formulario existente (si ya lo tienes) | `"1234567890"` |
| `required_fields` | array | SI | Campos del formulario | `["full_name", "email", "phone_number"]` |
| `name` | string | SI | Nombre del formulario | `"Formulario Lead \| RPA \| Mar 2026"` |
| `locale` | string | SI | Idioma del formulario | `"es_LA"` (espanol Latinoamerica) |
| `privacy_policy_url` | string | SI | URL de politica de privacidad | `"https://www.noyecode.com/privacidad"` |
| `follow_up_action_url` | string | NO | URL de seguimiento post-envio | `"https://www.noyecode.com"` |

**Campos del formulario (fijos, NO modificar):**

| Campo | Tipo Meta API | Lo que ve el usuario |
|-------|--------------|---------------------|
| `full_name` | FULL_NAME | "Nombre completo" |
| `email` | EMAIL | "Correo electronico" |
| `phone_number` | PHONE | "Numero de telefono" |

**Regla:** SIEMPRE usar exactamente estos 3 campos. No agregar mas para maximizar tasa de conversion.

**Logica del MCP:**
1. Si `discover: true` -> busca formularios existentes en la pagina
2. Si encuentra uno con los 3 campos exactos -> lo reutiliza (matchType: "exact")
3. Si NO encuentra match y `create_if_missing: true` -> crea uno nuevo automaticamente
4. Si se proporciona `form_id` -> usa ese directamente (matchType: "manual")

---

### 4.5 — Objeto `creative`

| Campo | Tipo | Obligatorio | Descripcion | Ejemplo |
|-------|------|:-----------:|-------------|---------|
| `image_path` | string | SI | Ruta LOCAL de la imagen (4:5, 1080x1350px) | `"/tmp/campana-rpa.png"` |
| `message` | string | SI | Texto principal del anuncio (max 500 chars, 125 visibles) | Ver estructura abajo |
| `headline` | string | SI | Titulo del anuncio (max 40 chars) | `"Automatiza y ahorra tiempo"` |
| `name` | string | NO | Nombre interno del creative | `"Creative \| RPA \| Mar 2026"` |
| `call_to_action_type` | string | SI | Tipo de boton CTA | `"SIGN_UP"` |
| `link` | string | NO | URL destino (opcional para leads) | `""` |

**Valores posibles para `call_to_action_type`:**

| Valor | Texto del boton |
|-------|----------------|
| `SIGN_UP` | "Registrarte" |
| `LEARN_MORE` | "Mas informacion" |
| `GET_QUOTE` | "Obtener cotizacion" |
| `SUBSCRIBE` | "Suscribirse" |
| `DOWNLOAD` | "Descargar" |
| `APPLY_NOW` | "Solicitar ahora" |
| `CONTACT_US` | "Contactanos" |

**Estructura del copy (`message`):**

```
Linea 1: HOOK — Pregunta de dolor o beneficio impactante
Linea 2-3: VALOR — Que ofreces y como resuelve el problema
Linea 4: PRUEBA SOCIAL — Dato, numero o testimonio (si existe)
Linea 5: CTA — Llamado a la accion claro
```

**Ejemplo completo:**
```
Tu equipo pierde 20 horas semanales en tareas repetitivas?

Con automatizacion RPA eliminamos el trabajo manual y reducimos errores un 90%.

Mas de 50 empresas en Colombia ya lo implementaron.

Deja tus datos y te mostramos como funciona.
```

---

### 4.6 — Objeto `ad` (opcional)

| Campo | Tipo | Obligatorio | Descripcion | Ejemplo |
|-------|------|:-----------:|-------------|---------|
| `name` | string | NO | Nombre del anuncio | `"Ad \| RPA Leads \| Mar 2026"` |
| `status` | string | NO | Estado del anuncio | `"PAUSED"` |

**Nota:** Si no se proporciona, el MCP genera nombres automaticos.

---

## PASO 5 — Conversion de Presupuesto

**IMPORTANTE:** El presupuesto se envia en **centavos** (la unidad minima de la moneda).

| Presupuesto usuario | Calculo | Valor en `lifetime_budget` |
|---------------------|---------|---------------------------|
| $50.000 COP | 50000 x 100 | `"5000000"` |
| $100.000 COP | 100000 x 100 | `"10000000"` |
| $150.000 COP | 150000 x 100 | `"15000000"` |
| $300.000 COP | 300000 x 100 | `"30000000"` |
| $500.000 COP | 500000 x 100 | `"50000000"` |
| $1.000.000 COP | 1000000 x 100 | `"100000000"` |

**Formula:** `lifetime_budget = presupuesto_COP * 100`

---

## PASO 6 — Formato de Fechas

Las fechas deben estar en formato **ISO 8601 con timezone de Colombia** (-0500):

| Concepto | Formato | Ejemplo |
|----------|---------|---------|
| Inicio | `YYYY-MM-DDT00:00:00-0500` | `"2026-03-20T00:00:00-0500"` |
| Fin | `YYYY-MM-DDT23:59:59-0500` | `"2026-04-05T23:59:59-0500"` |

**Regla:** Si el usuario dice "del 20 de marzo al 5 de abril", convertir a:
- `start_time`: `"2026-03-20T00:00:00-0500"`
- `end_time`: `"2026-04-05T23:59:59-0500"`

---

## PASO 7 — Revision Pre-Publicacion

Presentar al usuario este resumen ANTES de activar:

```
CAMPANA LISTA (ESTADO: PAUSED)
================================
Nombre:       Leads | Automatizacion RPA | Mar 2026
Objetivo:     OUTCOME_LEADS
Presupuesto:  $150.000 COP
Duracion:     20 mar 2026 -> 05 abr 2026
Audiencia:    Colombia, 24-54 anos
Imagen:       Vertical 4:5 (1080x1350px)
Copy:         "Tu equipo pierde 20 horas..."
Titulo:       "Automatiza y ahorra tiempo"
CTA:          Registrarte (SIGN_UP)
Formulario:   Nombre + Email + Telefono

ACTIVAR CAMPANA? (si / no / ajustar)
```

**Regla:** NUNCA activar sin aprobacion explicita del usuario.

---

## PASO 8 — Monitoreo Post-Lanzamiento

| Periodo | Accion MCP | Que revisar |
|---------|-----------|-------------|
| Dia 1-2 | No tocar | Esperar aprobacion de Meta |
| Dia 3-5 | `get_campaign_insights` | CPM, CTR, CPC, CPL |
| Dia 7+ | `get_ad_insights` | Identificar anuncios ganadores vs perdedores |

**Alertas automaticas:**

| Metrica | Umbral | Accion sugerida |
|---------|--------|----------------|
| CTR | < 1% despues de 3 dias | Cambiar copy o imagen |
| Frecuencia | > 3 | Ampliar audiencia |
| CPL | > benchmark del sector | Optimizar presupuesto |
| Anuncio ganador | CTR alto, CPL bajo | Escalar presupuesto 20-30% |

---

## FLUJO RESUMIDO DEL BOT

```
Usuario pide crear campana
        |
        v
[PASO 1] Preguntar: servicio, objetivo, audiencia, presupuesto, fechas
        |
        v
[PASO 2] MCP: list_ad_accounts -> get_campaigns -> get_insights
        |
        v
[PASO 3] Sub-agente image-creator: generar imagen 4:5
        |
        v
[PASO 4] MCP: create_lead_campaign_bundle (JSON completo)
        |
        v
[PASO 5] Mostrar resumen al usuario
        |
        v
[PASO 6] Usuario aprueba? -> SI: activar | NO: ajustar
        |
        v
[PASO 7] Monitoreo con get_campaign_insights
```

---

## VALORES POR DEFECTO NOYECODE

Cuando la campana es para Noyecode, usar estos valores sin preguntar:

```json
{
  "ad_account_id": "act_438871067037500",
  "page_id": "115406607722279",
  "campaign.objective": "OUTCOME_LEADS",
  "campaign.status": "PAUSED",
  "adset.targeting.geo_locations.countries": ["CO"],
  "adset.targeting.age_min": 24,
  "adset.targeting.age_max": 54,
  "adset.optimization_goal": "LEAD_GENERATION",
  "adset.destination_type": "ON_AD",
  "adset.billing_event": "IMPRESSIONS",
  "adset.bid_strategy": "LOWEST_COST_WITHOUT_CAP",
  "lead_form.locale": "es_LA",
  "lead_form.privacy_policy_url": "https://www.noyecode.com/privacidad",
  "lead_form.follow_up_action_url": "https://www.noyecode.com",
  "lead_form.required_fields": ["full_name", "email", "phone_number"],
  "creative.call_to_action_type": "SIGN_UP"
}
```

---

## ERRORES COMUNES Y SOLUCION

| Error | Causa | Solucion |
|-------|-------|----------|
| `promoted_object[page_id]` invalido | La pagina no tiene permisos | Verificar que la pagina esta vinculada a la cuenta publicitaria |
| `lifetime_budget` muy bajo | Presupuesto menor al minimo de Meta | Minimo ~$20.000 COP por dia de campana |
| No se creo el Instant Form | Falta `pages_manage_posts` | Agregar permiso en Graph API Explorer y regenerar token |
| Imagen no sube | Ruta invalida o formato no soportado | Verificar que el archivo existe y es PNG/JPG |
| `targeting` rechazado | Audiencia muy pequena | Ampliar rango de edad o ubicacion |
| Token expirado | Access token vencido | Regenerar en Graph API Explorer con todos los permisos |

---

## PERMISOS REQUERIDOS DEL TOKEN

El token de acceso debe tener estos permisos:

| Permiso | Para que |
|---------|----------|
| `ads_management` | Crear y gestionar campanas/adsets/ads |
| `ads_read` | Leer metricas e insights |
| `pages_manage_ads` | Gestionar anuncios de la pagina |
| `pages_manage_metadata` | Gestionar metadata de la pagina |
| `pages_read_engagement` | Leer engagement de la pagina |
| `pages_manage_posts` | **Crear y gestionar posts/formularios de la pagina** |
| `pages_show_list` | Listar paginas disponibles |
| `leads_retrieval` | Descargar leads del formulario |
| `business_management` | Gestionar activos del Business Manager |
