"""Stage-based referral: which hospitals can deliver the treatment this stage needs, nearest first.

DEMO DIRECTORY: hospital names and locations are real places in and around Hyderabad, but the
capability tags are illustrative and must be confirmed with each hospital before real use.
"""
import math

ORIGIN = {"name": "MJCET, Banjara Hills", "lat": 17.4196, "lng": 78.4437}

CAP_LABEL = {
    "ultrasound": "Ultrasound follow-up",
    "medicine": "Albendazole therapy (physician)",
    "interventional_radiology": "PAIR / catheter drainage (interventional radiology)",
    "hepatobiliary_surgery": "Liver (hepatobiliary) surgery",
    "thoracic_surgery": "Chest (thoracic) surgery",
    "ct_mri": "CT / MRI for confirmation",
    "emergency": "24x7 emergency surgery",
}

HOSPITALS = [
    {"name": "Nizam's Institute of Medical Sciences (NIMS)", "area": "Punjagutta", "type": "Government tertiary",
     "lat": 17.4239, "lng": 78.4497, "caps": ["ultrasound", "medicine", "interventional_radiology", "hepatobiliary_surgery", "thoracic_surgery", "ct_mri", "emergency"]},
    {"name": "Osmania General Hospital", "area": "Afzalgunj", "type": "Government tertiary",
     "lat": 17.3713, "lng": 78.4747, "caps": ["ultrasound", "medicine", "hepatobiliary_surgery", "thoracic_surgery", "ct_mri", "emergency"]},
    {"name": "Gandhi Hospital", "area": "Secunderabad", "type": "Government tertiary",
     "lat": 17.4256, "lng": 78.5030, "caps": ["ultrasound", "medicine", "hepatobiliary_surgery", "thoracic_surgery", "ct_mri", "emergency"]},
    {"name": "AIIMS Bibinagar", "area": "Bibinagar", "type": "Government tertiary",
     "lat": 17.4795, "lng": 78.7950, "caps": ["ultrasound", "medicine", "interventional_radiology", "hepatobiliary_surgery", "ct_mri"]},
    {"name": "AIG Hospitals", "area": "Gachibowli", "type": "Private gastro & liver centre",
     "lat": 17.4430, "lng": 78.3620, "caps": ["ultrasound", "medicine", "interventional_radiology", "hepatobiliary_surgery", "ct_mri", "emergency"]},
    {"name": "Apollo Hospitals", "area": "Jubilee Hills", "type": "Private tertiary",
     "lat": 17.4160, "lng": 78.4120, "caps": ["ultrasound", "medicine", "interventional_radiology", "hepatobiliary_surgery", "thoracic_surgery", "ct_mri", "emergency"]},
    {"name": "Yashoda Hospitals", "area": "Somajiguda", "type": "Private tertiary",
     "lat": 17.4210, "lng": 78.4580, "caps": ["ultrasound", "medicine", "interventional_radiology", "hepatobiliary_surgery", "ct_mri", "emergency"]},
    {"name": "Area Hospital Nampally", "area": "Nampally", "type": "Government secondary",
     "lat": 17.3925, "lng": 78.4690, "caps": ["ultrasound", "medicine"]},
    {"name": "Urban Primary Health Centre (nearest)", "area": "Your locality", "type": "Primary care",
     "lat": 17.4150, "lng": 78.4400, "caps": ["medicine"]},
]


def needs(stage, treatment_options, organ="liver", complicated="no"):
    """Translate the stage + management options into required hospital capabilities."""
    text = " ".join(treatment_options).lower()
    req, why = [], []
    surg = "thoracic_surgery" if organ == "lung" else "hepatobiliary_surgery"
    if complicated == "yes":
        return ["emergency", surg], "Complicated cyst: needs urgent surgical care."
    if "confirm diagnosis" in text:
        return ["ultrasound", "ct_mri"], "Lesion not confirmed: needs CT/MRI and a specialist read."
    if "watch and wait" in text:
        return ["ultrasound"], "Inactive cyst: periodic ultrasound follow-up is enough."
    if "surgery" in text and "pair" not in text and "percutaneous" not in text:
        req, why = [surg], ["surgery"]
    elif "pair" in text or "percutaneous" in text:
        req, why = ["interventional_radiology"], ["PAIR / catheter drainage"]
        if "surgery" in text:
            why.append("surgery as alternative")
    if "albendazole" in text:
        req.append("medicine")
    return req or ["medicine"], "Needs " + (" and ".join(CAP_LABEL[r].split(" (")[0].lower() for r in req) or "physician care") + "."


def km(a_lat, a_lng, b_lat, b_lng):
    r = 6371.0
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp, dl = p2 - p1, math.radians(b_lng - a_lng)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def route(stage, treatment_options, organ="liver", complicated="no", lat=None, lng=None):
    req, why = needs(stage, treatment_options, organ, complicated)
    o_lat, o_lng = (lat, lng) if lat is not None and lng is not None else (ORIGIN["lat"], ORIGIN["lng"])
    out = []
    for h in HOSPITALS:
        have = [r for r in req if r in h["caps"]]
        d = km(o_lat, o_lng, h["lat"], h["lng"])
        out.append(dict(h, distance_km=round(d, 1), match=len(have) == len(req), has=have,
                        missing=[r for r in req if r not in have],
                        maps=f"https://www.google.com/maps/dir/?api=1&destination={h['lat']},{h['lng']}",
                        dx=round((h["lng"] - o_lng) * 106, 2), dy=round((h["lat"] - o_lat) * 111, 2)))
    out.sort(key=lambda h: (not h["match"], h["distance_km"]))
    return {"required": [{"id": r, "label": CAP_LABEL[r]} for r in req], "why": why,
            "origin": {"lat": o_lat, "lng": o_lng, "name": "Your location" if lat is not None else ORIGIN["name"]},
            "hospitals": out,
            "disclaimer": "Demo directory: real hospitals, illustrative capability tags. Confirm services by phone before referring."}
