"""Themes and text similarity for the curated catalog.

Reads each film's Wikipedia plot, its TMDB overview and tagline, and (where the Archive item ships
captions) its dialogue. From these it builds TF-IDF vectors, and writes:

  public/data/text.json   {"n", "first", "nb": [[i, sim, i, sim, ...]], "th": [[theme, ...]]}
                          nearest neighbours by plot/dialogue and 6 shared themes per film
  public/data/plots.json  {"n", "first", "kw": ["word word ..."]}
                          plot keywords for "the one where…" search (loaded only by search)

Both are aligned with the film order in public/data/catalog.json, so run this after split_catalog.py.
"""
import hashlib
import json
import math
import os
import re
import urllib.parse
import time
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, ".cache", "http")
SRT = os.path.join(ROOT, ".cache", "srt")
DATA = os.path.join(ROOT, "public", "data")
UA = {"User-Agent": "ArnavMoviesCatalog/3.0 (https://github.com/Arnav-Dugad/arnav-movies)"}
os.makedirs(CACHE, exist_ok=True)

STOP = set("""
a about above after again against all almost alone along already also although always am among an and another any anyone anything are
around as at away back be became because become becomes been before began begin begins behind being below best better between both
but by came can cannot could did do does doing done down during each either else end ends enough even ever every everyone everything
few find finds first for found from further get gets getting give given gives go goes going gone got had has have having he her here
hers herself him himself his how however i if in into is it its itself just keep keeps know known last later least leave leaves left
less let lets like little long made make makes making many may me meanwhile might more most much must my myself near nearly never new
next no none nor not nothing now of off often on once one only onto or other others otherwise our out over own part per perhaps put
puts quite rather really s said same say says see seems seen several she should since so some someone something soon still such take
takes taken than that the their theirs them themselves then there these they thing things this those though through throughout thus
to together too took toward towards try tries trying two under until up upon us use used very via was way we well went were what
whatever when where whether which while who whom whose why will with within without would yet you your yours yourself
oh yeah yes okay ok hey hello gonna wanna gotta uh um ah mr mrs miss sir ma'am don't can't won't it's i'm you're he's she's that's
there's what's let's i'll you'll we'll i've you've we're they're didn't doesn't isn't wasn't aren't couldn't wouldn't shouldn't
come comes coming look looks looking tell tells told want wants think thinks thought right good well time times day days year years
man men woman women people way ll ve re don didn doesn isn wasn aren couldn wouldn shouldn
film films movie movies directed director starring stars star cast plot story released release produced production picture pictures
character characters role roles scene scenes version original american british remake sequel based novel play screenplay written
also later eventually finally begins tries realizes decides arrives returns meets tells asks takes gets goes leaves becomes
maybe sure thank thanks mean guess sorry please kind lot bit honey darling baby dear mister sweetheart anyway whole okay alright right gonna wanna hmm huh hey listen wait look sure fine nice great tonight tomorrow yesterday today
""".split())

WORD = re.compile(r"[A-Za-z][A-Za-z']{2,}")
SECTION = re.compile(r"\n==\s*([^=\n]+?)\s*==\n")
PLOT_HEADS = ("plot", "synopsis", "story", "premise", "summary", "plot summary", "storyline")
TIME = re.compile(r"^\d+$|-->")


def fetch_json(url):
    p = os.path.join(CACHE, hashlib.sha1(url.encode()).hexdigest() + ".json")
    if os.path.exists(p):
        try:
            return json.load(open(p, encoding="utf-8"))
        except Exception:
            pass
    for attempt in range(4):
        if attempt:
            time.sleep(3 * attempt)  # Wikipedia answers bursts with 429s
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r:
                d = json.loads(r.read().decode("utf-8"))
            json.dump(d, open(p, "w", encoding="utf-8"))
            return d
        except Exception:
            continue
    return None


def wiki_plot(film):
    url = film.get("wiki") or ""
    if "/wiki/" not in url:
        return ""
    page = urllib.parse.unquote(url.split("/wiki/", 1)[1])
    d = fetch_json("https://en.wikipedia.org/w/api.php?" + urllib.parse.urlencode(
        {"action": "query", "prop": "extracts", "explaintext": 1, "exsectionformat": "wiki", "redirects": 1, "format": "json", "titles": page}))
    pages = ((d or {}).get("query") or {}).get("pages") or {}
    text = next(iter(pages.values()), {}).get("extract") or ""
    parts = SECTION.split("\n" + text)
    # parts = [intro, head1, body1, head2, body2, ...]
    for i in range(1, len(parts) - 1, 2):
        if parts[i].strip().lower() in PLOT_HEADS:
            return parts[i + 1][:12000]
    return parts[0][:2500] if parts else ""


def captions(film):
    meta = fetch_json("https://archive.org/metadata/" + urllib.parse.quote(film["id"]))
    srts = sorted([f["name"] for f in (meta or {}).get("files", []) if f["name"].lower().endswith(".srt")], key=lambda n: ("512kb" in n.lower(), len(n)))
    if not srts:
        return ""
    path = os.path.join(SRT, hashlib.sha1((film["id"] + srts[0]).encode()).hexdigest() + ".srt")
    if not os.path.exists(path):
        return ""
    lines = open(path, encoding="utf-8", errors="replace").read().splitlines()
    return " ".join(l for l in lines if l.strip() and not TIME.search(l))


