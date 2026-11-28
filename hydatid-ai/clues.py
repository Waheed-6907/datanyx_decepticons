"""Shared clue schema. Every module and every dataset row uses these names."""

YES, NO, UNKNOWN = "yes", "no", "unknown"

BINARY_CLUES = [
    "wall_visible",       # double-line sign / visible cyst wall
    "hydatid_sand",       # snowflake sign
    "septations",         # multiseptate / honeycomb
    "daughter_cysts",
    "detached_membrane",  # water-lily sign
    "solid_matrix",
    "ball_of_wool",
    "complicated",        # rupture, infection, cysto-biliary fistula
]
CALCIFICATION = "calcification"  # none / partial / complete / unknown
SIZE = "size_cm"
ORGAN = "organ"                  # liver / lung / other

STAGES = ["CL", "CE1", "CE2", "CE3a", "CE3b", "CE4", "CE5"]
PHASE = {
    "CL": "Undetermined (needs confirmation)",
    "CE1": "Active", "CE2": "Active",
    "CE3a": "Transitional", "CE3b": "Transitional",
    "CE4": "Inactive", "CE5": "Inactive",
}

LABELS = {
    "wall_visible": "Visible cyst wall (double-line sign)",
    "hydatid_sand": "Hydatid sand (snowflake sign)",
    "septations": "Septations / honeycomb pattern",
    "daughter_cysts": "Daughter cysts",
    "detached_membrane": "Detached membrane (water-lily sign)",
    "solid_matrix": "Solid / echogenic matrix",
    "ball_of_wool": "Ball-of-wool content",
    "complicated": "Complication (rupture, infection, biliary leak)",
    "calcification": "Calcification of the wall",
    "size_cm": "Cyst size (cm)",
    "organ": "Organ",
    "segment": "Liver segment (Couinaud)",
}


def empty_case():
    case = {c: UNKNOWN for c in BINARY_CLUES}
    case[CALCIFICATION] = UNKNOWN
    case[SIZE] = None
    case[ORGAN] = UNKNOWN
    case["segment"] = None   # Couinaud liver segment I-VIII (optional)
    return case
