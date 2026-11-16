#!/usr/bin/env bash
# Faqat mashina rasmlarini demo/photos dagilarga almashtiradi (baza tozalanmaydi,
# parollar va bot tegilmaydi):   cd rentix-deploy && demo/update-photos.sh
set -euo pipefail
cd "$(dirname "$0")/.."      # rentix-deploy
docker exec -u root rentix-backend rm -rf /tmp/demo-photos
docker cp demo/photos rentix-backend:/tmp/demo-photos
docker cp demo/manifest.json rentix-backend:/tmp/demo-photos/manifest.json
docker compose exec -T -e RENTIX_PHOTOS_ONLY=1 backend python manage.py shell < demo/apply_photos.py 2>&1 | grep -v httpx
docker exec -u root rentix-backend rm -rf /tmp/demo-photos
echo "✓ rasmlar yangilandi"
