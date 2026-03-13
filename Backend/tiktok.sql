PRAGMA foreign_keys=ON;
BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS tiktok_form (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    empresa_id INTEGER NOT NULL,
    token TEXT NOT NULL,
    activo INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tiktok_form_empresa_id ON tiktok_form(empresa_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tiktok_form_empresa_unica ON tiktok_form(empresa_id);

CREATE VIEW IF NOT EXISTS tiktok_empresas_view AS
SELECT
    t.id AS red_id,
    e.id AS empresa_id,
    e.nombre,
    t.token,
    e.logo,
    e.telefono,
    e.correo,
    e.sitio_web,
    e.direccion,
    e.descripcion,
    e.activo AS empresa_activa,
    t.activo AS tiktok_activo,
    e.created_at AS empresa_created_at,
    e.updated_at AS empresa_updated_at,
    t.created_at AS tiktok_created_at,
    t.updated_at AS tiktok_updated_at
FROM tiktok_form t
INNER JOIN empresas e ON e.id = t.empresa_id;

COMMIT;
