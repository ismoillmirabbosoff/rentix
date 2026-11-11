#!/usr/bin/env bash
# =============================================================================
# Rentix deployment skripti
#
#   ./deploy.sh install    — birinchi marta: .env, build, up, admin + menejer
#   ./deploy.sh update     — kodni yangilash va qayta build qilish (CI shuni chaqiradi)
#   ./deploy.sh nginx      — host nginx saytlari + certbot (umumiy server rejimi)
#   ./deploy.sh seed       — demo ma'lumot yuklash (BAZANI TOZALAYDI!)
#   ./deploy.sh superuser  — Django admin uchun superuser yaratish
#   ./deploy.sh status     — konteynerlar holati va sog'lig'i
#   ./deploy.sh logs [nom] — loglar
#   ./deploy.sh restart    — qayta ishga tushirish
#   ./deploy.sh backup     — bazaning zaxira nusxasi
#   ./deploy.sh down       — to'xtatish (ma'lumot saqlanadi)
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")"

GIT_ORG="${GIT_ORG:-git@github.com:rentix-organization}"
REPOS=(rentix-backend rentix-user rentix-admin)

RED=$'\e[31m'; GRN=$'\e[32m'; YLW=$'\e[33m'; BLU=$'\e[36m'; BLD=$'\e[1m'; OFF=$'\e[0m'
ok()   { echo "${GRN}✓${OFF} $*"; }
info() { echo "${BLU}›${OFF} $*"; }
warn() { echo "${YLW}!${OFF} $*"; }
die()  { echo "${RED}✗ $*${OFF}" >&2; exit 1; }
head_() { echo; echo "${BLD}$*${OFF}"; echo "${BLD}$(printf '─%.0s' $(seq 1 60))${OFF}"; }

# ─────────────────────────────────────────────────────────── yordamchi funksiyalar

usage() {
  cat <<'USAGE'
Rentix deployment skripti

  ./deploy.sh install    — birinchi marta: .env, build, up, admin + menejer
  ./deploy.sh update     — kodni yangilash va qayta build qilish (CI shuni chaqiradi)
  ./deploy.sh nginx      — host nginx saytlari + certbot (umumiy server rejimi)
  ./deploy.sh seed       — demo ma'lumot yuklash (BAZANI TOZALAYDI!)
  ./deploy.sh superuser  — Django admin uchun superuser yaratish
  ./deploy.sh status     — konteynerlar holati va sog'lig'i
  ./deploy.sh logs [nom] — loglar
  ./deploy.sh restart    — qayta ishga tushirish
  ./deploy.sh backup     — bazaning zaxira nusxasi
  ./deploy.sh creds      — kirish ma'lumotlarini ko'rsatish
  ./deploy.sh down       — to'xtatish (ma'lumot saqlanadi)
USAGE
}

dc() { docker compose "$@"; }

require_tools() {
  command -v docker >/dev/null 2>&1 || die "docker o'rnatilmagan. https://docs.docker.com/engine/install/"
  docker compose version >/dev/null 2>&1 || die "docker compose plugin yo'q. 'docker-compose' emas, 'docker compose' kerak."
  docker info >/dev/null 2>&1 || die "docker demon ishlamayapti yoki ruxsat yo'q (sudo usermod -aG docker \$USER)."
  command -v git >/dev/null 2>&1 || die "git o'rnatilmagan."
}

gen_secret() { python3 -c "import secrets;print(secrets.token_urlsafe(48))" 2>/dev/null || openssl rand -base64 48 | tr -d '\n/+=' ; }

# .env dagi bo'sh kalitni qiymat bilan to'ldiradi
fill_env() {
  local key="$1" val="$2"
  if grep -qE "^${key}=$" .env; then
    # sed uchun xavfsiz almashtirish
    python3 - "$key" "$val" <<'PY'
import sys, pathlib
key, val = sys.argv[1], sys.argv[2]
p = pathlib.Path(".env")
lines = p.read_text().splitlines(keepends=True)
out = []
for line in lines:
    if line.rstrip("\n") == f"{key}=":
        out.append(f"{key}={val}\n")
    else:
        out.append(line)
p.write_text("".join(out))
PY
    ok "$key avtomatik yaratildi"
  fi
}

