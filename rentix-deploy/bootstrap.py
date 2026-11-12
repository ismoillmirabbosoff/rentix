# Deploy uchun boshlang'ich holat — DEMO MA'LUMOTSIZ. Backend kodiga tegmaydi:
#   docker compose exec -T backend python manage.py shell < bootstrap.py
# (deploy.sh bootstrap shuni bajaradi)
#
# Faqat yo'q bo'lsa yaratadi: viloyatlar, brend katalogi, kompaniya (admin),
# filial (signal avtomatik yaratadi), menejer. Mavjudlariga tegmaydi.
# RENTIX_RESET_PASSWORDS=1 bo'lsa admin/menejer parollarini .env dagiga qaytaradi.
import os

from django.contrib.auth.hashers import make_password
from django.core.management import call_command

from user.management.commands.seed_demo import BRANDS_AND_MODELS, _attach_brand_icon
from user.models import CarBrand, CarModel, Company, Filial, Manager


def env(key, default=None):
    val = (os.getenv(key) or "").strip() or default
    if val is None:
        raise SystemExit(f"{key} bo'sh")
    return val


admin_login, admin_pw = env("RENTIX_ADMIN_LOGIN"), env("RENTIX_ADMIN_PASSWORD")
mgr_login, mgr_pw = env("RENTIX_MANAGER_LOGIN"), env("RENTIX_MANAGER_PASSWORD")
name = env("RENTIX_COMPANY_NAME", "Rentix")
phone = env("RENTIX_COMPANY_PHONE", "+998900000000")
reset = os.getenv("RENTIX_RESET_PASSWORDS") == "1"

call_command("seed_static", verbosity=0)

for b in BRANDS_AND_MODELS:
    brand, _ = CarBrand.objects.get_or_create(
        name=b["name"], defaults={"name_ru": b["name"], "name_en": b["name"]})
    _attach_brand_icon(brand.id, b["name"])
    for m in b["models"]:
        CarModel.objects.get_or_create(brand=brand, name=m, defaults={"name_ru": m, "name_en": m})
print(f"✓ viloyatlar, brend katalogi ({CarBrand.objects.count()} brend)")

company = Company.objects.filter(login=admin_login).first()
if company is None:
    company = Company.objects.create(
        name=name, full_name=name, phone1=phone, phone2=phone,
        login=admin_login, password=make_password(admin_pw))
    print(f"✓ kompaniya yaratildi (login={admin_login})")
elif reset:
    company.password = make_password(admin_pw)
    company.save(update_fields=["password"])
    print("✓ admin paroli yangilandi")
else:
    print(f"• kompaniya mavjud (login={admin_login})")

filial = company.filials.order_by("id").first() or Filial.objects.create(
    company=company, name="Asosiy filial", phone=phone)

manager = Manager.objects.filter(login=mgr_login).first()
if manager is None:
    Manager.objects.create(
        full_name="Menejer", phone=phone, company=company, filial=filial,
        work_time="09:00-20:00", status="active",
        login=mgr_login, password=make_password(mgr_pw))
    print(f"✓ menejer yaratildi (login={mgr_login})")
elif reset:
    manager.password = make_password(mgr_pw)
    manager.status = "active"
    manager.save(update_fields=["password", "status"])
    print("✓ menejer paroli yangilandi")
else:
    print(f"• menejer mavjud (login={mgr_login})")
