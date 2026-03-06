#!/bin/bash
cd "$(dirname "$0")"
./terminal_mac.sh debug 9333
echo
echo "Pulsa Enter para cerrar..."
read -r _ || true