env_get() { grep -E "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2- ; }

check_env() {
  [ -f .env ] || die ".env fayli yo'q. Avval: ./deploy.sh install"
  local missing=()
  for k in SECRET_KEY POSTGRES_PASSWORD USER_DOMAIN ADMIN_DOMAIN \
           RENTIX_ADMIN_LOGIN RENTIX_ADMIN_PASSWORD RENTIX_MANAGER_LOGIN RENTIX_MANAGER_PASSWORD; do
    [ -n "$(env_get "$k")" ] || missing+=("$k")
  done
  [ ${#missing[@]} -eq 0 ] || die ".env da quyidagilar bo'sh: ${missing[*]}"
}


# Har bir manba papkasida bo'lishi shart bo'lgan fayllar
declare -A REQUIRED=(
  [rentix-backend]="Dockerfile manage.py requirements.txt"
  [rentix-user]="Dockerfile package.json nginx.conf"
  [rentix-admin]="Dockerfile package.json nginx.conf"
)

preflight_sources() {
  local missing=() r f
  for r in "${REPOS[@]}"; do
    if [ ! -d "../$r" ]; then
      missing+=("$r (papka umuman yo'q)")
      continue
    fi
    for f in ${REQUIRED[$r]}; do
      [ -f "../$r/$f" ] || { missing+=("$r/$f"); break; }
    done
  done

  [ ${#missing[@]} -eq 0 ] && return 0

  echo
  die "Manba kodi topilmadi:
    $(printf '%s\n    ' "${missing[@]}")
  Papkalar bo'sh — kod hali yuklab olinmagan.

  Agar submodule ishlatilgan bo'lsa:
      git -C .. submodule update --init --recursive

  Agar alohida repolar bo'lsa (yonma-yon klonlash):
      cd .. && git clone <rentix-backend url> rentix-backend \\
                 && git clone <rentix-user url> rentix-user \\
                 && git clone <rentix-admin url> rentix-admin

  Tekshirish:  ls ../rentix-backend"
}

sync_repos() {
  head_ "1/4  Manba kodi"

  if [ "${SKIP_SYNC:-0}" = "1" ]; then
    info "SKIP_SYNC=1 — kod allaqachon tayyorlangan (CI)"
    preflight_sources
    ok "uchala manba papkasi joyida"
    return 0
  fi

  # Ota-papka git repo bo'lsa — monorepo (yoki submodule konteyner)
  if git -C .. rev-parse --git-dir >/dev/null 2>&1; then
    if [ -n "$(git -C .. status --porcelain --untracked-files=no)" ]; then
      warn "monorepoda saqlanmagan o'zgarishlar bor — pull o'tkazib yuborildi"
    else
      info "monorepo yangilanmoqda"
      git -C .. pull --ff-only --quiet 2>/dev/null \
        && ok "monorepo $(git -C .. rev-parse --short HEAD)" \
        || warn "pull bajarilmadi (masofaviy repo yoki branch sozlanmagan)"
    fi
    if [ -f "../.gitmodules" ]; then
      info "submodule lar yangilanmoqda"
      git -C .. submodule update --init --recursive --quiet \
        && ok "submodule lar tayyor" \
        || warn "submodule update bajarilmadi"
    fi
  fi

  # Har bir papka alohida repo bo'lsa — o'zini yangilaydi
  local r
  for r in "${REPOS[@]}"; do
    if [ -d "../$r/.git" ] && [ ! -f "../$r/.git" ]; then
      if [ -n "$(git -C "../$r" status --porcelain --untracked-files=no)" ]; then
        warn "$r da saqlanmagan o'zgarishlar bor — sync o'tkazib yuborildi"
      elif git -C "../$r" rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
        git -C "../$r" fetch --quiet origin 2>/dev/null || true
        git -C "../$r" reset --hard --quiet origin/main 2>/dev/null \
          && ok "$r $(git -C "../$r" rev-parse --short HEAD)" \
          || warn "$r yangilanmadi"
      fi
    fi
  done

  preflight_sources
  ok "uchala manba papkasi joyida"
}

wait_healthy() {
  local name="$1" tries="${2:-60}"
  info "$name kutilmoqda..."
  for _ in $(seq 1 "$tries"); do
    local st
    st="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$name" 2>/dev/null || echo "yo'q")"
    case "$st" in
      healthy|running) ok "$name tayyor"; return 0 ;;
      exited|dead)     docker logs --tail 40 "$name" 2>&1 | sed 's/^/    /'; die "$name to'xtab qoldi" ;;
    esac
    sleep 3
  done
  docker logs --tail 40 "$name" 2>&1 | sed 's/^/    /'
  die "$name belgilangan vaqtda tayyor bo'lmadi"
}

show_credentials() {
  local U A
  U="$(env_get USER_DOMAIN)"; A="$(env_get ADMIN_DOMAIN)"
  cat <<EOF

${BLD}KIRISH MA'LUMOTLARI${OFF}
${BLD}$(printf '─%.0s' $(seq 1 60))${OFF}

  ${BLD}Admin panel${OFF}   https://${A}
    login     $(env_get RENTIX_ADMIN_LOGIN)
    parol     $(env_get RENTIX_ADMIN_PASSWORD)

  ${BLD}Menejer${OFF}       https://${A}
    login     $(env_get RENTIX_MANAGER_LOGIN)
    parol     $(env_get RENTIX_MANAGER_PASSWORD)

  ${BLD}Mijoz ilovasi${OFF} https://${U}
    Telefon raqami + SMS kod orqali (SMS_MODE=$(env_get SMS_MODE)).

  Parollar faqat shu serverdagi .env da saqlanadi.
  Almashtirish: .env ni tahrirlang va  ./deploy.sh reset-passwords

EOF
}

# Admin + menejer + ma'lumotnomalar. Idempotent — har deployda xavfsiz.
bootstrap() {
  dc exec -T backend python manage.py bootstrap_prod "$@" 2>&1 | grep -v "httpx" | sed 's/^/    /'
}

server_ip() { curl -s -4 -m 8 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}'; }

# ───────────────────────────────────────────────────────────────── buyruqlar

cmd_install() {
  head_ "Rentix — birinchi o'rnatish"
  require_tools

  if [ ! -f .env ]; then
    cp .env.example .env
    ok ".env yaratildi (.env.example dan)"
  else
    info ".env allaqachon mavjud — saqlanib qoldi"
  fi

  fill_env SECRET_KEY "$(gen_secret)"
  fill_env POSTGRES_PASSWORD "$(gen_secret | cut -c1-32)"
  fill_env RENTIX_ADMIN_PASSWORD "$(gen_secret | cut -c1-16)"
  fill_env RENTIX_MANAGER_PASSWORD "$(gen_secret | cut -c1-16)"
  check_env

  sync_repos

  head_ "2/4  Image'lar yig'ilmoqda (birinchi marta 5–10 daqiqa)"
  dc build --pull
  ok "build tugadi"

  head_ "3/4  Servislar ishga tushmoqda"
  dc up -d
  wait_healthy rentix-postgres 40
  wait_healthy rentix-redis 20
  wait_healthy rentix-backend 90

  head_ "4/4  Admin + menejer (demo ma'lumotsiz)"
  bootstrap

  cmd_status
  show_credentials

  if [ -n "$(env_get USER_PORT)" ]; then
    cat <<EOF
${BLD}Keyingi qadam${OFF}
  DNS A-record: $(env_get USER_DOMAIN), $(env_get ADMIN_DOMAIN) -> shu server IP.
  So'ng:  ./deploy.sh nginx   (host nginx sayti + Let's Encrypt sertifikat)

EOF
  fi
}

cmd_update() {
  head_ "Yangilash"
  require_tools; check_env
  sync_repos
  head_ "Build"
  dc build
  head_ "Qayta ishga tushirish"
  dc up -d --remove-orphans
  wait_healthy rentix-backend 90
  bootstrap
  docker image prune -f >/dev/null 2>&1 || true
  cmd_status
  ok "Yangilandi"
}

cmd_seed() {
  check_env
  warn "Bu buyruq BAZANI TO'LIQ TOZALAYDI va demo ma'lumot yuklaydi."
  read -r -p "Davom etilsinmi? 'ha' deb yozing: " a
  [ "$a" = "ha" ] || { info "Bekor qilindi"; exit 0; }
  cmd_backup
  dc exec -T backend python manage.py seed_demo
  show_credentials
}

cmd_superuser() {
  check_env
  echo "Django admin uchun superuser. Telefon raqamini +998... ko'rinishida kiriting."
  dc exec backend python manage.py createsuperuser
}

cmd_status() {
  head_ "Holat"
  dc ps --format "table {{.Name}}\t{{.Service}}\t{{.Status}}"
  echo
  local U A P port
  U="$(env_get USER_DOMAIN)"; A="$(env_get ADMIN_DOMAIN)"; P="$(env_get API_DOMAIN)"
  for port in "$(env_get USER_PORT)" "$(env_get ADMIN_PORT)"; do
    [ -n "$port" ] || continue
    local lc
    lc="$(curl -sS -o /dev/null -w '%{http_code}' -m 8 "http://127.0.0.1:$port/" 2>/dev/null || echo "---")"
    [ "$lc" = "200" ] && ok "127.0.0.1:$port  →  HTTP $lc" || warn "127.0.0.1:$port  →  $lc"
  done
  for d in "$U" "$A" "$P"; do
    [ -n "$d" ] || continue
    local code
    code="$(curl -sS -o /dev/null -w '%{http_code}' -m 12 "https://$d/" 2>/dev/null || echo "---")"
    if [ "$code" = "200" ] || [ "$code" = "302" ] || [ "$code" = "404" ]; then
      ok "https://$d  →  HTTP $code"
    else
      warn "https://$d  →  $code  (DNS yoki sertifikat hali tayyor emas)"
    fi
  done
}

# Umumiy server: host nginx'da sayt yaratadi va DNS tayyor bo'lsa sertifikat oladi.
# Qayta ishga tushirish xavfsiz — cron orqali ham chaqiriladi (sertifikat yo'q bo'lsa).
cmd_nginx() {
  check_env
  command -v nginx >/dev/null 2>&1 || die "host nginx topilmadi"
  local ip changed=0 d port conf
  ip="$(server_ip)"

  if [ ! -f /etc/nginx/conf.d/rentix-ws-map.conf ]; then
    cp nginx/rentix-ws-map.conf /etc/nginx/conf.d/rentix-ws-map.conf; changed=1
  fi
  for pair in "$(env_get USER_DOMAIN):$(env_get USER_PORT)" "$(env_get ADMIN_DOMAIN):$(env_get ADMIN_PORT)"; do
    d="${pair%%:*}"; port="${pair##*:}"
    [ -n "$d" ] && [ -n "$port" ] || die "USER_PORT/ADMIN_PORT .env da yo'q"
    conf="/etc/nginx/conf.d/$d.conf"
    if [ ! -f "$conf" ]; then
      sed -e "s/__DOMAIN__/$d/g" -e "s/__PORT__/$port/g" nginx/site.conf.template > "$conf"
      ok "nginx sayti yaratildi: $conf"; changed=1
    fi
  done
  if [ "$changed" = 1 ]; then
    nginx -t 2>&1 | tail -2 && systemctl reload nginx && ok "nginx qayta yuklandi"
  fi

  for d in "$(env_get USER_DOMAIN)" "$(env_get ADMIN_DOMAIN)"; do
    if [ -d "/etc/letsencrypt/live/$d" ]; then
      ok "$d — sertifikat bor"; continue
    fi
    local resolved
    resolved="$(getent ahostsv4 "$d" 2>/dev/null | awk '{print $1; exit}')"
    if [ "$resolved" != "$ip" ]; then
      warn "$d DNS hali shu serverga ($ip) qaramayapti (hozir: ${resolved:-none}) — sertifikat keyinroq"
      continue
    fi
    certbot --nginx -d "$d" --non-interactive --agree-tos -m "$(env_get ACME_EMAIL)" --redirect \
      && ok "$d — sertifikat olindi" || warn "$d — certbot xato berdi"
  done
}

cmd_logs()    { dc logs -f --tail=100 "${1:-}"; }
# DIQQAT: `docker compose restart` .env o'zgarishlarini QAYTA O'QIMAYDI.
# Konteynerlar qayta yaratilishi shart, aks holda eski sozlama qoladi.
cmd_restart() { check_env; dc up -d --force-recreate; wait_healthy rentix-backend 90; cmd_status; }
cmd_down()    { dc down; ok "To'xtatildi (ma'lumot saqlanib qoldi)"; }

cmd_backup() {
  check_env
  mkdir -p backups
  local f="backups/rentix-$(date +%Y%m%d-%H%M%S).sql.gz"
  info "Zaxira: $f"
  dc exec -T db pg_dump -U "$(env_get POSTGRES_USER)" "$(env_get POSTGRES_DB)" | gzip > "$f"
  ok "$(du -h "$f" | cut -f1) saqlandi"
}

case "${1:-}" in
  install)   cmd_install ;;
  update)    cmd_update ;;
  seed)      cmd_seed ;;
  superuser) cmd_superuser ;;
  status)    cmd_status ;;
  logs)      cmd_logs "${2:-}" ;;
  restart)   cmd_restart ;;
  nginx)     cmd_nginx ;;
  bootstrap) check_env; bootstrap ;;
  reset-passwords) check_env; dc up -d --force-recreate backend; wait_healthy rentix-backend 90; bootstrap --reset-passwords ;;
  backup)    cmd_backup ;;
  down)      cmd_down ;;
  creds)     check_env; show_credentials ;;
  *)   usage; exit 1 ;;
esac
