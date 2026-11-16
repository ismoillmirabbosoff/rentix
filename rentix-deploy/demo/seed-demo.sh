#!/usr/bin/env bash
# Mijozlarga ko'rsatish uchun demo ma'lumot (BAZANI TOZALAYDI, avval zaxira oladi):
#   backend'dagi seed_presentation (3 filial, 18 mashina, ~60 mijoz, ~220 buyurtma)
#   + haqiqiy mashina fotolari (demo/photos, Wikimedia Commons, ATTRIBUTION.md)
#   + admin/menejer parollari .env dagiga qaytariladi, Telegram bot qayta ulanadi.
#
#   cd rentix-deploy && demo/seed-demo.sh
set -euo pipefail
cd "$(dirname "$0")/.."      # rentix-deploy

env_get() { grep -E "^$1=" .env | head -1 | cut -d= -f2-; }
dc() { docker compose "$@"; }

[ "${1:-}" = "--yes" ] || {
  read -r -p "Baza tozalanib demo ma'lumot yuklanadi. Davom etilsinmi? 'ha' deb yozing: " a
  [ "$a" = "ha" ] || { echo "Bekor qilindi"; exit 0; }
}

./deploy.sh backup

# Mavjud bot tokeni saqlanib qolsin
BOT="$(dc exec -T db psql -U "$(env_get POSTGRES_USER)" -d "$(env_get POSTGRES_DB)" -tAc \
  "select coalesce(telegram_bot_token,'') from user_company order by id limit 1" 2>/dev/null || true)"

dc exec -T backend python manage.py seed_presentation ${BOT:+--bot-token "$BOT"} 2>&1 | grep -v httpx

# Admin (rentix_admin) va rentix_manager parollari .env dagiga
RESET=1 ./deploy.sh bootstrap

docker exec -u root rentix-backend rm -rf /tmp/demo-photos
docker cp demo/photos rentix-backend:/tmp/demo-photos
docker cp demo/manifest.json rentix-backend:/tmp/demo-photos/manifest.json
dc exec -T backend python manage.py shell < demo/apply_photos.py 2>&1 | grep -v httpx
docker exec -u root rentix-backend rm -rf /tmp/demo-photos
echo "✓ demo tayyor"
