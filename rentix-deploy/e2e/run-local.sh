#!/usr/bin/env bash
# Lokal E2E stack: build + up + bo'sh baza + admin/menejer. So'ng Playwright.
#
#   ./run-local.sh          # stack + testlar
#   ./run-local.sh up       # faqat stackni ko'tarish
#   ./run-local.sh down     # stack va uning ma'lumotlarini o'chirish
set -euo pipefail
cd "$(dirname "$0")/.."      # rentix-deploy

export COMPOSE_FILE="docker-compose.yml:e2e/docker-compose.e2e.yml"
export COMPOSE_PROJECT_NAME=rentix-e2e
ENV_FILE=e2e/.env.e2e

if [ ! -f "$ENV_FILE" ]; then
  cp .env.example "$ENV_FILE"
  sed -i -e "s/^SECRET_KEY=$/SECRET_KEY=e2e-$(openssl rand -hex 16)/" \
         -e "s/^POSTGRES_PASSWORD=$/POSTGRES_PASSWORD=e2e/" \
         -e "s/^RENTIX_ADMIN_PASSWORD=$/RENTIX_ADMIN_PASSWORD=E2eAdmin!2026/" \
         -e "s/^RENTIX_MANAGER_PASSWORD=$/RENTIX_MANAGER_PASSWORD=E2eManager!2026/" \
         -e "/^COMPOSE_FILE=/d" "$ENV_FILE"
fi
# compose .env ni loyiha papkasidan o'qiydi — vaqtincha e2e .env ni ulaymiz
dc() { docker compose --env-file "$ENV_FILE" "$@"; }
[ -f .env ] || ln -sf "$ENV_FILE" .env

case "${1:-all}" in
  down) dc down -v; exit 0 ;;
esac

dc build
dc up -d
for _ in $(seq 1 60); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' rentix-backend 2>/dev/null)" = healthy ] && break
  sleep 3
done
dc exec -T backend python manage.py bootstrap_prod | grep -v httpx
dc exec -T redis redis-cli FLUSHALL >/dev/null   # throttle hisoblagichlari

[ "${1:-all}" = up ] && exit 0

cd e2e
[ -d node_modules ] || npm ci
set -a; . ./.env.e2e; set +a
USER_URL=http://127.0.0.1:18031 ADMIN_URL=http://127.0.0.1:18032 npx playwright test "${@:2}"
