"""Copy a few real scans per stage from the dataset into static/demo_scans/ for the demo.
Usage: python add_demo_scans.py <dataset folder> [per_stage]
Folders named 1-5 (or containing CE1..CE5 / CL) are mapped to stages. Kept out of git."""
import os, re, sys, random
from PIL import Image

MAP = {"1": "CE1", "2": "CE2", "3": "CE3", "4": "CE4", "5": "CE5"}
EXT = (".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".webp")
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "static", "demo_scans")


def stage_of(name):
    n = name.strip().upper()
    if n in MAP: return MAP[n]
    m = re.search(r"CE\s*-?\s*([1-5])", n)
    if m: return "CE" + m.group(1)
    if re.fullmatch(r"(STAGE|CLASS|TYPE)?[\s_-]*([1-5])", n): return MAP[re.findall(r"[1-5]", n)[-1]]
    if n in ("CL", "CYSTIC LESION"): return "CL"
    return None


def main():
    root = sys.argv[1]; per = int(sys.argv[2]) if len(sys.argv) > 2 else 12
    found = {}
    for d, _, files in os.walk(root):
        st = stage_of(os.path.basename(d))
        imgs = [os.path.join(d, f) for f in files if f.lower().endswith(EXT)]
        if st and imgs: found.setdefault(st, []).extend(imgs)
    if not found:
        print("No stage folders found (expected folders named 1-5 or CE1..CE5)."); sys.exit(1)
    random.seed(7)
    for st, imgs in sorted(found.items()):
        dst = os.path.join(OUT, st); os.makedirs(dst, exist_ok=True)
        for f in os.listdir(dst): os.remove(os.path.join(dst, f))
        pick = random.sample(imgs, min(per, len(imgs)))
        for i, src in enumerate(pick):
            try:
                im = Image.open(src).convert("RGB"); im.thumbnail((900, 900))
                im.save(os.path.join(dst, f"{st}_{i+1:02d}.jpg"), quality=88)
            except Exception as e:
                print("skip", src, e)
        print(f"{st}: {len(pick)} of {len(imgs)} scans copied")
    print("Done. Restart the app and pick a sample stage.")


if __name__ == "__main__":
    main()
