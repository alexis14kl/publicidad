#!/bin/bash
cd "$(dirname "$0")"
./setup_mac.sh
echo
echo "Pulsa Enter para cerrar..."
read -r _ || true
