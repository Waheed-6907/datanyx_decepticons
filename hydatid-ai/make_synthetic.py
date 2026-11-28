"""Synthetic training cases built from the WHO-IWGE stage descriptions.

python make_synthetic.py 5000   ->  data/cases.csv
Each stage has a prototype; we add label noise (doctors disagree), random
'unknown' masking (reports are incomplete) and realistic sizes.
Replace or merge with the team's collected data when it is ready.
"""
import os
import random
import sys

import pandas as pd

from clues import BINARY_CLUES, STAGES

# probability that each clue is 'yes' for a given stage
P = {
    #        wall  sand  sept  daugh detach solid wool  calc(partial, complete)
    "CL":   (0.05, 0.02, 0.02, 0.00, 0.00, 0.02, 0.00, (0.02, 0.00)),
    "CE1":  (0.90, 0.60, 0.02, 0.00, 0.00, 0.02, 0.00, (0.05, 0.00)),
    "CE2":  (0.80, 0.20, 0.90, 0.75, 0.05, 0.05, 0.00, (0.08, 0.00)),
    "CE3a": (0.70, 0.15, 0.05, 0.05, 0.95, 0.05, 0.02, (0.10, 0.00)),
    "CE3b": (0.60, 0.05, 0.40, 0.95, 0.30, 0.90, 0.10, (0.25, 0.00)),
    "CE4":  (0.50, 0.00, 0.05, 0.00, 0.10, 0.50, 0.92, (0.40, 0.05)),
    "CE5":  (0.40, 0.00, 0.00, 0.00, 0.00, 0.40, 0.60, (0.10, 0.90)),
}
SIZE = {"CL": (2, 6), "CE1": (2, 12), "CE2": (4, 15), "CE3a": (3, 12),
        "CE3b": (4, 15), "CE4": (2, 10), "CE5": (1, 8)}
CLUES7 = [c for c in BINARY_CLUES if c != "complicated"]


def make_case(stage, p_unknown, rng):
    probs = P[stage]
    row = {}
    for clue, p in zip(CLUES7, probs[:7]):
        row[clue] = "yes" if rng.random() < p else "no"
    pp, pc = probs[7]
    r = rng.random()
    row["calcification"] = "complete" if r < pc else "partial" if r < pc + pp else "none"
    row["size_cm"] = round(rng.uniform(*SIZE[stage]), 1)
    row["complicated"] = "yes" if rng.random() < 0.07 else "no"
    row["organ"] = "liver" if rng.random() < 0.75 else "lung"
    for k in CLUES7 + ["calcification", "size_cm", "complicated"]:
        if rng.random() < p_unknown:
            row[k] = "unknown" if k != "size_cm" else None
    row["stage"] = stage
    return row


def main(n=5000, seed=7):
    rng = random.Random(seed)
    rows = [make_case(STAGES[i % len(STAGES)], rng.choice([0.0, 0.1, 0.25]), rng)
            for i in range(n)]
    os.makedirs("data", exist_ok=True)
    pd.DataFrame(rows).to_csv("data/cases.csv", index=False)
    print(f"wrote {n} cases to data/cases.csv")


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 5000)
