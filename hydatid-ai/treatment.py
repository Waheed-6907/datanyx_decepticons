"""Stage + size + complications -> treatment options (WHO-IWGE 2010 expert
consensus, stage-specific approach for uncomplicated liver CE).

!! VERIFY the size cut-offs (SMALL_CM, LARGE_CM) and wording against the
!! WHO-IWGE 2010 Expert Consensus table (Brunetti et al., Acta Tropica 2010)
!! before the demo. These are suggestions for a doctor, never orders.
"""
SMALL_CM = 5
LARGE_CM = 10

ABZ = "Albendazole tablets"


def recommend(stage, size_cm=None, complicated="unknown", organ="unknown"):
    notes = []
    if complicated == "yes":
        return {"options": ["Surgery (with albendazole cover)"],
                "reason": "Complicated cysts (rupture, infection, biliary leak) usually need surgery.",
                "notes": notes}
    if organ == "lung" and stage in ("CE1", "CE2", "CE3a", "CE3b"):
        return {"options": ["Surgery (with albendazole cover)",
                            f"{ABZ} alone (small cysts / unfit for surgery)"],
                "reason": f"{stage} in the lung: surgery is usually the treatment of choice.",
                "notes": ["Lung cyst: PAIR and other puncture techniques are not used in the lung."]}

    size_txt = "unknown size"
    if size_cm is not None:
        size_txt = f"{size_cm:g} cm"
    else:
        notes.append("Size not given: size changes the recommendation for active and transitional cysts.")

    if stage in ("CE1", "CE3a"):
        if size_cm is None:
            opts = [ABZ, f"PAIR + {ABZ} (if >= {SMALL_CM} cm)"]
        elif size_cm < SMALL_CM:
            opts = [f"{ABZ} alone"]
        elif size_cm <= LARGE_CM:
            opts = [f"PAIR + {ABZ}"]
        else:
            opts = [f"PAIR + {ABZ}", "Surgery (large cyst)"]
        reason = f"{stage} is a uni-vesicular active/transitional cyst; options depend on size ({size_txt})."
    elif stage in ("CE2", "CE3b"):
        opts = [f"Non-PAIR percutaneous treatment (modified catheterization) + {ABZ}",
                f"Surgery + {ABZ}", f"{ABZ} alone (small cysts / unfit for intervention)"]
        reason = f"{stage} contains daughter cysts; simple PAIR tends to fail, so catheter drainage or surgery is preferred."
    elif stage in ("CE4", "CE5"):
        opts = ["Watch and wait with periodic ultrasound"]
        reason = f"{stage} is inactive; uncomplicated inactive cysts are usually just monitored."
    else:  # CL
        opts = ["Confirm diagnosis first: repeat ultrasound / serology / CT-MRI"]
        reason = "CL is not confirmed as a hydatid cyst; do not treat until it is."
    return {"options": opts, "reason": reason, "notes": notes}
