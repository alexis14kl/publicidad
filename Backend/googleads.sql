PRAGMA foreign_keys=ON;
BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS googleads_form (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    empresa_id INTEGER NOT NULL,
    account_index INTEGER NOT NULL DEFAULT 1,
    account_label TEXT,
    token TEXT NOT NULL,
    activo INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
    is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_googleads_form_empresa_id ON googleads_form(empresa_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_googleads_form_empresa_cuenta_unica ON googleads_form(empresa_id, account_index);

CREATE VIEW IF NOT EXISTS googleads_empresas_view AS
SELECT
    g.id AS red_id,
    e.id AS empresa_id,
    e.nombre,
    g.account_index,
    g.account_label,
    g.token,
    e.logo,
    e.telefono,
    e.correo,
    e.sitio_web,
    e.direccion,
    e.descripcion,
    e.activo AS empresa_activa,
    g.activo AS googleads_activo,
    g.is_primary AS googleads_primary,
    e.created_at AS empresa_created_at,
    e.updated_at AS empresa_updated_at,
    g.created_at AS googleads_created_at,
    g.updated_at AS googleads_updated_at
FROM googleads_form g
INNER JOIN empresas e ON e.id = g.empresa_id;

COMMIT;
