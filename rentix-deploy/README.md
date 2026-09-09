# Rentix — deployment

Uchta servis (backend, mijoz ilovasi, admin panel) bitta serverda Docker orqali
ishga tushiriladi. TLS sertifikati avtomatik olinadi.

```
                    Internet :80 / :443
                            │
                        ┌───▼────┐
                        │ Caddy  │  avtomatik Let's Encrypt
                        └───┬────┘
          ┌─────────────────┼──────────────────┐
          ▼                 ▼                  ▼
   user.rentix.uz    admin.rentix.uz     api.rentix.uz
   rentix-user       rentix-admin        rentix-backend
   (nginx + SPA)     (nginx + SPA)       (gunicorn/uvicorn)
          │                 │                  │
          └────── /api/, /ws/ proxy ───────────┤
                                               ▼
                                    PostgreSQL 16 + Redis 7
                                    Celery worker + beat
```

Frontend'lar `/api/` va `/ws/` ni **o'z nginx'i orqali** backendga uzatadi, ya'ni
brauzer faqat o'z domeniga murojaat qiladi — **CORS muammosi umuman yuzaga kelmaydi**.

---

## 1. Server talablari

| | |
|---|---|
| OS | Ubuntu 22.04 / 24.04 (yoki Docker ishlaydigan istalgan Linux) |
| RAM | kamida 4 GB (tavsiya 8 GB) |
| Disk | kamida 20 GB |
| Portlar | **80** va **443** tashqaridan ochiq bo'lishi shart |

Docker o'rnatish:

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker          # yoki qaytadan login qiling
docker compose version # v2 ekanini tekshiring
```

## 2. DNS

Uchta A-record ham shu serverning IP manziliga qaratilsin:

| Nomi | Turi | Qiymati |
|---|---|---|
| `user.rentix.uz` | A | server IP |
| `admin.rentix.uz` | A | server IP |
| `api.rentix.uz` | A | server IP |

> `api.rentix.uz` Django admin paneli, Swagger va Telegram webhook uchun kerak.
> Ishlatmaslik uchun `Caddyfile` dagi oxirgi blokni o'chiring va `.env` da
> `API_DOMAIN` ni bo'sh qoldiring — mijoz va admin ilovalari baribir ishlaydi.

Tekshirish: `dig +short user.rentix.uz` server IP'sini qaytarishi kerak.

## 3. O'rnatish

```bash
# GitHub'ga SSH kalit qo'shilgan bo'lsin:  ssh -T git@github.com
git clone git@github.com:rentix-organization/rentix-deploy.git
cd rentix-deploy

./deploy.sh install
```

`install` quyidagilarni bajaradi:

1. `rentix-backend`, `rentix-user`, `rentix-admin` repolarini yonma-yon klonlaydi
2. `.env` yaratadi, `SECRET_KEY` va `POSTGRES_PASSWORD` ni avtomatik generatsiya qiladi
3. uchta image'ni yig'adi (birinchi marta 5–10 daqiqa)
4. hamma servisni ishga tushiradi, migratsiyalarni bajaradi
5. baza bo'sh bo'lsa demo ma'lumot yuklaydi va kirish ma'lumotlarini chiqaradi

Papkalar tuzilishi shunday bo'lishi kerak:

```
rentix/
├── rentix-deploy/     ← shu yerda turasiz
├── rentix-backend/
├── rentix-user/
└── rentix-admin/
```

### Monorepo (hammasi bitta repoda)

```bash
git clone <monorepo url> rentix
cd rentix
git submodule update --init --recursive   # submodule ishlatilgan bo'lsa
cd rentix-deploy && ./deploy.sh install
```

> **Diqqat:** klondan keyin `ls rentix-backend` bo'sh chiqsa — kod hali
> yuklab olinmagan. `deploy.sh` buni o'zi aniqlab, nima qilish kerakligini
> aytadi. Submodule bo'lmasa, uch papka monorepoga to'g'ridan-to'g'ri
> commit qilingan bo'lishi kerak.

### Alohida repolar

```bash
mkdir rentix && cd rentix
git clone <deploy url>   rentix-deploy
git clone <backend url>  rentix-backend
git clone <user url>     rentix-user
git clone <admin url>    rentix-admin
cd rentix-deploy && ./deploy.sh install
```

Sertifikat 1–2 daqiqada olinadi. Kuzatish: `./deploy.sh logs caddy`

## 4. Kirish ma'lumotlari

Demo ma'lumot yuklangandan keyin:

| Kim | Manzil | Login | Parol |
|---|---|---|---|
| **Admin** | `https://admin.rentix.uz` | `rentix_admin` | `Rentix2024!` |
| **Menejer** | `https://admin.rentix.uz` | `rentix_manager` | `Manager2024!` |

