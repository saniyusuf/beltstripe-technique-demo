# Run SAM 3D Body on the hand-picked key frames, save meshes per step (both people in one scene).
import json, os, sys, numpy as np, cv2, torch
ROOT = os.path.expanduser('~/Documents/bs-photogrammetry')
sys.path.insert(0, f'{ROOT}/sam-3d-body')
from sam_3d_body import load_sam_3d_body, SAM3DBodyEstimator
ckpt_dir = sys.argv[1]  # folder with model.ckpt and assets/mhr_model.pt
dev = os.environ.get('S3DB_DEVICE', 'mps')
model, cfg = load_sam_3d_body(f'{ckpt_dir}/model.ckpt', device=dev, mhr_path=f'{ckpt_dir}/assets/mhr_model.pt')
est = SAM3DBodyEstimator(sam_3d_body_model=model, model_cfg=cfg)
keys = json.load(open(f'{ROOT}/web3d/keys.json'))
out_dir = f'{ROOT}/web3d/raw'; os.makedirs(out_dir, exist_ok=True)
np.save(f'{out_dir}/faces.npy', est.faces)
for move, steps in keys.items():
    for s in steps:
        img_path = f"{ROOT}/web-clips/frames/{move}/f_{s['frame']:04d}.jpg"
        img = cv2.cvtColor(cv2.imread(img_path), cv2.COLOR_BGR2RGB)
        outs = est.process_one_image(img, bboxes=np.array(s['boxes'], dtype=np.float32))
        np.savez(f"{out_dir}/{move}-{s['step']}.npz",
                 verts=np.stack([o['pred_vertices'] for o in outs]), cam_t=np.stack([o['pred_cam_t'] for o in outs]),
                 kp2d=np.stack([o['pred_keypoints_2d'] for o in outs]), kp3d=np.stack([o['pred_keypoints_3d'] for o in outs]),
                 focal=np.array([o['focal_length'] for o in outs]), bbox=np.stack([o['bbox'] for o in outs]))
        print(move, s['step'], 'people', len(outs), flush=True)
