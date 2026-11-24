# QA 22.11 #15: demo mashinalar rangi fotolarga mos (asosiy — birinchi rasm).
#   docker compose exec -T backend python manage.py shell < fix_car_colors.py           # faqat ko'rsatadi
#   APPLY=1 docker compose exec -T -e APPLY=1 backend python manage.py shell < fix_car_colors.py   # yozadi
import os
from user.models import Car

COLORS = {
    ("Chevrolet", "Cobalt"): "white",
    ("Chevrolet", "Gentra"): "silver",
    ("Chevrolet", "Malibu"): "dark_turquoise",   # ko'k; "blue" kaliti yo'q
    ("Chevrolet", "Tracker"): "black",
    ("Toyota", "Camry"): "white",
    ("Toyota", "Corolla"): "glossy_gray",
    ("Toyota", "Land Cruiser Prado"): "white",
    ("Hyundai", "Sonata"): "white",
    ("Hyundai", "Tucson"): "white",
    ("Hyundai", "Elantra"): "silver",
    ("Kia", "K5"): "black",
    ("Kia", "Sportage"): "silver",
    ("BMW", "520d"): "black",
    ("BMW", "X5"): "white",
    ("Mercedes-Benz", "E 200"): "black",
    ("Mercedes-Benz", "GLE 450"): "dark_gray",
    ("Lexus", "RX 350"): "white",
    ("BYD", "Song Plus"): "silver",
}
APPLY = os.getenv("APPLY") == "1"
COMPANY = os.getenv("COMPANY_NAME", "Rentix Rent A Car")  # bo'sh qoldirilsa — barcha kompaniyalar

changed = 0
for (brand, model), color in COLORS.items():
    qs = Car.objects.filter(brand__name=brand, model__name=model)
    if COMPANY:
        qs = qs.filter(company__name=COMPANY)
    for car in qs.select_related("company").order_by("id"):
        if car.car_color == color:
            continue
        print(f"car #{car.id} {brand} {model} {car.car_number} ({car.company.name}): {car.car_color} -> {color}")
        if APPLY:
            # .update(): Car signallari (avto-tarjima, snapshot) chaqirilmaydi
            Car.objects.filter(id=car.id).update(car_color=color)
        changed += 1
print(("Yozildi" if APPLY else "O'zgaradi (APPLY=1 bilan yoziladi)") + f": {changed} ta mashina")
