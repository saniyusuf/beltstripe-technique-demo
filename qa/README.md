# Cut-out and pose QA

Made on-device with Apple Vision by `tools/vision_cutouts.swift` (no paid APIs). Run it from the repo root:

```
brew install webp   # for cwebp
swift tools/vision_cutouts.swift            # all poses in frames/
swift tools/vision_cutouts.swift frames double-leg-3   # one pose
```

## Outputs
| Path | What |
|---|---|
| `cutouts/<move>-<step>/NN.webp` | 1152x768, fighters only, transparent background (cwebp `-q 82 -alpha_q 90`). 960 files, about 39 MB in all |
| `pose/<move>-<step>.json` | `{"w":1152,"h":768,"frames":[[{"joints":{"nose":[x,y,c],...}}, ...people], ...96 frames]}`. Pixels, top-left origin. Joints with confidence below 0.1 are left out |
| `qa/<move>-<step>.jpg` | Every 8th frame on mid-grey with skeletons. Only joints at confidence 0.3 or more are drawn |
| `qa/stats/<move>-<step>.json` | Per frame: person instances, skeletons found, mask coverage (share of the frame) |

## How the mask is built
1. `VNGeneratePersonInstanceMaskRequest`, with all instances merged into one mask.
2. Combined (per-pixel max) with `VNGeneratePersonSegmentationRequest` (`.accurate`). On its own, the instance model sometimes dropped most of one fighter where the two overlap, e.g. double-leg-3 #50 kept only the top fighter's head and double-leg-4 #57 lost his torso. The combined mask fixes every case found.
3. Hardened with a contrast curve around 0.5, because Vision's mask is soft and fighters came out partly see-through. Then the edge is feathered by about 1px (Gaussian sigma 0.8).

`people(mask)=1` on the sheets is **not** a failure. Vision often treats two fighters in a clinch as one instance, and the union mask still keeps both.

## Mask check (all 960 frames)
I looked for single-frame drops in mask coverage, which is how a missing or half-cut fighter shows up, and then checked each flagged frame by eye.

- **No frame has a fighter missing or cut in half** after the fix, in every pose, including the overlap-heavy double-leg-3/4 and hip-throw-2/3/4.
- **Where one fighter is hidden behind the other** (about frames 20-28 and 68-76 in most poses, where the camera lines up with both bodies), only the front fighter is visible. That is real occlusion in the source frames, not a mask fault.
- **Small leftovers from the background:** parts of the hanging punching bag in hip-throw-4 and double-leg-2 (seen at sampled frames #40-#56 in both), and a faint grey ghost near the fighters in double-leg-2 #48 and hip-throw-4 #64. The bag and ghosts are things the video model invented in the back views.
- **Soft or ghosted limbs** in the back views (about frames 30-70) come from the source video's blur, not from the mask.
- **Fighter cut off by the frame edge:** the fighter lying down runs off the frame edge in hip-throw-5 #16-#24 and double-leg-5 #24. That is how the source frames are framed.

## Pose check
Body pose is much weaker than the masks where the fighters overlap. Treat it as a rough guide:
- **Person order is not stable.** `people[0]` is not always the same fighter from one frame to the next, so match people across frames by position.
- **Missed second skeleton** (only one found) in 4-29 frames per pose, mostly where one fighter is hidden. Worst: hip-throw-2 (29), double-leg-5 (23, the fighter on the ground) and hip-throw-5 (21).
- **No skeleton at all:** hip-throw-4 #25, #26 and #28.
- **Extra or broken skeletons** (3 or 4 people) in 0-21 frames per pose, worst in hip-throw-4 (21) and hip-throw-3 (18). These are fragments built from both fighters' limbs.
- **Stray wrist/elbow joints** placed far out in empty space at moderate confidence (often 0.3-0.5), e.g. hip-throw-1/2/3 around #56-#72 and double-leg-4 #48-#56. Filter by confidence and by whether the joint falls inside the cut-out's alpha.
