export const CITY_ZONE_OPTIONS: Record<string, string[]> = {
  Bogota: ['Norte', 'Chapinero', 'Centro', 'Occidente', 'Sur', 'Suba', 'Usaquen'],
  Medellin: ['El Poblado', 'Laureles', 'Belen', 'Envigado', 'Sabaneta', 'Centro'],
  Cali: ['Norte', 'Sur', 'Oeste', 'Centro', 'Jamundi'],
  Barranquilla: ['Norte', 'Centro', 'Riomar', 'Soledad'],
  Cartagena: ['Bocagrande', 'Centro', 'Manga', 'Zona Norte'],
  Bucaramanga: ['Cabecera', 'Centro', 'Cacique', 'Floridablanca'],
}

export const CONTACT_MODE_OPTIONS = [
  {
    value: 'lead_form' as const,
    label: 'Contacto web',
    objective: 'Clientes potenciales',
  },
  {
    value: 'whatsapp' as const,
    label: 'Contactarme por WhatsApp',
    objective: 'Mensajes / WhatsApp',
  },
]
