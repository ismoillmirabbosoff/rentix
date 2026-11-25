# QA 24.11 N0: telegram_id yo'q (NULL yoki 0) mijozlar va ularning ma'lum
# Telegram chatlari (TelegramIdentity, bot yuborgan xabarlar, buyurtma snapshoti).
#   docker compose exec -T backend python manage.py shell < qa2411_telegram_ids.py               # faqat ko'rsatadi (read-only)
#   docker compose exec -T -e APPLY=1 backend python manage.py shell < qa2411_telegram_ids.py    # yagona va bo'sh nomzodni yozadi
import os
from django.db.models import Q
from user.models import Notification, Order, TelegramIdentity, User

APPLY = os.getenv("APPLY") == "1"

users = (
    User.objects.filter(Q(telegram_id__isnull=True) | Q(telegram_id=0))
    .exclude(role__in=["superadmin", "admin", "manager"])
    .order_by("id")
)
fixed = listed = 0
for u in users:
    sources = {}
    for tid, active in TelegramIdentity.objects.filter(user=u).values_list("telegram_id", "is_active"):
        sources.setdefault(tid, set()).add("identity" + ("" if active else "(inactive)"))
    for tid in (
        Notification.objects.filter(user=u, bot_chat_id__gt=0).values_list("bot_chat_id", flat=True).distinct()
    ):
        sources.setdefault(tid, set()).add("bot_message")
    for snap in Order.objects.filter(user=u).values_list("user_snapshot", flat=True):
        tid = (snap or {}).get("telegram_id")
        if isinstance(tid, int) and tid > 0:
            sources.setdefault(tid, set()).add("order_snapshot")
    if not sources:
        continue
    listed += 1
    print(f"user #{u.id} {u.full_name!r} {u.phone} telegram_id={u.telegram_id!r}")
    for tid, src in sorted(sources.items()):
        holder = User.objects.filter(telegram_id=tid).exclude(id=u.id).values_list("id", flat=True).first()
        note = f" (hozir user #{holder} da)" if holder else ""
        print(f"    {tid}: {', '.join(sorted(src))}{note}")
    free = [tid for tid in sources if not User.objects.filter(telegram_id=tid).exclude(id=u.id).exists()]
    if APPLY and len(sources) == 1 and len(free) == 1:
        # .update(): User signallari chaqirilmaydi
        User.objects.filter(id=u.id).update(telegram_id=free[0])
        print(f"    -> telegram_id={free[0]} yozildi")
        fixed += 1
print(f"Nomzodli mijozlar: {listed}" + (f", yozildi: {fixed}" if APPLY else " (APPLY=1 bilan yagona bo'sh nomzod yoziladi)"))
