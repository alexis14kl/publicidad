PRAGMA foreign_keys=ON;
BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS instagram_form (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    empresa_id INTEGER NOT NULL,
    token TEXT NOT NULL,
    activo INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_instagram_form_empresa_id ON instagram_form(empresa_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_instagram_form_empresa_unica ON instagram_form(empresa_id);

CREATE VIEW IF NOT EXISTS instagram_empresas_view AS
SELECT
    i.id AS red_id,
    e.id AS empresa_id,
    e.nombre,
    i.token,
    e.logo,
    e.telefono,
    e.correo,
    e.sitio_web,
    e.direccion,
    e.descripcion,
    e.activo AS empresa_activa,
    i.activo AS instagram_activo,
    e.created_at AS empresa_created_at,
    e.updated_at AS empresa_updated_at,
    i.created_at AS instagram_created_at,
    i.updated_at AS instagram_updated_at
FROM instagram_form i
INNER JOIN empresas e ON e.id = i.empresa_id;

COMMIT;
