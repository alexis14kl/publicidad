PRAGMA foreign_keys=ON;
BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS facebook_form (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    empresa_id INTEGER NOT NULL,
    token TEXT NOT NULL,
    activo INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_facebook_form_empresa_id ON facebook_form(empresa_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_facebook_form_empresa_unica ON facebook_form(empresa_id);

CREATE VIEW IF NOT EXISTS facebook_empresas_view AS
SELECT
    f.id AS red_id,
    e.id AS empresa_id,
    e.nombre,
    f.token,
    e.logo,
    e.telefono,
    e.correo,
    e.sitio_web,
    e.direccion,
    e.descripcion,
    e.activo AS empresa_activa,
    f.activo AS facebook_activo,
    e.created_at AS empresa_created_at,
    e.updated_at AS empresa_updated_at,
    f.created_at AS facebook_created_at,
    f.updated_at AS facebook_updated_at
FROM facebook_form f
INNER JOIN empresas e ON e.id = f.empresa_id;

COMMIT;
