# QA 24.11 N3: o'chirilgan buyurtmalarning qolib ketgan bildirishnomalari
# (masalan #160: "+60 000 keshbek", "#160 yakunlandi"). Havola "/pages/order/<id>"
# bo'yicha, buyurtma bazada yo'q. Yangi kod o'chirishda buni o'zi qiladi.
#   docker compose exec -T backend python manage.py shell < qa2411_orphan_notifications.py              # faqat ko'rsatadi
#   docker compose exec -T -e APPLY=1 backend python manage.py shell < qa2411_orphan_notifications.py   # o'chiradi (+ bot xabarlari)
import os
import re
from user.models import Company, Notification, Order
from user.telegram_bot_service import delete_company_telegram_messages

APPLY = os.getenv("APPLY") == "1"
COMPANY_ID = os.getenv("COMPANY_ID")  # bot xabarlari uchun, bildirishnomada kompaniya bo'lmasa

existing = set(Order.objects.values_list("id", flat=True))
rows = []
for n in Notification.objects.filter(related_order__isnull=True, link__startswith="/pages/order/").select_related("company", "manager"):
    m = re.fullmatch(r"/pages/order/(\d+)", n.link or "")
    if m and int(m.group(1)) not in existing:
        rows.append((int(m.group(1)), n))
for order_id, n in sorted(rows, key=lambda r: (r[0], r[1].id)):
    print(f"order #{order_id}: notification #{n.id} user #{n.user_id} {n.title!r} bot={len(n.bot_messages or [])}")
    if APPLY:
        company = n.company or getattr(n.manager, "company", None)
        if company is None and COMPANY_ID:
            company = Company.objects.filter(id=COMPANY_ID).first()
        if n.bot_messages and company:
            delete_company_telegram_messages(company=company, messages=n.bot_messages)
        n.delete()
print(f"Topildi: {len(rows)}" + (" (o'chirildi)" if APPLY else " (APPLY=1 bilan o'chiriladi)"))
