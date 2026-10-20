import glob, os, trimesh
from trimesh.visual.material import PBRMaterial
for f in sorted(glob.glob('obj/*.obj')):
    sc = trimesh.load(f, force='scene', process=False)
    for g in sc.geometry.values():
        c = g.visual.material.diffuse  # RGBA 0-255 from the .mtl Kd
        g.visual = trimesh.visual.TextureVisuals(material=PBRMaterial(baseColorFactor=c, metallicFactor=0.0, roughnessFactor=0.75))
    out = f'glb/{os.path.basename(f)[:-4]}.glb'; sc.export(out)
    print(out, os.path.getsize(out)//1024, 'KB')
