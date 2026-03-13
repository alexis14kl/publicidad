PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;
CREATE TABLE empresas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    token TEXT NOT NULL,
    logo TEXT,
    telefono TEXT,
    correo TEXT,
    sitio_web TEXT,
    direccion TEXT,
    descripcion TEXT,
    activo INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
DELETE FROM sqlite_sequence;
CREATE INDEX idx_empresas_nombre ON empresas(nombre);
CREATE INDEX idx_empresas_correo ON empresas(correo);
COMMIT;
