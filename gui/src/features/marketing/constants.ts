export const CITY_ZONE_OPTIONS: Record<string, string[]> = {
  Bogota: ['Norte', 'Chapinero', 'Centro', 'Occidente', 'Sur', 'Suba', 'Usaquen'],
  Medellin: ['El Poblado', 'Laureles', 'Belen', 'Envigado', 'Sabaneta', 'Centro'],
  Cali: ['Norte', 'Sur', 'Oeste', 'Centro', 'Jamundi'],
  Barranquilla: ['Norte', 'Centro', 'Riomar', 'Soledad'],
  Cartagena: ['Bocagrande', 'Centro', 'Manga', 'Zona Norte'],
  Bucaramanga: ['Cabecera', 'Centro', 'Cacique', 'Floridablanca'],
  Pereira: ['Circunvalar', 'Centro', 'Dosquebradas', 'Cerritos', 'Pinares'],
  Manizales: ['Palermo', 'Cable', 'Centro', 'Milan', 'Chipre'],
  Cucuta: ['Caobos', 'Centro', 'La Riviera', 'Guaimaral', 'Colsag'],
  SantaMarta: ['Rodadero', 'Centro', 'Bello Horizonte', 'Mamatoco', 'Pozos Colorados'],
  Ibague: ['Centro', 'El Salado', 'La Samaria', 'Mirolindo', 'Picaleña'],
  Villavicencio: ['Centro', 'Buque', 'Barzal', 'La Esperanza', 'Caudal'],
  Neiva: ['Centro', 'Canaima', 'Santa Ines', 'Tierra Linda', 'Sur'],
  Monteria: ['Centro', 'La Castellana', 'Monteverde', 'Buenavista', 'Norte'],
  Pasto: ['Centro', 'Unicentro', 'La Aurora', 'Maridiaz', 'Anganoy'],
  Armenia: ['Centro', 'Norte', 'Quimbaya', 'La Castellana', 'Portal del Quindio'],
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
