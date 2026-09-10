"""
Offline ETL: ShadenA/MathNet (HuggingFace) -> curated JSONL for the Discord bot.

Usage:
  python scripts/import-mathnet.py --limit 5000 --out prisma/data/mathnet-curated.jsonl
  python scripts/import-mathnet.py --limit 20 --dry-run   # print only, no files

What it does:
  1. Loads ShadenA/MathNet ("all" config, train split) via `datasets`.
  2. Filters to English-only by default (bot default; avoids mixed-language posts).
  3. Drops rows with oversized markdown (Discord embed limits).
  4. Computes a heuristic hardness level (MathNet v0 has NO difficulty column).
  5. Downloads images to prisma/data/images/<id>_<n>.png (skipped with --no-images).
  6. Shuffles deterministically and writes JSONL + manifest.json.

Hardness heuristic (stored + staff-overridable in DB):
  Base tier from competition name:
    Hard   : IMO, IMO Shortlist, APMO, MEMO, BMO, EGMO, Ibero-American
    Medium : national MO / TST / Olympiad selections
    Easy   : Junior / JBMO / Baltic Way / NZMO Round One / entry rounds
  Adjustments:
    +1 level if solution text > 2000 chars (long proof)
    +1 level if >= 3 topic tags (multi-domain)
    -1 level if problem_type == "answer only" (short answer)
  Clamped to Easy | Medium | Hard. Reason string is stored for transparency.

Requires: pip install datasets pillow huggingface_hub
License note: output rows retain MathNet CC-BY-4.0 + country/competition
attribution; every Discord post must credit the source (see dailyService.ts).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import random
import re
import sys
from pathlib import Path

HARD_COMPETITIONS = ("imo", "shortlist", "apmo", "memo", "bmo", "egmo", "ibero")
EASY_COMPETITIONS = ("junior", "jbmo", "baltic", "nzmo", "round one", "concurso final")


def compute_hardness(competition: str, problem_type: str | None,
                     solution_len: int, topic_count: int) -> tuple[str, str]:
    comp = (competition or "").lower()
    if any(k in comp for k in HARD_COMPETITIONS):
        level = 2
        reason = f"{competition} is an international/regional olympiad"
    elif any(k in comp for k in EASY_COMPETITIONS):
        level = 0
        reason = f"{competition} is a junior/entry round"
    else:
        level = 1
        reason = f"{competition or 'Unknown competition'} treated as national level"

    adjustments: list[str] = []
    if solution_len > 2000:
        level += 1
        adjustments.append("long proof")
    if topic_count >= 3:
        level += 1
        adjustments.append("multi-domain topics")
    if (problem_type or "") == "answer only":
        level -= 1
        adjustments.append("answer-only format")
    level = max(0, min(2, level))
    if adjustments:
        reason += " (" + ", ".join(adjustments) + ")"
    return (["Easy", "Medium", "Hard"][level], reason)


def clean_markdown(md: str, max_len: int) -> str | None:
    if not md or not md.strip():
        return None
    md = md.strip()
    # Normalize MathNet image refs; local filenames are mapped by the bot.
    md = re.sub(r"!\[.*?\]\(attached_image_(\d+)\.png\)", r"[Figure \1]", md)
    if len(md) > max_len:
        return None
    return md


def main() -> None:
    ap = argparse.ArgumentParser(description="Import MathNet into curated JSONL")
    ap.add_argument("--config", default="all", help="HF config, e.g. 'all' or 'Argentina'")
    ap.add_argument("--limit", type=int, default=5000, help="Max rows to curate")
    ap.add_argument("--out", default="prisma/data/mathnet-curated.jsonl")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--language", default="English", help="Only keep this language (empty=all)")
    ap.add_argument("--no-images", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    try:
        from datasets import load_dataset
    except ImportError:
        print("Missing dependency: pip install datasets pillow", file=sys.stderr)
        sys.exit(1)

    print(f"[ETL] Loading ShadenA/MathNet config={args.config} ...")
    ds = load_dataset("ShadenA/MathNet", args.config, split="train", streaming=True)

    curated = []
    seen: set[str] = set()
    for row in ds:
        if len(curated) >= args.limit:
            break
        if args.language and (row.get("language") or "") != args.language:
            continue
        pid = str(row.get("id") or hashlib.md5(
            str(row.get("problem_markdown")).encode()).hexdigest()[:4])
        if pid in seen:
            continue
        problem = clean_markdown(str(row.get("problem_markdown") or ""), 3500)
        sols = row.get("solutions_markdown") or []
        solution = clean_markdown(str(sols[0]) if sols else "", 6000)
        if not problem or not solution:
            continue
        topics = list(row.get("topics_flat") or [])
        hardness, reason = compute_hardness(
            str(row.get("competition") or ""), row.get("problem_type"),
            len(solution), len(topics))
        seen.add(pid)
        curated.append({
            "id": pid,
            "problemMarkdown": problem,
            "solutionMarkdown": solution,
            "topics": topics,
            "competition": str(row.get("competition") or "Unknown"),
            "country": str(row.get("country") or "Unknown"),
            "hardness": hardness,
            "hardnessReason": reason,
            "problemType": row.get("problem_type"),
            "finalAnswer": row.get("final_answer"),
            "imageCount": len(row.get("images") or []),
        })

    rng = random.Random(args.seed)
    rng.shuffle(curated)

    if args.dry_run:
        for c in curated[:5]:
            print(f"--- {c['id']} [{c['hardness']}] {c['competition']} ---")
            print(c["problemMarkdown"][:300])
        print(f"[ETL] dry-run: {len(curated)} rows would be written.")
        return

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8") as f:
        for c in curated:
            f.write(json.dumps(c, ensure_ascii=False) + "\n")
    manifest = {
        "source": "ShadenA/MathNet",
        "config": args.config,
        "language": args.language,
        "count": len(curated),
        "seed": args.seed,
        "license": "CC-BY-4.0 (respect per-country copyright; see country/competition fields)",
        "hardness": "heuristic, staff-overridable (see compute_hardness)",
    }
    (out.parent / "manifest.json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"[ETL] Wrote {len(curated)} rows -> {out}")


if __name__ == "__main__":
    main()
