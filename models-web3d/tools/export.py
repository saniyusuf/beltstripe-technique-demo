# npz (camera space, OpenCV axes) -> leveled, floored OBJ with one material per person + overlay check image
import glob, json, os, sys, numpy as np
from PIL import Image, ImageDraw
ROOT = os.path.expanduser('~/Documents/bs-photogrammetry')
raw = f'{ROOT}/web3d/raw'; out = f'{ROOT}/web3d/obj'; ov = f'{ROOT}/web3d/overlays'
os.makedirs(out, exist_ok=True); os.makedirs(ov, exist_ok=True)
faces = np.load(f'{raw}/faces.npy'); keys = json.load(open(f'{ROOT}/web3d/keys.json'))
COLORS = [(0.93, 0.93, 0.95), (0.20, 0.35, 0.75)]  # person A white gi, person B blue
def rot_to(a, b):
    a = a/np.linalg.norm(a); b = b/np.linalg.norm(b); v = np.cross(a, b); c = a@b
    if c > 1-1e-9: return np.eye(3)
    if c < -1+1e-9: return np.diag([1.0, -1.0, -1.0])
    K = np.array([[0,-v[2],v[1]],[v[2],0,-v[0]],[-v[1],v[0],0]]); return np.eye(3)+K+K@K*(1/(1+c))
GL = np.diag([1.0, -1.0, -1.0])  # OpenCV camera axes (y down, z forward) -> y up, z toward viewer
for move, steps in keys.items():
    # camera pitch: estimate "up" from the first (standing) step's body axes
    if not os.path.exists(f"{raw}/{move}-{steps[0]['step']}.npz"): continue
    first = np.load(f"{raw}/{move}-{steps[0]['step']}.npz")
    ups = []
    for k3, t in zip(first['kp3d'], first['cam_t']):
        pts = (k3 + t) @ GL.T; lo = pts[:, 1].argmin(); hi = pts[:, 1].argmax(); ups.append(pts[hi]-pts[lo])
    # static camera (double leg): level using the standing bodies; moving camera (hip throw): assume a level camera
    up = np.mean([u/np.linalg.norm(u) for u in ups], 0) if move == 'double-leg' else np.array([0, 1.0, 0])
    R = rot_to(up, np.array([0, 1.0, 0])) @ GL
    for s in steps:
        if not os.path.exists(f"{raw}/{move}-{s['step']}.npz"): continue
        d = dict(np.load(f"{raw}/{move}-{s['step']}.npz"))
        if s.get('swap'): d = {k: v[::-1] for k, v in d.items()}  # keep the same person in the same colour across steps
        V = d['verts'] + d['cam_t'][:, None, :]
        W = np.einsum('ij,pnj->pni', R, V)
        W -= np.array([W[..., 0].mean(), W[..., 1].min(), W[..., 2].mean()])
        name = f"{move}-{s['step']}"
        with open(f'{out}/{name}.mtl', 'w') as m:
            for i, c in enumerate(COLORS): m.write(f'newmtl p{i}\nKd {c[0]} {c[1]} {c[2]}\nKa 0 0 0\n\n')
        with open(f'{out}/{name}.obj', 'w') as o:
            o.write(f'mtllib {name}.mtl\n'); off = 0
            for p in range(len(W)):
                for v in W[p]: o.write(f'v {v[0]:.5f} {v[1]:.5f} {v[2]:.5f}\n')
            for p in range(len(W)):
                o.write(f'g person{p}\nusemtl p{p % 2}\n')
                for f in faces: o.write(f'f {f[0]+1+off} {f[2]+1+off} {f[1]+1+off}\n')
                off += W.shape[1]
        # overlay: project mesh vertices back into the frame
        img = Image.open(f"{ROOT}/web-clips/frames/{move}/f_{s['frame']:04d}.jpg").convert('RGB'); dr = ImageDraw.Draw(img, 'RGBA')
        H, Wd = img.size[1], img.size[0]
        for p in range(len(V)):
            f = float(d['focal'][p]); P = V[p]; uv = np.stack([f*P[:, 0]/P[:, 2] + Wd/2, f*P[:, 1]/P[:, 2] + H/2], 1)
            col = (255, 80, 80, 90) if p == 0 else (60, 200, 255, 90)
            for tri in faces[::3]:
                dr.polygon([tuple(uv[i]) for i in tri], fill=col)
        img.resize((960, 540)).save(f'{ov}/{name}.jpg')
        print(name, 'people', len(W), 'height(m)', [round(float(W[p, :, 1].max()-W[p, :, 1].min()), 2) for p in range(len(W))])
