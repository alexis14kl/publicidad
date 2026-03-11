import { useEffect, useState } from 'react'
import { getEnvConfig, saveEnvConfig, resetBotState } from '../lib/commands'

interface SettingsPageProps {
  onBack: () => void
}

interface FieldDef {
  key: string
  label: string
  group: string
  type: 'text' | 'password' | 'number' | 'select'
  placeholder?: string
  options?: { value: string; label: string }[]
  help?: string
}

const FIELDS: FieldDef[] = [
  // N8N
  { key: 'N8N_BASE_URL', label: 'URL Base', group: 'N8N', type: 'text', placeholder: 'https://n8n-dev.noyecode.com' },
  { key: 'N8N_LOGIN_EMAIL', label: 'Email', group: 'N8N', type: 'text', placeholder: 'usuario@email.com' },
  { key: 'N8N_LOGIN_PASSWORD', label: 'Password', group: 'N8N', type: 'password', placeholder: '********' },
  { key: 'N8N_PROJECT_ID', label: 'Project ID', group: 'N8N', type: 'text' },
  { key: 'N8N_TABLE_ID', label: 'Table ID', group: 'N8N', type: 'text' },
  { key: 'N8N_BOT_EXECUTION_WORKFLOW_ID', label: 'Workflow ID', group: 'N8N', type: 'text' },
  { key: 'N8N_WEBHOOK_PROMPT_IMGS', label: 'Webhook Prompt Imgs', group: 'N8N', type: 'text' },
  { key: 'N8N_WEBHOOK_POST_FB_TEXT', label: 'Webhook Post FB Text', group: 'N8N', type: 'text' },
  { key: 'N8N_WEBHOOK_PUBLICAR_IMG_LOCAL_FB', label: 'Webhook Publicar Img', group: 'N8N', type: 'text' },

  // FreeImage
  { key: 'FREEIMAGE_API_KEY', label: 'API Key', group: 'FreeImage', type: 'password' },
  { key: 'FREEIMAGE_UPLOAD_URL', label: 'Upload URL', group: 'FreeImage', type: 'text' },

  // CDP
  { key: 'CDP_DICLOAK_URL', label: 'DICloak URL', group: 'CDP', type: 'text', placeholder: 'http://127.0.0.1:9333' },
  { key: 'CDP_CHATGPT_PORT', label: 'Puerto ChatGPT', group: 'CDP', type: 'number', placeholder: '9225' },

  // Perfiles
  { key: 'INITIAL_PROFILE', label: 'Perfil Inicial', group: 'Perfiles DICloak', type: 'text', placeholder: '#1 Chat Gpt PRO' },
  { key: 'DEFAULT_TARGET_PROFILE', label: 'Perfil Objetivo', group: 'Perfiles DICloak', type: 'text', placeholder: '#4 Chat Gpt Plus' },
  { key: 'FALLBACK_PROFILES', label: 'Perfiles Fallback', group: 'Perfiles DICloak', type: 'text', placeholder: '#4 Chat Gpt Plus,#2 Chat Gpt PRO', help: 'Separados por coma' },

  // Negocio
  { key: 'BUSINESS_WEBSITE', label: 'Sitio Web', group: 'Negocio', type: 'text', placeholder: 'noyecode.com' },
  { key: 'BUSINESS_WHATSAPP', label: 'WhatsApp', group: 'Negocio', type: 'text', placeholder: '+57 301 385 9952' },

  // Modo
  { key: 'DEV_MODE', label: 'Modo Desarrollo', group: 'General', type: 'select', options: [
    { value: '0', label: 'Desactivado' },
    { value: '1', label: 'Activado' },
  ], help: 'No cierra perfil ni consola tras publicar' },

  // Poller
  { key: 'POLL_INTERVAL_SEC', label: 'Intervalo de Poll (seg)', group: 'Poller', type: 'number', placeholder: '5' },
  { key: 'POLL_TIMEOUT_SEC', label: 'Timeout de Poll (seg)', group: 'Poller', type: 'number', placeholder: '60' },
  { key: 'RUN_TIMEOUT_SEC', label: 'Timeout de Ejecucion (seg)', group: 'Poller', type: 'number', placeholder: '7200' },
  { key: 'N8N_SESSION_TTL_SEC', label: 'TTL Sesion N8N (seg)', group: 'Poller', type: 'number', placeholder: '600' },
]

