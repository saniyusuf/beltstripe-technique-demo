# 3D technique models from real video (SAM 3D Body)

Both people in each step are reconstructed as full 3D bodies from ordinary instructional video, using Meta's SAM 3D Body (SAM License, which allows commercial use) and its MHR body model. This replaces the photogrammetry of AI-generated orbit videos.

- `glb/` (web/Android) and `usdz/` (iPhone AR Quick Look): 5 steps per technique, blue = attacker, white = partner. Real-world scale, standing on the floor.
- `overlays/`: the 3D bodies projected back onto the source frame, for checking accuracy.
- `renders/sheet-*.jpg`: source frame plus 5 views per step.
- `tools/`: key-frame boxes (`keys.json`), inference (`run_s3db.py`), export (`export.py`, `obj2glb.py`, `obj2usdz.swift`).
- Viewer: `ar-real/index.html`.

Sources (internal test only; get permission or use our own footage before shipping):
- Double leg: Gracie Barra Jiu-jitsu, "Double Leg Takedown | BJJ FUNDAMENTALS…", youtube.com/watch?v=IfDaAG6Fo0s, 12–23 s
- Clinch hip throw: Gracie Barra HQ, "Clinch to Hip Throw + Variation", youtube.com/watch?v=zv-arRTeudM, 33–42.5 s

Limits: depth between the two people comes from a single camera, so it's estimated. Hands at the grips and body parts hidden behind the partner are inferred. The hip-throw camera assumes a level camera.
