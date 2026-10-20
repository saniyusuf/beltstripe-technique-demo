# Hi-res photogrammetry models

Rebuilt with Apple Object Capture (`objcap`, detail `.medium`, high feature sensitivity, sequential ordering) from **140 evenly spaced full-resolution (1152×768) frames** per pose, extracted from `orbit360/<move>-<step>.mp4`. The earlier `models/` were built from 48 small JPEGs and are left unchanged.

- `<move>-<step>.usdz`: one per pose (all 10 reconstructed)
- `double-leg-3-full.usdz`: the same pose at detail `.full`, for comparison. Its geometry and texture are effectively identical; it only adds displacement and roughness maps (17 MB vs 7 MB)
- `renders/<pose>-{front,side,back,left,top}.png`: multi-view renders
- `renders/compare-{double-leg,hip-throw}.png`: old (48 JPEG) vs new, side by side

The camera still orbits at a single height, so the tops and undersides of the figures remain under-constrained.
