"""Finds where each catalog film's opening titles end and closing credits begin.

Two signals, best first:
  1. Captions (from build-quotes.py): first and last sustained dialogue — exact to the second.
  2. The Archive's scene thumbnails (one per minute): frames that look like title cards or credits
     (text on a plain dark or light ground) at the very start and end — accurate to about a minute.
Viewers' own skips refine these at runtime (crowd marks in D1).

Writes .cache/marks.json: {archive_id: {"ti": seconds, "tc": seconds, "src": "captions" | "frames"}}
Run after build-catalog.py and build-quotes.py: python scripts/build-marks.py
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
UA = {"User-Agent": "ArnavMoviesCatalog/3.0 (https://github.com/Arnav-Dugad/arnav-movies)"}
EDGE = 7  # thumbnails to inspect at each end (one per minute)


def fetch(url, binary=False):
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                data = r.read()
                return data if binary else json.loads(data)
        except Exception:
            time.sleep(1.5 * (attempt + 1))
    return None


def metadata(ident):
    url = "https://archive.org/metadata/" + urllib.parse.quote(ident)
    p = os.path.join(CACHE, hashlib.sha1(url.encode()).hexdigest() + ".json")
    if os.path.exists(p):
        return json.load(open(p, encoding="utf-8"))
    d = fetch(url)
    if d:
        json.dump(d, open(p, "w", encoding="utf-8"))
    return d


def thumb(ident, name):
    p = os.path.join(THUMBS, hashlib.sha1((ident + name).encode()).hexdigest() + ".jpg")
    if os.path.exists(p):
        return open(p, "rb").read()
    data = fetch(f"https://archive.org/download/{urllib.parse.quote(ident)}/{urllib.parse.quote(name)}", binary=True)
    if data:
        open(p, "wb").write(data)
    return data


def kind(data):
    """'title' for text on a plain ground (titles, credits, intertitles), 'black', or 'scene'."""
    try:
        g = Image.open(io.BytesIO(data)).convert("L").resize((160, 120))
    except Exception:
        return None
    hist = g.histogram()
    total = sum(hist)
    dark = sum(hist[:45]) / total
    light = sum(hist[210:]) / total
    mid = 1 - dark - light
    edges = ImageStat.Stat(g.filter(ImageFilter.FIND_EDGES)).mean[0]
    if dark > 0.93 and light < 0.01:
        return "black"
    # Text cards: mostly one flat tone, a little of the opposite tone, few mid-greys, crisp edges.
    if (dark > 0.55 and 0.008 < light < 0.3 and mid < 0.35) or (light > 0.55 and 0.008 < dark < 0.3 and mid < 0.35):
        return "title" if edges > 6 else "black"
    return "scene"


def frames_marks(film):
    meta = metadata(film["id"])
    if not meta:
        return None
    thumbs = sorted((int(m.group(1)), f["name"]) for f in meta.get("files", []) if (m := re.search(r"\.thumbs/.+_(\d{6})\.jpg$", f["name"], re.I)))
    if len(thumbs) < 6:
        return None
    head, tail = thumbs[:EDGE], thumbs[-EDGE:]
    head_k = [(t, kind(thumb(film["id"], n) or b"")) for t, n in head]
    tail_k = [(t, kind(thumb(film["id"], n) or b"")) for t, n in tail]
    out = {}
    # Opening: leading run of title/black frames, then a scene.
    run = 0
    while run < len(head_k) and head_k[run][1] in ("title", "black"):
        run += 1
    if 0 < run < len(head_k) and any(k == "title" for _, k in head_k[:run]):
        out["ti"] = round((head_k[run - 1][0] + head_k[run][0]) / 2)
    # Closing: trailing run of title/black frames after the last scene.
    i = len(tail_k) - 1
    while i >= 0 and tail_k[i][1] in ("title", "black"):
        i -= 1
    if i < len(tail_k) - 1 and any(k == "title" for _, k in tail_k[i + 1:]):
        out["tc"] = tail_k[i + 1][0]
    if out:
        out["src"] = "frames"
    return out or None


def main():
    films = json.load(open(os.path.join(ROOT, ".cache", "catalog-full.json"), encoding="utf-8"))["films"]
    caps_path = os.path.join(ROOT, ".cache", "captions-marks.json")
    caps = json.load(open(caps_path)) if os.path.exists(caps_path) else {}
    os.makedirs(THUMBS, exist_ok=True)
    marks = {}
    todo = []
    for f in films:
        if f["id"] in caps:
            first, last = caps[f["id"]]
            length = f.get("len") or 0
            m = {"src": "captions"}
            if first > 20:
                m["ti"] = round(max(0, first - 1.5), 1)
            if length and length - last > 25:
                m["tc"] = round(last + 2, 1)
            if len(m) > 1:
                marks[f["id"]] = m
        else:
            todo.append(f)
    print(f"caption marks: {len(marks)}; scanning frames for {len(todo)} films", file=sys.stderr)
    with ThreadPoolExecutor(max_workers=10) as pool:
        for i, (f, m) in enumerate(zip(todo, pool.map(frames_marks, todo))):
            if m:
                marks[f["id"]] = m
            if i % 100 == 0:
                print(f"  frames {i}/{len(todo)} (marked {len(marks)})", file=sys.stderr)
    json.dump(marks, open(os.path.join(ROOT, ".cache", "marks.json"), "w"), separators=(",", ":"))
    n_ti = sum(1 for m in marks.values() if "ti" in m)
    n_tc = sum(1 for m in marks.values() if "tc" in m)
    print(f"marks for {len(marks)} films: {n_ti} openings, {n_tc} closing credits", file=sys.stderr)


if __name__ == "__main__":
    main()