const GROUPS = [...new Set(FIELDS.map(f => f.group))]

export function SettingsPage({ onBack }: SettingsPageProps) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [original, setOriginal] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [showPasswords, setShowPasswords] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [resetResult, setResetResult] = useState<string | null>(null)

  useEffect(() => {
    getEnvConfig().then((config) => {
      setValues(config)
      setOriginal(config)
      setLoading(false)
    })
  }, [])

  const hasChanges = JSON.stringify(values) !== JSON.stringify(original)

  const handleChange = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const result = await saveEnvConfig(values)
      if (result.success) {
        setOriginal({ ...values })
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
      }
    } finally {
      setSaving(false)
    }
  }

  const handleDiscard = () => {
    setValues({ ...original })
    setSaved(false)
  }

  const handleResetBot = async () => {
    if (!confirm('Esto eliminara todos los archivos de estado, logs y memoria del bot. El bot volvera a su estado inicial.\n\nContinuar?')) return
    setResetting(true)
    setResetResult(null)
    try {
      const result = await resetBotState()
      if (result.success) {
        setResetResult(`${result.deleted.length} archivos eliminados`)
        setTimeout(() => setResetResult(null), 4000)
      }
    } finally {
      setResetting(false)
    }
  }

  if (loading) {
    return (
      <div className="settings-page">
        <div className="settings-loading">Cargando configuracion...</div>
      </div>
    )
  }

  return (
    <div className="settings-page">
      <div className="settings-header">
        <div className="settings-header-left">
          <button className="btn btn--ghost btn--small" onClick={onBack}>
            &#8592; Volver
          </button>
          <h2 className="settings-title">Configuraciones</h2>
        </div>
        <div className="settings-header-right">
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={showPasswords}
              onChange={(e) => setShowPasswords(e.target.checked)}
            />
            <span>Mostrar passwords</span>
          </label>
          <button
            className="btn btn--ghost btn--small"
            onClick={handleDiscard}
            disabled={!hasChanges}
          >
            Descartar
          </button>
          <button
            className="btn btn--start"
            onClick={handleSave}
            disabled={!hasChanges || saving}
          >
            {saving ? 'Guardando...' : saved ? 'Guardado' : 'Guardar'}
          </button>
        </div>
      </div>

      <div className="settings-body">
        {GROUPS.map((group) => (
          <section key={group} className="settings-group glass-card">
            <div className="card-header">
              <span className="card-icon">&#9881;</span>
              <span className="card-title">{group}</span>
            </div>
            <div className="settings-fields">
              {FIELDS.filter((f) => f.group === group).map((field) => (
                <div key={field.key} className="settings-field">
                  <label className="settings-field-label">
                    {field.label}
                    <span className="settings-field-key">{field.key}</span>
                  </label>
                  {field.type === 'select' ? (
                    <select
                      className="settings-input"
                      value={values[field.key] || ''}
                      onChange={(e) => handleChange(field.key, e.target.value)}
                    >
                      {field.options?.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="settings-input"
                      type={field.type === 'password' && !showPasswords ? 'password' : 'text'}
                      placeholder={field.placeholder}
                      value={values[field.key] || ''}
                      onChange={(e) => handleChange(field.key, e.target.value)}
                    />
                  )}
                  {field.help && <span className="settings-field-help">{field.help}</span>}
                </div>
              ))}
            </div>
          </section>
        ))}

        <section className="settings-group settings-danger glass-card">
          <div className="card-header">
            <span className="card-icon">&#9888;</span>
            <span className="card-title">Zona de Reset</span>
          </div>
          <p className="settings-danger-text">
            Elimina todos los archivos de estado, logs y memoria del bot.
            Util si el bot queda trabado o en un estado inconsistente.
            Las configuraciones (.env) no se borran.
          </p>
          <div className="settings-danger-actions">
            <button
              className="btn btn--stop"
              onClick={handleResetBot}
              disabled={resetting}
            >
              {resetting ? 'Reseteando...' : 'Reset del Bot'}
            </button>
            {resetResult && <span className="settings-reset-result">{resetResult}</span>}
          </div>
        </section>
      </div>
    </div>
  )
}
