"""Generate simulated B-mode ultrasound images of hydatid cysts, one look per WHO-IWGE stage.
For the demo screen only: they are drawings of the textbook signs, NOT patient scans, and are
never fed to the image model. Output: static/sim_scans/<STAGE>/<STAGE>_<n>.jpg
Usage: python make_sim_scans.py [variants_per_stage]"""
import os, sys
import numpy as np
from scipy.ndimage import gaussian_filter, map_coordinates
from PIL import Image, ImageDraw, ImageFont

W, H = 720, 560
APEX = (W / 2, -60)
HALF_ANGLE = np.radians(36)
R0, R1 = 90, 600
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static", "sim_scans")
STAGES = ["CL", "CE1", "CE2", "CE3a", "CE3b", "CE4", "CE5"]


def polar_grid():
    y, x = np.mgrid[0:H, 0:W].astype(float)
    dx, dy = x - APEX[0], y - APEX[1]
    r = np.hypot(dx, dy)
    th = np.arctan2(dx, dy)
    return x, y, r, th


def speckle(rng, sx=3.2, sy=1.1):
    """Fully developed speckle: |complex gaussian| blurred into elongated grains along the beam."""
    re = gaussian_filter(rng.standard_normal((H, W)), (sy, sx))
    im = gaussian_filter(rng.standard_normal((H, W)), (sy, sx))
    s = np.hypot(re, im)
    return s / s.mean()


def ring(dist, rad, width):
    return np.exp(-((dist - rad) ** 2) / (2 * width ** 2))


def wavy(x, y, cx, cy, R, rng, n=5, amp=0.18):
    ang = np.arctan2(y - cy, x - cx)
    ph = rng.uniform(0, 6.28, n)
    k = rng.integers(2, 6, n)
    return R * (1 + amp * sum(np.sin(k[i] * ang + ph[i]) / (i + 1) for i in range(n)))