**Mijoz ilovasi** (`https://user.rentix.uz`) — telefon raqami + SMS kod orqali.
Hozir `SMS_MODE=dev` bo'lgani uchun **kod har doim `1111`**, haqiqiy SMS yuborilmaydi.

**Django admin** (`https://api.rentix.uz/admin/`) — `./deploy.sh superuser`

> Birinchi kirishdan keyin parollarni albatta almashtiring.

Kirish ma'lumotlarini keyin ham ko'rish: `./deploy.sh creds`

## 5. Kundalik buyruqlar

```bash
./deploy.sh status          # konteynerlar holati + domenlar tekshiruvi
./deploy.sh update          # kodni yangilash va qayta build
./deploy.sh logs            # barcha loglar
./deploy.sh logs backend    # bitta servis logi
./deploy.sh restart         # qayta ishga tushirish
./deploy.sh backup          # bazaning zaxira nusxasi -> backups/
./deploy.sh superuser       # Django admin uchun superuser
./deploy.sh down            # to'xtatish (ma'lumot saqlanadi)
```

## 6. SMS: dev → prod

Hozir dev rejimida:

```env
SMS_MODE=dev
SMS_DEV_CODE=1111
```

Bu rejimda tasdiqlash kodi **API javobida ochiq qaytariladi**, ya'ni istalgan odam
istalgan telefon raqami nomidan tizimga kira oladi. SMSFly kaliti olingach:

```bash
nano .env
#   SMS_MODE=stage
#   SMSFLY_API_KEY=<kalit>
./deploy.sh restart
```

Tekshirish: `docker compose exec backend python manage.py sms_check_key`

## 7. Telegram bot

