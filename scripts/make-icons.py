"""Renders PNG app icons and the social preview image. Run: python scripts/make-icons.py"""
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUB = os.path.join(ROOT, "public")
STOPS = [(0.0, (255, 214, 107)), (0.45, (255, 179, 64)), (1.0, (255, 122, 69))]


def grad(size):
    w, h = size
    img = Image.new("RGB", size)
    px = img.load()
    for y in range(h):
        for x in range(w):
            t = (x / w + y / h) / 2
            for (a, ca), (b, cb) in zip(STOPS, STOPS[1:]):
                if a <= t <= b:
                    f = (t - a) / (b - a)
                    px[x, y] = tuple(round(ca[i] + (cb[i] - ca[i]) * f) for i in range(3))
                    break
    return img


def star(cx, cy, r, inner=0.13):
    k = r * inner
    return [(cx, cy - r), (cx + k, cy - k), (cx + r, cy), (cx + k, cy + k), (cx, cy + r), (cx - k, cy + k), (cx - r, cy), (cx - k, cy - k)]


def icon(n, maskable=False):
    s = 4  # supersample
    N = n * s
    base = Image.new("RGBA", (N, N), (11, 11, 15, 255))
    inset = 0 if maskable else round(N * 0.11)
    tile = grad((N - 2 * inset, N - 2 * inset))
    mask = Image.new("L", tile.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, *tile.size], radius=round(tile.size[0] * (0.0 if maskable else 0.23)), fill=255)
    base.paste(tile, (inset, inset), mask)
    d = ImageDraw.Draw(base)
    d.polygon(star(N / 2, N / 2, N * (0.27 if maskable else 0.265)), fill=(26, 18, 5, 255))
    return base.resize((n, n), Image.LANCZOS)


def og():
    W, H = 1200, 630
    img = Image.new("RGB", (W, H), (5, 5, 7))
    glow = Image.new("RGB", (W, H), (5, 5, 7))
    g = ImageDraw.Draw(glow)
    g.ellipse([-200, -300, 700, 500], fill=(150, 90, 30))
    g.ellipse([700, 250, 1500, 950], fill=(40, 50, 140))
    img = Image.blend(img, glow.filter(ImageFilter.GaussianBlur(140)), 0.9)
    logo = icon(160)
    img.paste(logo, (90, 110), logo)
    d = ImageDraw.Draw(img)
    fonts = "C:/Windows/Fonts/"
    try:
        big = ImageFont.truetype(fonts + "segoeuib.ttf", 120)
        mid = ImageFont.truetype(fonts + "segoeui.ttf", 40)
    except OSError:
        big = mid = ImageFont.load_default()
    d.text((88, 300), "Lumen", font=big, fill=(245, 245, 247))
    d.text((92, 450), "Free classic cinema & TV, streamed beautifully.", font=mid, fill=(200, 200, 210))
    img.save(os.path.join(PUB, "og.png"), optimize=True)


if __name__ == "__main__":
    icon(180).save(os.path.join(PUB, "icon-180.png"))
    icon(192).save(os.path.join(PUB, "icon-192.png"))
    icon(512, maskable=True).save(os.path.join(PUB, "icon-512.png"))
    og()
    print("icons written")
