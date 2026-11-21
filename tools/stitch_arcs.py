"""Stitch 8 anchored 45-degree Hedra arcs into one 360 spin of exactly 96 frames.

    python3 tools/stitch_arcs.py <arcs-dir> <pose> [out-root=frames-v2] [qa-dir=qa]

<arcs-dir>/<pose>/ holds arc_<az>_p.mp4 (still at az, camera +45) and arc_<az>_m.mp4
(still at az, camera -45) for az in 000/090/180/270. Frame k is at k*3.75 degrees. The first half
of each quarter comes from the + arc of the still before it, and the second half from the - arc of
the still after it, played backwards. So every frame is at most 45 degrees from a real still, and
frame 00 is the front still.
"""
import subprocess, sys, tempfile
from pathlib import Path
from PIL import Image, ImageDraw

ARCS_DIR, POSE = Path(sys.argv[1]), sys.argv[2]
OUT_ROOT = Path(sys.argv[3] if len(sys.argv) > 3 else "frames-v2")
QA_DIR = Path(sys.argv[4] if len(sys.argv) > 4 else "qa")
FRAME_COUNT, PER_QUARTER, HALF = 96, 24, 12
SIZE = (1152, 768)
STILL_AZ = [0, 90, 180, 270]


def decode(mp4):
    TMP = Path(tempfile.mkdtemp())
    subprocess.run(["ffmpeg", "-v", "error", "-i", str(mp4), "-q:v", "1", str(TMP / "%04d.jpg")], check=True)
    return sorted(TMP.glob("*.jpg"))


ARC_FRAMES = {}
for AZ in STILL_AZ:
    for SIGN in "pm":
        ARC_FRAMES[(AZ, SIGN)] = decode(ARCS_DIR / POSE / f"arc_{AZ:03d}_{SIGN}.mp4")


def pick(FRAMES, FRACTION):
    return FRAMES[min(len(FRAMES) - 1, round(FRACTION * (len(FRAMES) - 1)))]


OUT_DIR = OUT_ROOT / POSE
OUT_DIR.mkdir(parents=True, exist_ok=True)
OUTPUTS = []
for K in range(FRAME_COUNT):
    QUARTER, J = divmod(K, PER_QUARTER)
    if J < HALF:
        SRC = pick(ARC_FRAMES[(STILL_AZ[QUARTER], "p")], J / HALF)
    else:
        SRC = pick(ARC_FRAMES[(STILL_AZ[(QUARTER + 1) % 4], "m")], (PER_QUARTER - J) / HALF)
    IMG = Image.open(SRC).convert("RGB")
    if IMG.size != SIZE:
        IMG = IMG.resize(SIZE, Image.LANCZOS)
    DEST = OUT_DIR / f"{K:02d}.jpg"
    IMG.save(DEST, quality=90)
    OUTPUTS.append(DEST)

COLS, TILE_W = 4, 400
TILE_H = TILE_W * SIZE[1] // SIZE[0]
CELLS = OUTPUTS[::8]
ROWS = (len(CELLS) + COLS - 1) // COLS
SHEET = Image.new("RGB", (COLS * TILE_W, ROWS * TILE_H), (128, 128, 128))
DRAW = ImageDraw.Draw(SHEET)
for I, PATH in enumerate(CELLS):
    K = int(PATH.stem)
    X, Y = (I % COLS) * TILE_W, (I // COLS) * TILE_H
    SHEET.paste(Image.open(PATH).resize((TILE_W, TILE_H)), (X, Y))
    LABEL = f"#{K:02d}  {K * 360 / FRAME_COUNT:g} deg" + ("  (real still)" if K % PER_QUARTER == 0 else "")
    DRAW.rectangle([X, Y, X + 200, Y + 16], fill=(0, 0, 0))
    DRAW.text((X + 4, Y + 3), LABEL, fill=(255, 255, 0))
QA_DIR.mkdir(exist_ok=True)
SHEET.save(QA_DIR / f"regen-{POSE}.jpg", quality=85)
print(f"wrote {len(OUTPUTS)} frames to {OUT_DIR} and {QA_DIR}/regen-{POSE}.jpg")
