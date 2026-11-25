# QA 24.11 N8: bekor qilingan / rad etilgan buyurtmalarda ishlatilgan, lekin
# qaytarilmagan keshbek ("spend" bor, "refund" yo'q). Yangi backend kerak
# (Order.refund_spent_cashback).
#   docker compose exec -T backend python manage.py shell < qa2411_cashback_refunds.py                 # faqat ko'rsatadi
#   docker compose exec -T -e APPLY=1 backend python manage.py shell < qa2411_cashback_refunds.py      # refund yozadi
#   ... -e APPLY=1 -e NOTIFY=1 ...   # mijozga "Keshbek qaytarildi" bildirishnomasi ham (ilova + bot)
import os
from django.db import transaction
from django.db.models import Exists, OuterRef, Sum
from django.db.models.signals import post_save
from user.models import CashbackTransaction, Order
from user.signals import send_cashback_notification

APPLY = os.getenv("APPLY") == "1"
NOTIFY = os.getenv("NOTIFY") == "1"

orders = (
    Order.objects.filter(status__in=["cancelled", "rejected"])
    .annotate(
        has_spend=Exists(CashbackTransaction.objects.filter(order=OuterRef("pk"), type="spend")),
        has_refund=Exists(CashbackTransaction.objects.filter(order=OuterRef("pk"), type="refund")),
        has_earn=Exists(CashbackTransaction.objects.filter(order=OuterRef("pk"), type="earn")),
    )
    .filter(has_spend=True, has_refund=False)
    .select_related("user")
    .order_by("id")
)
earn_left = Order.objects.filter(
    status__in=["cancelled", "rejected"],
    cashback_transactions__type="earn",
).distinct()

total = 0.0
if APPLY and not NOTIFY:
    post_save.disconnect(send_cashback_notification, sender=CashbackTransaction)
try:
    for order in orders:
        spent = CashbackTransaction.objects.filter(order=order, type="spend").aggregate(s=Sum("amount"))["s"] or 0
        total += float(spent)
        print(f"order #{order.id} {order.status} user #{order.user_id} {order.user.full_name!r}: spend {float(spent):,.0f}".replace(",", " "))
        if APPLY:
            with transaction.atomic():
                order.refund_spent_cashback()
    for order in earn_left:
        print(f"order #{order.id} {order.status}: 'earn' yozuvi qolgan")
        if APPLY:
            CashbackTransaction.objects.filter(order=order, type="earn").delete()
finally:
    if APPLY and not NOTIFY:
        post_save.connect(send_cashback_notification, sender=CashbackTransaction)
amount = f"{total:,.0f}".replace(",", " ")
print(
    f"Buyurtmalar: {orders.count() if not APPLY else 'yozildi'}; jami qaytariladigan: {amount} so'm"
    + ("" if APPLY else " (APPLY=1 bilan yoziladi)")
)
