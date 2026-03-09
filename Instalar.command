#!/bin/bash
cd "$(dirname "$0")"
./instalar_dependencias_mac.sh
echo
echo "Pulsa Enter para cerrar..."
read -r _ || true
