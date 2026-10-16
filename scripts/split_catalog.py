"""Splits the full catalog into a lean index (public/data/catalog.json) and per-film detail
files (public/data/f/<slug>.json), so the first page load stays small on phones.

Run after build-catalog.py (it calls this automatically): python scripts/split_catalog.py
"""
import json
import os
import re
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FULL = os.path.join(ROOT, ".cache", "catalog-full.json")
OUT = os.path.join(ROOT, "public", "data")


def slug(ident):
    return re.sub(r"[^A-Za-z0-9_-]", "_", ident)


def blurb(text, limit=260):
    text = (text or "").strip()
    if len(text) <= limit:
        return text
    cut = text[:limit]
    end = max(cut.rfind(". "), cut.rfind("! "), cut.rfind("? "))
    return cut[: end + 1] if end > 120 else cut.rsplit(" ", 1)[0] + "…"


def split():
    src = FULL if os.path.exists(FULL) else os.path.join(OUT, "catalog.json")
    with open(src, encoding="utf-8") as fh:
        full = json.load(fh)
    if src != FULL:
        os.makedirs(os.path.dirname(FULL), exist_ok=True)
        shutil.copyfile(src, FULL)

    # Best-scene stills picked by scripts/build-stills.py (card art for films without a TMDB backdrop).
    stills_path = os.path.join(OUT, "stills", "index.json")
    stills = json.load(open(stills_path, encoding="utf-8")) if os.path.exists(stills_path) else {}

    shard_dir = os.path.join(OUT, "f")
    shutil.rmtree(shard_dir, ignore_errors=True)
    os.makedirs(shard_dir)
    lean, seen, features = [], set(), 0
    for f in full["films"]:
        s = slug(f["id"])
        while s in seen:
            s += "_"
        seen.add(s)
        # Only films that can headline the home hero need a blurb in the index; the rest load it with their page.
        hero = "short" not in f.get("tags", []) and features < 200
        features += hero
        entry = {
            "id": f["id"], "file": f["file"], "pv": f.get("pv"), "len": f.get("len"),
            "title": f["title"], "year": f.get("year"), "blurb": blurb(f.get("overview")) if hero else "",
            "poster": f.get("poster"), "backdrop": f.get("backdrop"), "logo": f.get("logo"), "trailer": f.get("trailer"),
            "genres": f.get("genres", [])[:3], "tags": f.get("tags", []), "runtime": f.get("runtime"),
            "director": f.get("director", []),
            "cast": [{"n": c["n"], **({"q": c["q"]} if c.get("q") else {})} for c in f.get("cast", [])[:4]],
            "rating": f.get("rating", {}), "votes": f.get("votes", 0), "imdb": f.get("imdb"), "tmdb": f.get("tmdb"),
            "still": stills.get(f["id"], {}).get("best"),
            "stlo": 1 if stills.get(f["id"], {}).get("lo") else None,  # only a low-res frame exists
        }
        if s != slug(f["id"]):
            entry["s"] = s  # only stored on a collision; the client derives the slug otherwise
        lean.append({k: v for k, v in entry.items() if v not in (None, "", [], {})})
        with open(os.path.join(shard_dir, s + ".json"), "w", encoding="utf-8") as fh:
            detail = {k: f.get(k) for k in ("overview", "tagline", "cast", "country", "language", "wiki", "qid", "rel", "backdrops")}
            detail["stills"] = stills.get(f["id"], {}).get("kb", [])
            json.dump({k: v for k, v in detail.items() if v not in (None, "", [], {})}, fh, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(OUT, "catalog.json"), "w", encoding="utf-8") as fh:
        json.dump({"generated": full.get("generated"), "films": lean}, fh, ensure_ascii=False, separators=(",", ":"))
    size = os.path.getsize(os.path.join(OUT, "catalog.json"))
    print(f"lean catalog: {len(lean)} films, {size / 1024:.0f} KB; {len(lean)} detail shards", file=sys.stderr)


if __name__ == "__main__":
    split()
