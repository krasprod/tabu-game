#!/bin/bash
# Запуск локального сервера для тестирования игры
# Использование: bash start.sh
cd "$(dirname "$0")"
PORT=${PORT:-8765}
echo ""
echo "🟥 ТАБУ — локальный сервер"
echo ""
echo "Открой в браузере:  http://localhost:$PORT"
echo ""
python3 -m http.server $PORT
