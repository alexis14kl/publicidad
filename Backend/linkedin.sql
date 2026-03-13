PRAGMA foreign_keys=ON;
BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS linkedin_form (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    empresa_id INTEGER NOT NULL,
    token TEXT NOT NULL,
    activo INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_linkedin_form_empresa_id ON linkedin_form(empresa_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_linkedin_form_empresa_unica ON linkedin_form(empresa_id);

CREATE VIEW IF NOT EXISTS linkedin_empresas_view AS
SELECT
    l.id AS red_id,
    e.id AS empresa_id,
    e.nombre,
    l.token,
    e.logo,
    e.telefono,
    e.correo,
    e.sitio_web,
    e.direccion,
    e.descripcion,
    e.activo AS empresa_activa,
    l.activo AS linkedin_activo,
    e.created_at AS empresa_created_at,
    e.updated_at AS empresa_updated_at,
    l.created_at AS linkedin_created_at,
    l.updated_at AS linkedin_updated_at
FROM linkedin_form l
INNER JOIN empresas e ON e.id = l.empresa_id;

COMMIT;