1. [@BotFather](https://t.me/BotFather) dan bot yarating va tokenni oling
2. Admin panelga kiring → kompaniya sozlamalari → bot tokenini kiriting va saqlang
3. Backend webhook'ni avtomatik o'rnatadi
   (`RENTIX_BACKEND_PUBLIC_URL=https://api.rentix.uz` shuning uchun kerak)

Qo'lda o'rnatish: `docker compose exec backend python manage.py configure_telegram_bots`

## 8. Ko'p uchraydigan muammolar

**Sertifikat olinmadi**
```bash
./deploy.sh logs caddy
```
Sabablari: DNS hali tarqalmagan (`dig +short user.rentix.uz`), 80/443 yopiq
(`sudo ufw allow 80,443/tcp`), yoki oldinda boshqa nginx/apache ishlayapti
(`sudo systemctl stop nginx`).

**Sayt ochiladi, lekin ma'lumot kelmayapti**
```bash
./deploy.sh logs backend
docker compose exec backend python manage.py check --deploy
```
Ko'pincha `.env` dagi `ALLOWED_HOSTS` ga domen qo'shilmagan bo'ladi.

**502 Bad Gateway** — backend hali ko'tarilmagan yoki qulab tushgan:
```bash
docker compose ps
./deploy.sh logs backend
```

**Rasmlar ko'rinmayapti** — `/media/` frontend nginx orqali `rentix_media_data`
volume'dan beriladi. Volume o'chib ketmaganini tekshiring:
```bash
docker volume ls | grep rentix_media
```

**Bazani tiklash**
```bash
gunzip -c backups/rentix-20260909-120000.sql.gz | \
  docker compose exec -T db psql -U rentixuser -d rentixdb
```

## 9. Domenlarni o'zgartirish

Domenlar **faqat bitta joyda** — `rentix-deploy/.env` da. Frontend kodida ham,
nginx konfiguratsiyasida ham qotirilgan domen yo'q: ilovalar `/api/` ga
(nisbiy manzil) murojaat qiladi, CSP esa `'self'` ishlatadi.

Boshqa domenga o'tish uchun `.env` da 5 ta qatorni almashtirish yetarli:

```env
USER_DOMAIN=user.yangi-domen.uz
ADMIN_DOMAIN=admin.yangi-domen.uz
API_DOMAIN=api.yangi-domen.uz
ALLOWED_HOSTS=api.yangi-domen.uz,user.yangi-domen.uz,admin.yangi-domen.uz,rentix-backend,localhost,127.0.0.1
CORS_ALLOWED_ORIGINS=https://user.yangi-domen.uz,https://admin.yangi-domen.uz
CSRF_TRUSTED_ORIGINS=https://user.yangi-domen.uz,https://admin.yangi-domen.uz,https://api.yangi-domen.uz
RENTIX_USER_WEBAPP_URL=https://user.yangi-domen.uz
RENTIX_BACKEND_PUBLIC_URL=https://api.yangi-domen.uz
```

Keyin `./deploy.sh restart` — Caddy yangi domenlar uchun sertifikatni o'zi oladi.
Telegram bot webhook'i ham yangilanishi uchun:
`docker compose exec backend python manage.py configure_telegram_bots`

## 10. Domensiz lokal sinov

Haqiqiy DNS'siz ham butun stackni sinab ko'rish mumkin — Caddy o'z-o'ziga
imzolangan sertifikat ishlatadi:

```bash
export COMPOSE_FILE="docker-compose.yml:docker-compose.test.yml"
./deploy.sh install
curl -k --resolve user.rentix.uz:443:127.0.0.1 https://user.rentix.uz/
```

Serverda bu o'zgaruvchi kerak emas — oddiy `./deploy.sh install` yetarli.

## 11. GitHub Actions (avtomatik deploy)

Uchala repoda ham `main` ga push bo'lganda CI Docker image yig'adi va serverga
SSH orqali kirib `./deploy.sh update` ni ishga tushiradi.

GitHub'da har bir repo uchun quyidagi secret'lar sozlanishi kerak
(Settings → Secrets and variables → Actions):

| Secret | Qiymati |
|---|---|
| `SERVER_HOST` | serverning IP manzili |
| `SERVER_USERNAME` | SSH foydalanuvchisi (masalan `root`) |
| `SSH_PRIVATE_KEY` | serverga kirish uchun maxfiy kalit |
| `TOKEN` | ghcr.io ga push uchun GitHub token |
| `TELEGRAM_CHATID`, `TELEGRAM_TOKEN` | bildirishnomalar uchun (ixtiyoriy) |

CI skript serverda `/root/rentix/rentix-deploy` yo'lini kutadi. Boshqa joyga
o'rnatsangiz, uchala repodagi `.github/workflows/main.yml` dagi `cd` qatorini
o'zgartiring.

> Server GitHub'dan `git pull` qila olishi uchun serverning SSH kaliti uchala
> repoga ham deploy key sifatida qo'shilgan bo'lishi kerak.

## 12. Xavfsizlik eslatmalari

Deploy'dan keyin bajarilishi kerak:

- [ ] `rentix_admin` va `rentix_manager` parollarini almashtiring
- [ ] SMSFly kaliti olingach `SMS_MODE=stage` ga o'ting
- [ ] `.env` faylini hech qachon git'ga qo'shmang (`.gitignore` da bor)
- [ ] Muntazam zaxira: `crontab -e` →
      `0 3 * * * cd /path/to/rentix-deploy && ./deploy.sh backup`
- [ ] `TELEGRAM_ALLOW_MOCK_INITDATA` doim `False` bo'lsin
- [ ] SSH parol bilan kirishni o'chiring, faqat kalit qoldiring
