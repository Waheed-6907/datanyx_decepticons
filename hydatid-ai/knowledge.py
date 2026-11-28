"""Plain-language stage knowledge + knowledge-graph builder (shared by API and UI)."""
from clues import LABELS, PHASE, STAGES
from rules import KEY_CLUES, RULES
from treatment import recommend

STAGE_INFO = {
    "CL": {"name": "Cystic lesion (unconfirmed)",
           "plain": "A simple fluid bubble with no sign that proves it is a hydatid cyst yet.",
           "signs": ["Uniform fluid content", "No visible cyst wall", "No hydatid sand"],
           "means": "It might be hydatid, or another kind of cyst. Confirm before treating."},
    "CE1": {"name": "Unilocular active cyst",
            "plain": "A single fluid-filled bubble with a visible double wall, sometimes with floating 'sand'.",
            "signs": ["Double-line wall", "Hydatid sand (snowflake sign)", "One compartment"],
            "means": "The parasite is alive and the cyst is active."},
    "CE2": {"name": "Multivesicular active cyst",
            "plain": "A big bubble packed with many smaller 'daughter' bubbles, like a honeycomb.",
            "signs": ["Septations / honeycomb", "Daughter cysts filling the cyst"],
            "means": "Active and actively multiplying."},
    "CE3a": {"name": "Transitional cyst, detached membrane",
             "plain": "The inner lining has peeled off and floats inside, like a water lily.",
             "signs": ["Detached laminated membrane", "Water-lily sign"],
             "means": "The cyst is starting to fail; it is in transition."},
    "CE3b": {"name": "Transitional cyst, daughter cysts in matrix",
             "plain": "Daughter bubbles sitting inside a thicker, partly solid material.",
             "signs": ["Daughter cysts", "Solid / echogenic matrix"],
             "means": "Transitional, but can become active again; often harder to treat."},
    "CE4": {"name": "Inactive degenerating cyst",
            "plain": "The contents have turned into a tangled solid mass, like a ball of wool.",
            "signs": ["Ball-of-wool content", "No daughter cysts"],
            "means": "Usually inactive and degenerating."},
    "CE5": {"name": "Inactive calcified cyst",
            "plain": "The wall has hardened into an egg-shell of calcium.",
            "signs": ["Egg-shell calcification", "Solid content"],
            "means": "Inactive; usually only monitored."},
}

GUIDELINES = [
    {"id": "who-iwge-2003", "title": "WHO-IWGE standardised ultrasound classification of CE (Acta Tropica, 2003)",
     "used_for": "Stage definitions (CL, CE1-CE5)"},
    {"id": "who-iwge-2010", "title": "WHO-IWGE Expert Consensus on diagnosis and treatment of echinococcosis (2010)",
     "used_for": "Stage- and size-specific management options"},
    {"id": "who-2025", "title": "WHO guidelines for the treatment of patients with cystic echinococcosis (2025)",
     "used_for": "Complicated cysts -> surgery; inactive uncomplicated -> watch and wait"},
]


def stage_info():
    out = {}
    for s in STAGES:
        rule = next(r for r in RULES if r[0] == s)
        out[s] = dict(STAGE_INFO[s], stage=s, phase=PHASE[s], rule=rule[1],
                      triggers=rule[3], key_clues=KEY_CLUES[s])
    return out


def graph():
    nodes, links = [], []

    def add(i, label, group, info=""):
        nodes.append({"id": i, "label": label, "group": group, "info": info})

    phases = {"Active": "phase:active", "Transitional": "phase:trans",
              "Inactive": "phase:inactive", "Undetermined (needs confirmation)": "phase:cl"}
    for p, pid in phases.items():
        add(pid, p.split(" (")[0], "phase")
    signs = set()
    mgmt = {}
    for s in STAGES:
        info = STAGE_INFO[s]
        add("stage:" + s, s, "stage", info["plain"])
        links.append({"source": "stage:" + s, "target": phases[PHASE[s]], "kind": "phase"})
        rule = next(r for r in RULES if r[0] == s)
        for t in rule[3]:
            signs.add(t)
            links.append({"source": "sign:" + t, "target": "stage:" + s, "kind": "sign"})
        for opt in recommend(s, 6.0)["options"][:2]:
            short = opt.split(" (")[0].split(":")[0]
            mid = "mgmt:" + short
            if mid not in mgmt:
                mgmt[mid] = short
            links.append({"source": "stage:" + s, "target": mid, "kind": "mgmt"})
    for t in sorted(signs):
        add("sign:" + t, LABELS.get(t, t).split(" (")[0], "sign", LABELS.get(t, t))
    add("sign:complicated", "Complication", "sign", LABELS["complicated"])
    for mid, label in mgmt.items():
        add(mid, label, "mgmt")
    surg = next((m for m in mgmt if m.startswith("mgmt:Surgery")), None)
    if surg is None:
        surg = "mgmt:Surgery"
        add(surg, "Surgery", "mgmt")
    links.append({"source": "sign:complicated", "target": surg, "kind": "mgmt"})
    return {"nodes": nodes, "links": links}
