"""Converts public/data/stills to WebP (max 640px wide), drops the duplicate best-scene file
(it is always one of the slideshow frames) and records which films only have low-res frames.

Run after build-stills.py: python scripts/compress-stills.py
"""
import hashlib
import json
import os

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(ROOT, "public", "data", "stills")


def main():
    index = json.load(open(os.path.join(D, "index.json"), encoding="utf-8"))
    before = sum(os.path.getsize(os.path.join(D, f)) for f in os.listdir(D))
    out = {}
    for ident, entry in index.items():
        digest = lambda name: hashlib.sha1(open(os.path.join(D, name), "rb").read()).hexdigest() if os.path.exists(os.path.join(D, name)) else None
        best_hash = digest(entry["best"])
        kb, best, width = [], None, 0
        for name in entry["kb"]:
            src = os.path.join(D, name)
            if not os.path.exists(src):
                continue
            h = digest(name)
            img = Image.open(src).convert("RGB")
            if img.width > 640:
                img = img.resize((640, round(img.height * 640 / img.width)), Image.LANCZOS)
            webp = name.rsplit(".", 1)[0] + ".webp"
            img.save(os.path.join(D, webp), "WEBP", quality=72, method=5)
            os.remove(src)
            kb.append(webp)
            if h == best_hash:
                best, width = webp, img.width
        if entry["best"] not in entry["kb"] and os.path.exists(os.path.join(D, entry["best"])):
            if best is None:  # best somehow not among kb frames: keep it as its own file
                img = Image.open(os.path.join(D, entry["best"])).convert("RGB")
                best = entry["best"].rsplit(".", 1)[0] + ".webp"
                img.save(os.path.join(D, best), "WEBP", quality=72, method=5)
                width = img.width
            os.remove(os.path.join(D, entry["best"]))
        if best:
            out[ident] = {"best": best, "kb": kb, "lo": width < 400}
    json.dump(out, open(os.path.join(D, "index.json"), "w", encoding="utf-8"), separators=(",", ":"))
    after = sum(os.path.getsize(os.path.join(D, f)) for f in os.listdir(D))
    print(f"stills: {len(out)} films, {before / 1e6:.0f} MB -> {after / 1e6:.0f} MB, low-res: {sum(1 for v in out.values() if v['lo'])}")


if __name__ == "__main__":
    main()
