"""Demo fotolardan orqa fonni olib tashlaydi: photos-src/*.jpg -> photos/*.webp (shaffof fon).

Mashina rasm markazida, bir xil o'lchamdagi (1200x800) shaffof kanvasda.
Bir martalik vosita, serverda ishlamaydi:
    python -m venv .venv && .venv/bin/pip install "rembg[cpu]" pillow
    .venv/bin/python demo/cutout.py [model]     # standart: isnet-general-use
"""
import pathlib
import sys

from PIL import Image
from rembg import new_session, remove

W, H, PAD = 1200, 800, 40
src = pathlib.Path(__file__).parent / "photos-src"
dst = pathlib.Path(__file__).parent / "photos"
session = new_session(sys.argv[1] if len(sys.argv) > 1 else "isnet-general-use")

for jpg in sorted(src.glob("*.jpg")):
    out = dst / jpg.with_suffix(".webp").name
    img = remove(Image.open(jpg).convert("RGB"), session=session, post_process_mask=True)
    bbox = img.getchannel("A").point(lambda a: 255 if a > 20 else 0).getbbox()
    car = img.crop(bbox)
    scale = min((W - 2 * PAD) / car.width, (H - 2 * PAD) / car.height)
    car = car.resize((round(car.width * scale), round(car.height * scale)), Image.LANCZOS)
    canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    canvas.paste(car, ((W - car.width) // 2, (H - car.height) // 2), car)
    canvas.save(out, "WEBP", quality=88, method=6)
    print(f"{out.name}: {out.stat().st_size // 1024} KB")
