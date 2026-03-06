#!/bin/bash
cd "$(dirname "$0")"
./terminal_mac.sh open "#1 Chat Gpt PRO" "http://127.0.0.1:9333"
echo
echo "Pulsa Enter para cerrar..."
read -r _ || true
