#!/usr/bin/env bash
# =============================================================================
# Rentix deployment skripti
#
#   ./deploy.sh install    — birinchi marta: repolarni klonlash, .env, build, up
#   ./deploy.sh update     — kodni yangilash va qayta build qilish
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

  ./deploy.sh install    — birinchi marta: repolarni tekshirish, .env, build, up
  ./deploy.sh update     — kodni yangilash va qayta build qilish
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
  for k in SECRET_KEY POSTGRES_PASSWORD USER_DOMAIN ADMIN_DOMAIN API_DOMAIN; do
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

$(printf "${BLD}%s${OFF}" "KIRISH MA'LUMOTLARI")
$(printf "${BLD}%s${OFF}" "$(printf '─%.0s' $(seq 1 60))")

  ${BLD}Admin panel${OFF}   https://${A}
    login     rentix_admin
    parol     Rentix2024!

  ${BLD}Menejer${OFF}       https://${A}
    login     rentix_manager
    parol     Manager2024!

  ${BLD}Mijoz ilovasi${OFF} https://${U}
    Telefon raqami + SMS kod orqali kiriladi.
    SMS_MODE=dev bo'lgani uchun kod har doim: ${BLD}1111${OFF}
    (kod API javobida ham qaytadi — SMSFly kaliti olingach SMS_MODE=stage qiling)

  ${BLD}Django admin${OFF}  https://$(env_get API_DOMAIN)/admin/
    ./deploy.sh superuser  buyrug'i bilan yarating

$(printf "${YLW}%s${OFF}" "  ! Parollarni birinchi kirishdan keyin almashtiring.")

EOF
}

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

  head_ "4/4  Boshlang'ich ma'lumot"
  if dc exec -T backend python manage.py shell -c \
      "from user.models import Company; import sys; sys.exit(0 if Company.objects.exists() else 1)" >/dev/null 2>&1; then
    info "Bazada allaqachon ma'lumot bor — seed o'tkazib yuborildi"
  else
    info "Demo ma'lumot yuklanmoqda (kompaniya, filiallar, mashinalar)"
    dc exec -T backend python manage.py seed_demo 2>&1 | tail -20
  fi

  cmd_status
  show_credentials

  cat <<EOF
${BLD}Keyingi qadamlar${OFF}
  1. DNS: ${BLD}$(env_get USER_DOMAIN)${OFF}, ${BLD}$(env_get ADMIN_DOMAIN)${OFF}, ${BLD}$(env_get API_DOMAIN)${OFF}
     uchta A-record ham shu serverning IP manziliga qaratilgan bo'lsin.
  2. Sertifikat 1–2 daqiqada avtomatik olinadi:  ./deploy.sh logs caddy
  3. Django superuser:  ./deploy.sh superuser
  4. Telegram bot tokenini admin panelning "Sozlamalar" bo'limidan kiriting.

EOF
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
  local U A P
  U="$(env_get USER_DOMAIN)"; A="$(env_get ADMIN_DOMAIN)"; P="$(env_get API_DOMAIN)"
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

cmd_logs()    { dc logs -f --tail=100 "${1:-}"; }
cmd_restart() { check_env; dc restart; wait_healthy rentix-backend 90; cmd_status; }
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
  backup)    cmd_backup ;;
  down)      cmd_down ;;
  creds)     check_env; show_credentials ;;
  *)   usage; exit 1 ;;
esac
