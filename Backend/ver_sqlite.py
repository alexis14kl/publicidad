#!/usr/bin/env python3
import argparse
import sqlite3
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent


def format_rows(headers, rows):
    widths = [len(header) for header in headers]
    for row in rows:
        for index, value in enumerate(row):
            widths[index] = max(widths[index], len("" if value is None else str(value)))

    separator = "-+-".join("-" * width for width in widths)
    header_line = " | ".join(header.ljust(widths[index]) for index, header in enumerate(headers))
    data_lines = [
        " | ".join(
            ("" if value is None else str(value)).ljust(widths[index])
            for index, value in enumerate(row)
        )
        for row in rows
    ]
    return "\n".join([header_line, separator, *data_lines])


def inspect_db(db_path: Path):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        cursor = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
        tables = [row["name"] for row in cursor.fetchall()]

        print(f"\n=== {db_path.name} ===")
        if not tables:
            print("No hay tablas.")
            return

        for table in tables:
            print(f"\nTabla: {table}")

            schema = conn.execute(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name = ?",
                (table,),
            ).fetchone()
            if schema and schema["sql"]:
                print("Esquema:")
                print(schema["sql"])

            rows = conn.execute(f"SELECT * FROM {table}").fetchall()
            if rows:
                headers = rows[0].keys()
                printable_rows = [tuple(row) for row in rows]
                print("\nDatos:")
                print(format_rows(headers, printable_rows))
            else:
                print("\nDatos: tabla vacia.")
    finally:
        conn.close()


def main():
    parser = argparse.ArgumentParser(description="Visualiza el contenido de bases SQLite del directorio Backend.")
    parser.add_argument(
        "database",
        nargs="?",
        help="Nombre de la base sin extension, por ejemplo: facebook",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Muestra todas las bases .sqlite3 dentro de Backend.",
    )
    args = parser.parse_args()

    if args.all:
        db_paths = sorted(BASE_DIR.glob("*.sqlite3"))
    elif args.database:
        db_paths = [BASE_DIR / f"{args.database}.sqlite3"]
    else:
        parser.error("Indica una base o usa --all")
        return

    for db_path in db_paths:
        if not db_path.exists():
            print(f"No existe: {db_path.name}")
            continue
        inspect_db(db_path)


if __name__ == "__main__":
    main()
