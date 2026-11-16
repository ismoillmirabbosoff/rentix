# seed_presentation dan keyin: mashinalarning rang-to'rtburchak rasmlarini haqiqiy
# fotolarga almashtiradi, demo menejer parollarini .env dagiga o'rnatadi va Telegram
# botni (yangi kompaniya uchun) qayta sozlaydi. Backend kodi o'zgartirilmaydi:
#   docker compose exec -T backend python manage.py shell < demo/apply_photos.py
# Rasmlar konteynerga oldindan /tmp/demo-photos ga ko'chirilgan bo'lishi kerak.
import json
import os
import pathlib

from django.contrib.auth.hashers import make_password
from django.core.files.base import ContentFile

from user.models import Car, CarImage, Company, Manager
from user.telegram_bot_service import configure_company_telegram_bot

SRC = pathlib.Path("/tmp/demo-photos")
manifest = json.loads((SRC / "manifest.json").read_text())

done, missing = 0, []
for car in Car.objects.select_related("brand", "model"):
    key = f"{car.brand.name} {car.model.name}"
    files = manifest.get(key)
    if not files:
        missing.append(key)
        continue
    for old in CarImage.objects.filter(car=car):
        old.image.delete(save=False)
        old.delete()
    for name in files:
        CarImage.objects.create(car=car, image=ContentFile((SRC / name).read_bytes(), name=name))
    car.car_image_logo = CarImage.objects.filter(car=car).order_by("id").first().image.url
    car.save(update_fields=["car_image_logo"])
    done += 1
print(f"✓ rasmlar almashtirildi: {done} ta mashina" + (f", rasmsiz: {missing}" if missing else ""))

pw = (os.getenv("RENTIX_MANAGER_PASSWORD") or "").strip()
if pw:
    n = Manager.objects.update(password=make_password(pw))
    print(f"✓ {n} ta menejer paroli .env dagi RENTIX_MANAGER_PASSWORD ga o'rnatildi")

for company in Company.objects.exclude(telegram_bot_token__isnull=True).exclude(telegram_bot_token=""):
    r = configure_company_telegram_bot(company)
    print(f"✓ bot @{r['bot']['username']}: webhook={r['webhook_configured']} menu={r['menu_button_configured']} url={r['webapp_url']}")
