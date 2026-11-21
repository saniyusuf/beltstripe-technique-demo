"""Clean Apple Vision pose output for the viewer's Coach view.

Reads pose-raw/<pose>.json (from tools/vision_cutouts.swift) and the cut-outs, writes pose/<pose>.json:
- drops joints below MIN_CONF or outside the fighters' cut-out
- drops fragment skeletons with too few joints
- gives each fighter a stable id (0 = left fighter on the front view) by tracking out from frame 0
- smooths each joint over neighbouring frames and fills short gaps
Run from the repo root: python3 tools/clean_pose.py   (needs opencv-python and numpy)
"""
import json, glob, os, sys
import numpy as np
import cv2

N = 96
MIN_CONF = 0.25
MIN_JOINTS = 6
JOINTS = ["nose", "neck", "left_shoulder", "right_shoulder", "left_elbow", "right_elbow", "left_wrist", "right_wrist",
          "root", "left_hip", "right_hip", "left_knee", "right_knee", "left_ankle", "right_ankle"]


def alpha(pid, i):
    im = cv2.imread(f"cutouts/{pid}/{i:02d}.webp", cv2.IMREAD_UNCHANGED)
    if im is None or im.shape[2] < 4:
        return None
    a = im[:, :, 3]
    return cv2.dilate(a, np.ones((25, 25), np.uint8))  # allow joints a little outside the silhouette


def centroid(p):
    pts = np.array([v[:2] for v in p.values()])
    return pts.mean(0)


def clean(pid):
    raw = json.load(open(f"pose-raw/{pid}.json"))
    W, H = raw["w"], raw["h"]
    frames = []
    for i in range(N):
        a = alpha(pid, i)
        people = []
        for person in raw["frames"][i]:
            j = {}
            for k in JOINTS:
                v = person["joints"].get(k)
                if not v or v[2] < MIN_CONF:
                    continue
                x, y = int(round(v[0])), int(round(v[1]))
                if not (0 <= x < W and 0 <= y < H):
                    continue
                if a is not None and a[y, x] < 64:
                    continue
                j[k] = v
            if len(j) >= MIN_JOINTS:
                people.append(j)
        # keep the two biggest skeletons
        people.sort(key=lambda p: -len(p))
        frames.append(people[:2])

    # track ids out from the front frame
    ids = [None] * N
    f0 = sorted(frames[0], key=lambda p: centroid(p)[0])
    ids[0] = list(range(len(f0)))
    frames[0] = f0
    last = {k: centroid(p) for k, p in enumerate(f0)}

    def walk(order):
        nonlocal last
        prev = dict(last)
        for i in order:
            assigned, used = [], set()
            pairs = sorted(((np.linalg.norm(centroid(p) - c), pi, tid) for pi, p in enumerate(frames[i]) for tid, c in prev.items()))
            out = {}
            for d, pi, tid in pairs:
                if pi in out or tid in used:
                    continue
                out[pi] = tid; used.add(tid)
            for pi in range(len(frames[i])):
                if pi not in out:
                    free = [t for t in (0, 1) if t not in used]
                    out[pi] = free[0] if free else 0; used.add(out[pi])
            ids[i] = [out[pi] for pi in range(len(frames[i]))]
            for pi, p in enumerate(frames[i]):
                prev[ids[i][pi]] = centroid(p)

    walk(range(1, N // 2 + 1))
    walk(range(N - 1, N // 2, -1))

    # per track, per joint time series -> median smooth over +-2 frames, fill gaps up to 2
    series = {t: {k: [None] * N for k in JOINTS} for t in (0, 1)}
    for i in range(N):
        for p, t in zip(frames[i], ids[i] or []):
            for k, v in p.items():
                series[t][k][i] = v
    out_frames = [[] for _ in range(N)]
    for t in (0, 1):
        for k in JOINTS:
            s = series[t][k]
            sm = [None] * N
            for i in range(N):
                win = [s[(i + d) % N] for d in (-2, -1, 0, 1, 2) if s[(i + d) % N] is not None]
                if s[i] is None:
                    # fill a short gap only when both sides have data
                    if not (s[(i - 1) % N] or s[(i - 2) % N]) or not (s[(i + 1) % N] or s[(i + 2) % N]):
                        continue
                if len(win) >= 2 or (s[i] is not None):
                    arr = np.array(win)
                    sm[i] = [round(float(np.median(arr[:, 0])), 1), round(float(np.median(arr[:, 1])), 1),
                             round(float(arr[:, 2].mean()), 3)]
            series[t][k] = sm
        for i in range(N):
            j = {k: series[t][k][i] for k in JOINTS if series[t][k][i] is not None}
            if len(j) >= MIN_JOINTS:
                out_frames[i].append({"id": t, "joints": j})
    os.makedirs("pose", exist_ok=True)
    json.dump({"w": W, "h": H, "tracked": True, "frames": out_frames}, open(f"pose/{pid}.json", "w"), separators=(",", ":"))
    two = sum(1 for f in out_frames if len(f) == 2)
    return two


for f in sorted(glob.glob("pose-raw/*.json")):
    pid = os.path.basename(f)[:-5]
    print(pid, "frames with both fighters:", clean(pid))
