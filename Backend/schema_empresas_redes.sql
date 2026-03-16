CREATE TABLE IF NOT EXISTS empresas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    logo TEXT,
    telefono TEXT,
    correo TEXT,
    sitio_web TEXT,
    direccion TEXT,
    descripcion TEXT,
    activo INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
    color_primario TEXT DEFAULT '#3469ED',
    color_cta TEXT DEFAULT '#fd9102',
    color_acento TEXT DEFAULT '#00bcd4',
    color_checks TEXT DEFAULT '#28a745',
    color_fondo TEXT DEFAULT '#f0f0f5',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_empresas_nombre ON empresas(nombre);
CREATE INDEX IF NOT EXISTS idx_empresas_correo ON empresas(correo);
CREATE UNIQUE INDEX IF NOT EXISTS idx_empresas_nombre_unico ON empresas(nombre COLLATE NOCASE);
