#!/usr/bin/env python3
"""Add animation clips and voice lists to each character's meta.json.

Inputs are the sheet.png files and the raw meta.json produced by
extract-el.py. Voice files are expected at assets/characters/<id>/voices/*.mp3.
Run: python3 scripts/build-meta.py
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHAR_DIR = ROOT / "assets" / "characters"

# Row layout shared by every sheet:
#   row 0: reaction / strumming     row 1: sleepy
#   row 2: being held / upside down row 3: idle variant
#   row 4: main idle                row 5: extra idle
CLIP_ROWS = {
    "react": 0,
    "sleep": 1,
    "held": 2,
    "idleAlt": 3,
    "idle": 4,
    "extra": 5,
}

NAMES = {
    "yui": "平泽唯",
    "mio": "秋山澪",
    "ritsu": "田井中律",
    "tsumugi": "琴吹䌷",
    "azusa": "中野梓",
}


def valid(frame):
    """Skip the near-empty transition cells that only hold a sliver."""
    box = frame.get("bbox")
    if not box:
        return False
    w, h = box[2] - box[0], box[3] - box[1]
    return w >= 20 and h >= 40


def voice_key(name):
    m = re.search(r"(\d+)$", name)
    return (int(m.group(1)) if m else 999, name)


def build(char_id: str) -> None:
    meta_path = CHAR_DIR / char_id / "meta.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    cols = meta["sheet"]["columns"]
    frames = {cell["index"]: cell for cell in meta["cells"]}

    clips = {}
    for clip, row in CLIP_ROWS.items():
        picked = [
            index
            for index, cell in sorted(frames.items())
            if index // cols == row and valid(cell)
        ]
        clips[clip] = picked
    if not clips["idle"]:
        clips["idle"] = clips["idleAlt"] or clips["react"] or [0]
    # 律的 row2 是“双手交握站着”的动作，不像被抓起；row0 的慌张举手
    # 更接近抓取反馈。其他角色仍用 row2。
    if char_id == "ritsu":
        clips["held"] = clips["react"]
    for clip, picked in clips.items():
        if not picked:
            clips[clip] = clips["idle"]

    voice_dir = CHAR_DIR / char_id / "voices"
    voices = sorted(
        (p.name for p in voice_dir.glob("*.mp3")),
        key=voice_key,
    )

    meta["id"] = char_id
    meta["name"] = NAMES.get(char_id, char_id)
    meta["clips"] = clips
    meta["voices"] = voices
    meta_path.write_text(
        json.dumps(meta, ensure_ascii=False, indent=1) + "\n",
        encoding="utf-8",
    )
    print(f"{char_id}: " + ", ".join(f"{k}={len(v)}" for k, v in clips.items()) + f", voices={len(voices)}")


def main() -> None:
    for char_dir in sorted(CHAR_DIR.iterdir()):
        if char_dir.is_dir() and (char_dir / "meta.json").exists():
            build(char_dir.name)


if __name__ == "__main__":
    main()