def make(stage, seed):
    rng = np.random.default_rng(seed)
    x, y, r, th = polar_grid()
    sector = (np.abs(th) < HALF_ANGLE) & (r > R0) & (r < R1)

    # liver parenchyma: medium echoes, soft heterogeneity, a few vessels
    g0 = gaussian_filter(rng.standard_normal((H, W)), 18); tissue = 0.55 + 0.10 * g0 / g0.std()
    for _ in range(rng.integers(2, 5)):
        vx, vy = rng.uniform(120, W - 120), rng.uniform(200, H - 40)
        va, vb = rng.uniform(6, 16), rng.uniform(4, 9)
        v = ((x - vx) / va) ** 2 + ((y - vy) / vb) ** 2
        tissue = np.where(v < 1, 0.08, tissue) + 0.5 * np.exp(-(np.sqrt(v) - 1) ** 2 / 0.02) * (v < 1.6)
    # liver capsule: bright curved line near the top
    cap_r = R0 + 28 + rng.uniform(-6, 6)
    tissue += 1.4 * ring(r, cap_r, 1.6)

    cx, cy = W / 2 + rng.uniform(-70, 70), rng.uniform(300, 340)
    R = rng.uniform(95, 125)
    ex = rng.uniform(1.0, 1.22); rot = rng.uniform(-0.4, 0.4)
    xr, yr = (x - cx) * np.cos(rot) + (y - cy) * np.sin(rot), -(x - cx) * np.sin(rot) + (y - cy) * np.cos(rot)
    d = np.hypot(xr / ex, yr) * (1 + 0.025 * gaussian_filter(rng.standard_normal((H, W)), 25) / 0.011)
    inside = d < R
    echo = tissue.copy()
    fluid = 0.035
    shadow = np.zeros_like(echo)

    if stage == "CL":
        Rw = wavy(x, y, cx, cy, R, rng, amp=0.04)
        echo = np.where(d < Rw, fluid, echo)
        echo += 0.35 * ring(d, Rw, 2.5)  # thin, ill-defined edge, no double wall
    elif stage == "CE1":
        echo = np.where(inside, fluid, echo)
        echo += 1.5 * ring(d, R + 2, 1.6) + 1.2 * ring(d, R + 8, 1.8)  # double-line sign
        echo -= 0.4 * ring(d, R + 5, 1.2)
        # hydatid sand settling at the bottom (snowflake sign)
        n = rng.integers(60, 110)
        for _ in range(n):
            a = rng.uniform(0.15 * np.pi, 0.85 * np.pi); rr = R * np.sqrt(rng.uniform(0.55, 0.95))
            px, py = cx + rr * np.cos(a), cy + rr * np.sin(a)
            echo += 0.9 * np.exp(-((x - px) ** 2 + (y - py) ** 2) / 3.0)
    elif stage in ("CE2", "CE3b"):
        mat = 0.6 + 0.25 * gaussian_filter(rng.standard_normal((H, W)), 4) / 0.07
        echo = np.where(inside, np.clip(mat, 0.2, 1.2) if stage == "CE3b" else 0.5, echo)
        echo += 1.4 * ring(d, R + 3, 2.0)
        k = rng.integers(6, 10) if stage == "CE2" else rng.integers(2, 4)
        placed = []
        for _ in range(600):
            if len(placed) >= k: break
            rr = rng.uniform(0.24, 0.40) * R if stage == "CE2" else rng.uniform(0.15, 0.24) * R
            a = rng.uniform(0, 2 * np.pi); off = rng.uniform(0, R - rr - 6)
            px, py = cx + off * np.cos(a), cy + off * np.sin(a)
            if all(np.hypot(px - qx, py - qy) > rr + qr + 3 for qx, qy, qr in placed):
                placed.append((px, py, rr))
        for px, py, rr in placed:
            dd = np.hypot(x - px, y - py)
            echo = np.where(dd < rr, fluid, echo)
            echo += 1.1 * ring(dd, rr, 1.4)
    elif stage == "CE3a":
        echo = np.where(inside, fluid, echo)
        echo += 1.3 * ring(d, R + 3, 1.8)
        # detached, folded endocyst floating in fluid (water-lily sign)
        t = np.linspace(-1, 1, 400)
        for j in range(2):
            base = cy + R * (0.15 + 0.3 * j)
            xs = cx + t * R * (0.75 - 0.15 * j)
            n1 = np.cumsum(rng.standard_normal(400)) * 0.6
            ys = base + R * 0.07 * np.sin(t * rng.uniform(4, 7) + rng.uniform(0, 6)) + n1 + R * 0.15 * t ** 2
            for px, py in zip(xs[::2], ys[::2]):
                if np.hypot(px - cx, py - cy) < R - 6:
                    echo += 0.45 * np.exp(-((x - px) ** 2 + (y - py) ** 2) / 9.0)
        echo += 0.25 * gaussian_filter(rng.standard_normal((H, W)), 3) * inside * (y > cy + R * 0.3)
    elif stage == "CE4":
        Rw = wavy(x, y, cx, cy, R, rng, amp=0.08)
        ins = d < Rw
        het = 0.55 + 0.35 * gaussian_filter(rng.standard_normal((H, W)), 6) / 0.05
        echo = np.where(ins, np.clip(het, 0.1, 1.3), echo)
        # ball of wool: tangled bright curvilinear echoes, no daughter cysts
        for _ in range(9):
            a0 = rng.uniform(0, 6.28); rr = rng.uniform(0.2, 0.8) * R
            for a in np.linspace(a0, a0 + rng.uniform(1.5, 3.5), 70):
                rad = rr * (1 + 0.25 * np.sin(5 * a))
                px, py = cx + rad * np.cos(a), cy + rad * np.sin(a)
                echo += 0.5 * np.exp(-((x - px) ** 2 + (y - py) ** 2) / 3.0) * ins
        echo += 0.8 * ring(d, Rw, 2.2)
    elif stage == "CE5":
        Rw = R * 0.85
        ang = np.arctan2(y - cy, x - cx)
        top = (ang < -0.15 * np.pi) & (ang > -0.85 * np.pi)
        echo = np.where(d < Rw, 0.5, echo)
        thick = 3.0 + 2.0 * (gaussian_filter(rng.standard_normal((H, W)), 8) / 0.035)
        echo += 2.6 * ring(d, Rw, np.clip(thick, 2, 7)) * top  # thick, irregular calcified arc
        # posterior acoustic shadow: follows the beam lines behind the arc, soft edges
        tc = np.arctan2(cx - APEX[0], cy - APEX[1]); tw = np.arctan2(Rw * 0.9, cy - APEX[1])
        shadow = ((np.abs(th - tc) < tw) & (r > np.hypot(cx - APEX[0], cy - APEX[1]) - Rw * 0.55)).astype(float)
        shadow = gaussian_filter(shadow, 7) * (0.85 + 0.15 * rng.random((H, W)))

    # posterior acoustic enhancement behind fluid-filled cysts
    if stage in ("CL", "CE1", "CE2", "CE3a"):
        tc = np.arctan2(cx - APEX[0], cy - APEX[1]); tw = np.arctan2(R * 0.85, cy - APEX[1])
        enh = (np.abs(th - tc) < tw) & (r > np.hypot(cx - APEX[0], cy - APEX[1]) + R * 0.6) & ~inside
        echo *= 1 + 0.7 * gaussian_filter(enh.astype(float), 10)
    echo *= 1 - 0.88 * shadow

    # depth attenuation + time-gain compensation, speckle, log compression
    att = np.exp(-(r - R0) / 900.0)
    img = np.clip(echo, 0.0, None) * speckle(rng) * att
    img = np.log1p(6 * img) / np.log1p(6 * 2.2)
    img = np.clip(img, 0, 1) ** 1.15
    img = gaussian_filter(img, 0.8)
    img += 0.06 * np.exp(-(r - R0) / 25.0)

    # scan conversion artefact: very slight lateral blur deeper down
    img = np.where(sector, img, 0)
    edge = np.clip((HALF_ANGLE - np.abs(th)) / 0.02, 0, 1) * np.clip((R1 - r) / 6, 0, 1)
    img = img * edge
    g = (img * 235).astype(np.uint8)
    rgb = np.stack([g, g, g], -1)
    im = Image.fromarray(rgb)
    dr = ImageDraw.Draw(im)
    # depth scale ticks along the right edge of the sector
    for cm in range(1, 16):
        rr = R0 + cm * 34
        if rr > R1: break
        px = APEX[0] + rr * np.sin(HALF_ANGLE) + 10
        py = APEX[1] + rr * np.cos(HALF_ANGLE)
        dr.line([(px, py), (px + (10 if cm % 5 == 0 else 5), py)], fill=(170, 170, 170), width=1)
    # focal zone marker
    fy = cy
    fx = APEX[0] - (fy - APEX[1]) * np.tan(HALF_ANGLE) - 18
    dr.polygon([(fx, fy - 6), (fx + 8, fy), (fx, fy + 6)], fill=(200, 200, 200))
    return im


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 4
    for si, st in enumerate(STAGES):
        d = os.path.join(OUT, st); os.makedirs(d, exist_ok=True)
        for f in os.listdir(d): os.remove(os.path.join(d, f))
        for i in range(n):
            make(st, 1000 * si + i).save(os.path.join(d, f"{st}_sim_{i+1:02d}.jpg"), quality=90)
        print(st, n)


if __name__ == "__main__":
    main()
