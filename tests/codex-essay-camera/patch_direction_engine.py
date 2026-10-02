from pathlib import Path
import ast
import sys
p=Path('/opt/home-lab/essay-grader/app.py')
s=p.read_text()
assert 'def _detect_rotation_locked' in s
if 'Only two text-box passes are needed' in s:
    print('Direction optimization already present')
    sys.exit(0)
s=s.replace('_direction_engine = RapidOCR()', '_direction_engine = RapidOCR(intra_op_num_threads=2, inter_op_num_threads=1)')
s=s.replace('_direction_engine_nocls = RapidOCR(use_cls=False)', '_direction_engine_nocls = RapidOCR(use_cls=False, intra_op_num_threads=2, inter_op_num_threads=1)')
a=s.index('    # 阶段1：四方向 det 行几何分',s.index('def _detect_rotation_locked'))
b=s.index('    # 阶段2：',a)
s=s[:a]+'''    # Only two text-box passes are needed to determine the writing axis.
    # 0/180 and 90/270 share geometry; recognition is reserved for the two
    # upright/upside-down candidates below, not repeated in the axis scan.
    struct_scores = {}
    for deg in (0, 90):
        im = img if deg == 0 else _rot_np(img, deg)
        boxes, _ = engine(im, use_cls=False, use_rec=False)
        struct = 0.0
        for box in (boxes or []):
            xs = [pt[0] for pt in box]
            ys = [pt[1] for pt in box]
            struct += max(0.0, (max(xs) - min(xs)) - (max(ys) - min(ys)))
        struct_scores[deg] = struct
    group = (0, 180) if struct_scores[0] >= struct_scores[90] else (90, 270)
    if max(struct_scores.values()) <= 0:
        return {"rotation_degrees": 0, "confidence": "low", "note": "no text structure"}

'''+s[b:]
ast.parse(s)
backup=p.with_name('app.before-direction-20261002.py')
if not backup.exists(): backup.write_text(p.read_text())
p.write_text(s)
print('Direction source patched; AST OK; backup saved')