def main():
    full = {f["id"]: f for f in json.load(open(os.path.join(ROOT, ".cache", "catalog-full.json"), encoding="utf-8"))["films"]}
    order = [f["id"] for f in json.load(open(os.path.join(DATA, "catalog.json"), encoding="utf-8"))["films"]]
    films = [full[i] for i in order]
    has_caps = set(json.load(open(os.path.join(ROOT, ".cache", "captions-marks.json"))))
    print(f"{len(films)} films; fetching Wikipedia plots…")
    with ThreadPoolExecutor(max_workers=2) as pool:
        plots = list(pool.map(wiki_plot, films))
        dialogue = list(pool.map(lambda f: captions(f) if f["id"] in has_caps else "", films))
    print(f"  plots: {sum(1 for p in plots if len(p) > 200)} · dialogue: {sum(1 for d in dialogue if d)}")

    # Character names: words that are almost always capitalised mid-sentence and belong to few films.
    caps, low, film_df = Counter(), Counter(), Counter()
    raw_docs = []
    for f, plot, dia in zip(films, plots, dialogue):
        parts = [(plot, 1.0), ((f.get("overview") or "") + " " + (f.get("tagline") or ""), 2.0), (dia[:60000], 0.25)]
        raw_docs.append(parts)
        seen = set()
        for text, _ in parts:
            for m in WORD.finditer(text):
                w = m.group(0)
                lw = w.lower().strip("'")
                start = m.start()
                prev = text[max(0, start - 2):start]
                sentence_start = start == 0 or re.search(r"[.!?\"]\s*$", prev)
                if w[0].isupper() and not sentence_start:
                    caps[lw] += 1
                elif w[0].islower():
                    low[lw] += 1
                seen.add(lw)
        film_df.update(seen)
    # Proper nouns: kept out of the vectors when they're specific (character names), and never shown as themes.
    proper = {w for w in caps if caps[w] >= 0.75 * (caps[w] + low[w])}
    names = {w for w in proper if film_df[w] <= 12}

    vocab_seen = set(film_df)

    def norm(w):
        w = w.lower().strip("'")
        if w.endswith("'s"):
            w = w[:-2]
        if len(w) > 4 and w.endswith("ies") and w[:-3] + "y" in vocab_seen:
            return w[:-3] + "y"
        if len(w) > 3 and w.endswith("s") and not w.endswith("ss") and w[:-1] in vocab_seen:
            return w[:-1]
        return w

    counts = []
    for parts in raw_docs:
        c = Counter()
        for text, weight in parts:
            for m in WORD.finditer(text):
                lw = m.group(0).lower().strip("'")
                if lw in STOP or lw in names or len(lw) < 3:
                    continue
                w = norm(lw)
                if w in STOP:
                    continue
                c[w] += weight
        counts.append(c)

    n = len(films)
    df = Counter()
    for c in counts:
        df.update(c.keys())
    vocab = sorted(w for w, k in df.items() if 2 <= k <= 0.22 * n)
    index = {w: i for i, w in enumerate(vocab)}
    idf = np.array([math.log(n / df[w]) for w in vocab], dtype=np.float32)
    X = np.zeros((n, len(vocab)), dtype=np.float32)
    for r, c in enumerate(counts):
        for w, tf in c.items():
            j = index.get(w)
            if j is not None:
                X[r, j] = (1 + math.log(tf)) * idf[j] if tf >= 1 else tf * idf[j]
    lens = np.linalg.norm(X, axis=1, keepdims=True)
    X /= np.maximum(lens, 1e-6)
    S = X @ X.T
    np.fill_diagonal(S, 0)

    nb, th, kw = [], [], []
    for r in range(n):
        top = np.argsort(-S[r])[:12]
        pairs = []
        for j in top:
            if S[r, j] < 0.07:
                break
            pairs += [int(j), int(round(float(S[r, j]) * 100))]
        nb.append(pairs)
        weights = X[r]
        order = np.argsort(-weights)
        themes, words = [], []
        for j in order[:80]:
            if weights[j] <= 0:
                break
            w = vocab[j]
            words.append(w)
            if len(themes) < 6 and df[w] >= 3 and len(w) >= 4 and w not in proper:
                themes.append(w)
        th.append(themes)
        kw.append(" ".join(words[:36]))

    meta = {"n": n, "first": order[0] if (order := [f["id"] for f in films]) else ""}
    json.dump({**meta, "nb": nb, "th": th}, open(os.path.join(DATA, "text.json"), "w", encoding="utf-8"), separators=(",", ":"), ensure_ascii=False)
    json.dump({**meta, "kw": kw}, open(os.path.join(DATA, "plots.json"), "w", encoding="utf-8"), separators=(",", ":"), ensure_ascii=False)
    sizes = [os.path.getsize(os.path.join(DATA, x)) // 1024 for x in ("text.json", "plots.json")]
    print(f"vocab {len(vocab)} · text.json {sizes[0]} KB · plots.json {sizes[1]} KB")
    for probe in ("Night of the Living Dead", "His Girl Friday", "Nosferatu"):
        i = next((k for k, f in enumerate(films) if f["title"] == probe), None)
        if i is not None:
            print(f"  {probe}: themes={th[i]} -> {[films[j]['title'] for j in nb[i][::2][:5]]}")


if __name__ == "__main__":
    main()
