"""Rule judge: WHO-IWGE ultrasound staging, checked in priority order.

Each rule = (stage, description, test, trigger clues). The first rule that
fires wins. Rules ABOVE the winner whose trigger clue is 'unknown' are
reported as open alternatives, which feeds the uncertainty check.
"""
from clues import YES, UNKNOWN

RULES = [
    ("CE5", "Complete or near-complete calcified wall",
     lambda c: c["calcification"] == "complete", ["calcification"]),
    ("CE4", "Heterogeneous 'ball-of-wool' content without daughter cysts",
     lambda c: c["ball_of_wool"] == YES and c["daughter_cysts"] != YES, ["ball_of_wool"]),
    ("CE3b", "Daughter cysts inside a solid matrix",
     lambda c: c["daughter_cysts"] == YES and c["solid_matrix"] == YES, ["daughter_cysts", "solid_matrix"]),
    ("CE3a", "Detached laminated membrane (water-lily sign)",
     lambda c: c["detached_membrane"] == YES, ["detached_membrane"]),
    ("CE2", "Multiseptated cyst / daughter cysts filling the cyst",
     lambda c: c["septations"] == YES or c["daughter_cysts"] == YES, ["septations", "daughter_cysts"]),
    ("CE1", "Unilocular cyst with visible wall and/or hydatid sand",
     lambda c: c["wall_visible"] == YES or c["hydatid_sand"] == YES, ["wall_visible", "hydatid_sand"]),
    ("CL", "Simple cystic lesion without pathognomonic signs",
     lambda c: True, []),
]

# Clues that must be known to trust each stage call
KEY_CLUES = {
    "CE5": ["calcification"],
    "CE4": ["ball_of_wool", "daughter_cysts", "calcification"],
    "CE3b": ["daughter_cysts", "solid_matrix", "calcification"],
    "CE3a": ["detached_membrane", "daughter_cysts"],
    "CE2": ["septations", "daughter_cysts", "solid_matrix", "detached_membrane"],
    "CE1": ["wall_visible", "hydatid_sand", "septations", "detached_membrane", "daughter_cysts"],
    "CL": ["wall_visible", "hydatid_sand", "septations", "detached_membrane"],
}


def judge(case):
    """Return dict(stage, rule, fired_on, alternatives)."""
    alternatives = []
    for stage, desc, test, triggers in RULES:
        if test(case):
            return {
                "stage": stage,
                "rule": desc,
                "fired_on": {t: case[t] for t in triggers},
                "alternatives": alternatives,
            }
        unknown = [t for t in triggers if case[t] == UNKNOWN]
        if unknown:
            alternatives.append({"stage": stage, "if_present": unknown})
    raise RuntimeError("unreachable: CL rule always fires")


def missing_key_clues(stage, case):
    return [c for c in KEY_CLUES[stage] if case.get(c) == UNKNOWN]
