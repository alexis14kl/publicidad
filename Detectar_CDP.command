#!/bin/bash
cd "$(dirname "$0")"
./terminal_mac.sh detect
echo
echo "Pulsa Enter para cerrar..."
read -r _ || true
