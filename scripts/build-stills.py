"""Picks the best scene for each film that has no TMDB backdrop, from the Internet Archive's own
scene thumbnails (one frame per minute), and copies the winners to public/data/stills/.

Scoring favours frames that are well exposed, contrasty, detailed and not intertitles or credits.
Writes public/data/stills/index.json: {archive_id: {"best": "<slug>.jpg", "kb": ["<slug>_1.jpg", ...]}}

Run after build-catalog.py: python scripts/build-stills.py   (then split_catalog.py picks it up)
"""
import hashlib
import io
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from PIL import Image, ImageFilter, ImageStat

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, ".cache", "http")
THUMBS = os.path.join(ROOT, ".cache", "thumbs")
OUT = os.path.join(ROOT, "public", "data", "stills")
UA = {"User-Agent": "LumenCatalog/2.0 (https://github.com/Arnav-Dugad/lumen-cinema)"}
CANDIDATES = 9
KEEP_KB = 4


def fetch(url, binary=False, retries=4):
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                data = r.read()
                return data if binary else json.loads(data)
        except Exception:
            if attempt == retries - 1:
                return None
            time.sleep(1.5 * (attempt + 1))


def metadata(ident):
    url = "https://archive.org/metadata/" + urllib.parse.quote(ident)
    path = os.path.join(CACHE, hashlib.sha1(url.encode()).hexdigest() + ".json")
    if os.path.exists(path):
        return json.load(open(path, encoding="utf-8"))
    d = fetch(url)
    if d:
        os.makedirs(CACHE, exist_ok=True)
        json.dump(d, open(path, "w", encoding="utf-8"))
    return d


def score(img, position):
    """Higher is better. `position` is 0..1 through the film."""
    g = img.convert("L")
    stat = ImageStat.Stat(g)
    mean, std = stat.mean[0], stat.stddev[0]
    hist = g.histogram()
    total = sum(hist)
    dark = sum(hist[:40]) / total
    bright = sum(hist[225:]) / total
    edges = ImageStat.Stat(g.filter(ImageFilter.FIND_EDGES)).mean[0]
    rgb = ImageStat.Stat(img.convert("RGB")).stddev
    colour = (max(rgb) - min(rgb))  # colour films get a small bonus for chroma variety
    s = std * 1.2 + edges * 2.0 + colour * 0.4
    s -= abs(mean - 115) * 0.6               # well exposed
    if dark > 0.55 and bright > 0.04:         # white text on black: intertitle or credits
        s -= 60
    if dark > 0.75 or bright > 0.5:           # black frame / blown out
        s -= 80
    if position < 0.06 or position > 0.92:    # opening titles / end credits
        s -= 40
    return s


def process(film):
    meta = metadata(film["id"])
    if not meta:
        return film["id"], None
    thumbs = []
    for f in meta.get("files", []):
        m = re.search(r"\.thumbs/.+_(\d{6})\.jpg$", f["name"], re.I)
        if m:
            thumbs.append((int(m.group(1)), f["name"]))
    thumbs.sort()
    if len(thumbs) < 3:
        return film["id"], None
    length = film.get("len") or thumbs[-1][0] or 1
    step = max(1, len(thumbs) // (CANDIDATES + 1))
    picks = thumbs[step::step][:CANDIDATES]
    scored = []
    for sec, name in picks:
        cache = os.path.join(THUMBS, hashlib.sha1((film["id"] + name).encode()).hexdigest() + ".jpg")
        if os.path.exists(cache):
            data = open(cache, "rb").read()
        else:
            data = fetch(f"https://archive.org/download/{urllib.parse.quote(film['id'])}/{urllib.parse.quote(name)}", binary=True)
            if not data:
                continue
            open(cache, "wb").write(data)
        try:
            img = Image.open(io.BytesIO(data))
            img.load()
        except Exception:
            continue
        scored.append((score(img, sec / length), sec, data))
    if not scored:
        return film["id"], None
    scored.sort(key=lambda x: x[0], reverse=True)
    slug = re.sub(r"[^A-Za-z0-9_-]", "_", film["id"])
    best = f"{slug}.jpg"
    open(os.path.join(OUT, best), "wb").write(scored[0][2])
    kb = []
    # Ken Burns stills in story order, from the best-scoring frames.
    for i, (_, sec, data) in enumerate(sorted(scored[:KEEP_KB], key=lambda x: x[1]), 1):
        name = f"{slug}_{i}.jpg"
        open(os.path.join(OUT, name), "wb").write(data)
        kb.append(name)
    return film["id"], {"best": best, "kb": kb}


def main():
    films = json.load(open(os.path.join(ROOT, ".cache", "catalog-full.json"), encoding="utf-8"))["films"]
    todo = [f for f in films if not f.get("backdrop")]
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(THUMBS, exist_ok=True)
    index = {}
    with ThreadPoolExecutor(max_workers=10) as pool:
        for i, (ident, res) in enumerate(pool.map(process, todo)):
            if res:
                index[ident] = res
            if i % 50 == 0:
                print(f"  stills {i}/{len(todo)} (picked {len(index)})", file=sys.stderr)
    json.dump(index, open(os.path.join(OUT, "index.json"), "w", encoding="utf-8"), separators=(",", ":"))
    print(f"picked best scenes for {len(index)}/{len(todo)} films without backdrops", file=sys.stderr)


if __name__ == "__main__":
    main()
