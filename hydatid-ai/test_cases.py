"""7 hand-written reports, one per stage. Run: python test_cases.py
If all 7 pass, the extractor + rule judge work."""
from engine import assess
from extractor import keyword_extract

REPORTS = {
    "CL": "Right lobe of liver shows a 3 cm unilocular anechoic cyst. No visible wall. No hydatid sand.",
    "CE1": "A 4.2 cm unilocular anechoic cyst in segment VII of the liver with double-line sign. Mobile echogenic foci (hydatid sand) noted.",
    "CE2": "Liver shows an 8 cm multiseptated cyst with honeycomb appearance and multiple daughter cysts. No solid matrix. No calcification.",
    "CE3a": "6 cm cyst in the right hepatic lobe with a floating membrane (water-lily sign). No daughter cysts.",
    "CE3b": "Hepatic cyst measuring 9 cm with daughter cysts within a heterogeneous echogenic matrix. Partial wall calcification.",
    "CE4": "5 cm heterogeneous lesion in the liver with ball-of-wool content. No daughter cysts. No calcification.",
    "CE5": "Liver shows a 3 cm lesion with egg-shell calcification of the wall and posterior acoustic shadowing.",
}

if __name__ == "__main__":
    ok = 0
    for want, text in REPORTS.items():
        case, ev = keyword_extract(text)
        r = assess(case)
        hit = r["stage"] == want
        ok += hit
        print(f"{'PASS' if hit else 'FAIL'}  want {want:5} got {r['stage']:5} "
              f"conf {r['confidence']:6} -> {r['treatment']['options'][0]}")
        if r["ask_for"]:
            print("        ask for:", ", ".join(r["ask_for"]))
    print(f"\n{ok}/{len(REPORTS)} passed")
