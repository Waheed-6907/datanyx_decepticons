// Patient-facing text in English, Hindi, Telugu and Urdu.
// Translations were drafted for this prototype; have a native speaker review them before clinical use.
export const LANGS = { en: "English", hi: "हिन्दी", te: "తెలుగు", ur: "اردو" };
export const RTL = { ur: true };

export const T = {
  en: {
    title: "Your hydatid cyst report", stage: "Stage", confidence: "How sure the system is",
    review: "Needs expert review: please see a specialist", ok: "The evidence is consistent",
    what: "What this means", treatment: "Treatment options your doctor may consider",
    location: "Where it is", size: "Size", date: "Date", patient: "Patient",
    expires: "This link is valid until", disclaimer: "This report supports your doctor's advice. It does not replace it.",
    print: "Save / print as PDF", heatmap: "Where the AI looked on your scan", model3d: "Your cyst in 3D",
    phase: { Active: "Active", Transitional: "Transitional", Inactive: "Inactive", Undetermined: "Not yet confirmed" },
    organ: { liver: "Liver", lung: "Lung", other: "Other organ", unknown: "Not stated" }, segment: "segment",
    tx: { tablets: "Albendazole tablets", pair: "Needle drainage (PAIR)", catheter: "Catheter drainage", surgery: "Surgery (operation)",
          watch: "Regular ultrasound check-ups (watch and wait)", confirm: "More tests first to confirm the diagnosis" },
  },
  hi: {
    title: "आपकी हाइडैटिड सिस्ट रिपोर्ट", stage: "चरण", confidence: "सिस्टम कितना निश्चित है",
    review: "विशेषज्ञ की जाँच ज़रूरी है: कृपया विशेषज्ञ डॉक्टर से मिलें", ok: "सबूत एक-दूसरे से मेल खाते हैं",
    what: "इसका क्या मतलब है", treatment: "इलाज के विकल्प जिन पर आपके डॉक्टर विचार कर सकते हैं",
    location: "यह कहाँ है", size: "आकार", date: "तारीख", patient: "मरीज़",
    expires: "यह लिंक इस तारीख तक मान्य है", disclaimer: "यह रिपोर्ट आपके डॉक्टर की सलाह में मदद करती है, उसकी जगह नहीं लेती।",
    print: "PDF के रूप में सेव / प्रिंट करें", heatmap: "AI ने आपके स्कैन में कहाँ देखा", model3d: "आपकी सिस्ट 3D में",
    phase: { Active: "सक्रिय", Transitional: "बदलाव की अवस्था", Inactive: "निष्क्रिय", Undetermined: "अभी पुष्टि नहीं हुई" },
    organ: { liver: "लिवर (जिगर)", lung: "फेफड़ा", other: "अन्य अंग", unknown: "बताया नहीं गया" }, segment: "खंड",
    tx: { tablets: "एल्बेंडाज़ोल की गोलियाँ", pair: "सुई से तरल निकालना (PAIR)", catheter: "कैथेटर से तरल निकालना", surgery: "ऑपरेशन (सर्जरी)",
          watch: "नियमित अल्ट्रासाउंड से निगरानी", confirm: "पहले और जाँच करके पुष्टि" },
  },
  te: {
    title: "మీ హైడాటిడ్ సిస్ట్ నివేదిక", stage: "దశ", confidence: "సిస్టమ్ ఎంత ఖచ్చితంగా ఉంది",
    review: "నిపుణుల పరిశీలన అవసరం: దయచేసి నిపుణ వైద్యుడిని కలవండి", ok: "ఆధారాలు ఒకదానితో ఒకటి సరిపోతున్నాయి",
    what: "దీని అర్థం ఏమిటి", treatment: "మీ డాక్టర్ పరిశీలించే చికిత్స ఎంపికలు",
    location: "ఇది ఎక్కడ ఉంది", size: "పరిమాణం", date: "తేదీ", patient: "రోగి",
    expires: "ఈ లింక్ ఈ తేదీ వరకు చెల్లుతుంది", disclaimer: "ఈ నివేదిక మీ డాక్టర్ సలహాకు సహాయం చేస్తుంది, దాని స్థానాన్ని తీసుకోదు.",
    print: "PDF గా సేవ్ / ప్రింట్ చేయండి", heatmap: "మీ స్కాన్‌లో AI ఎక్కడ చూసింది", model3d: "మీ సిస్ట్ 3D లో",
    phase: { Active: "చురుకైనది", Transitional: "మార్పు దశ", Inactive: "నిష్క్రియం", Undetermined: "ఇంకా నిర్ధారించలేదు" },
    organ: { liver: "కాలేయం", lung: "ఊపిరితిత్తి", other: "ఇతర అవయవం", unknown: "చెప్పలేదు" }, segment: "భాగం",
    tx: { tablets: "ఆల్బెండజోల్ మాత్రలు", pair: "సూదితో ద్రవం తీయడం (PAIR)", catheter: "క్యాథెటర్ ద్వారా ద్రవం తీయడం", surgery: "శస్త్రచికిత్స (ఆపరేషన్)",
          watch: "క్రమం తప్పకుండా అల్ట్రాసౌండ్‌తో పర్యవేక్షణ", confirm: "ముందుగా మరిన్ని పరీక్షలతో నిర్ధారణ" },
  },
  ur: {
    title: "آپ کی ہائیڈیٹڈ سسٹ رپورٹ", stage: "مرحلہ", confidence: "سسٹم کتنا یقینی ہے",
    review: "ماہر کا جائزہ ضروری ہے: براہ کرم ماہر ڈاکٹر سے ملیں", ok: "شواہد آپس میں مطابقت رکھتے ہیں",
    what: "اس کا مطلب کیا ہے", treatment: "علاج کے اختیارات جن پر آپ کے ڈاکٹر غور کر سکتے ہیں",
    location: "یہ کہاں ہے", size: "سائز", date: "تاریخ", patient: "مریض",
    expires: "یہ لنک اس تاریخ تک کارآمد ہے", disclaimer: "یہ رپورٹ آپ کے ڈاکٹر کے مشورے میں مدد دیتی ہے، اس کی جگہ نہیں لیتی۔",
    print: "PDF کے طور پر محفوظ / پرنٹ کریں", heatmap: "AI نے آپ کے اسکین میں کہاں دیکھا", model3d: "آپ کی سسٹ 3D میں",
    phase: { Active: "فعال", Transitional: "تبدیلی کا مرحلہ", Inactive: "غیر فعال", Undetermined: "ابھی تصدیق نہیں ہوئی" },
    organ: { liver: "جگر", lung: "پھیپھڑا", other: "دوسرا عضو", unknown: "نہیں بتایا گیا" }, segment: "حصہ",
    tx: { tablets: "البینڈازول کی گولیاں", pair: "سوئی سے مائع نکالنا (PAIR)", catheter: "کیتھیٹر کے ذریعے نکاسی", surgery: "آپریشن (سرجری)",
          watch: "باقاعدہ الٹراساؤنڈ سے نگرانی", confirm: "پہلے مزید ٹیسٹ سے تصدیق" },
  },
};

// plain-language stage explanations: [what it looks like, what it means]
export const STAGE_TEXT = {
  hi: {
    CL: ["तरल से भरी एक साधारण गाँठ; अभी ऐसा कोई निशान नहीं है जो पक्का करे कि यह हाइडैटिड सिस्ट है।", "यह हाइडैटिड या कोई और सिस्ट हो सकती है। इलाज से पहले पुष्टि ज़रूरी है।"],
    CE1: ["तरल से भरी एक अकेली थैली, जिसकी दीवार दोहरी दिखती है।", "परजीवी जीवित है और सिस्ट सक्रिय है।"],
    CE2: ["एक बड़ी थैली जिसके अंदर कई छोटी 'बेटी' थैलियाँ हैं, मधुमक्खी के छत्ते जैसी।", "सिस्ट सक्रिय है और बढ़ रही है।"],
    CE3a: ["अंदर की परत अलग होकर तैर रही है, पानी में कमल जैसी।", "सिस्ट कमज़ोर पड़ने लगी है; यह बदलाव की अवस्था में है।"],
    CE3b: ["बेटी थैलियाँ एक गाढ़े, आंशिक रूप से ठोस पदार्थ के अंदर हैं।", "बदलाव की अवस्था, लेकिन फिर से सक्रिय हो सकती है; इलाज अक्सर कठिन होता है।"],
    CE4: ["अंदर का पदार्थ उलझे ऊन के गोले जैसा ठोस हो गया है।", "आमतौर पर निष्क्रिय और खत्म हो रही सिस्ट।"],
    CE5: ["दीवार कैल्शियम से अंडे के छिलके जैसी सख्त हो गई है।", "निष्क्रिय; आमतौर पर सिर्फ़ निगरानी की जाती है।"],
  },
  te: {
    CL: ["ద్రవంతో నిండిన ఒక సాధారణ గడ్డ; ఇది హైడాటిడ్ సిస్ట్ అని ఇంకా ఖచ్చితమైన గుర్తు లేదు.", "ఇది హైడాటిడ్ కావచ్చు లేదా వేరే సిస్ట్ కావచ్చు. చికిత్సకు ముందు నిర్ధారణ అవసరం."],
    CE1: ["ద్రవంతో నిండిన ఒకే సంచి, దాని గోడ రెండు పొరలుగా కనిపిస్తుంది.", "పరాన్నజీవి బతికే ఉంది, సిస్ట్ చురుకుగా ఉంది."],
    CE2: ["ఒక పెద్ద సంచి లోపల అనేక చిన్న 'కూతురు' సంచులు, తేనెతుట్టెలా.", "సిస్ట్ చురుకుగా ఉంది, పెరుగుతోంది."],
    CE3a: ["లోపలి పొర విడిపోయి తేలుతోంది, నీటిలో కలువ పువ్వులా.", "సిస్ట్ బలహీనపడుతోంది; ఇది మార్పు దశలో ఉంది."],
    CE3b: ["కూతురు సంచులు చిక్కటి, పాక్షికంగా గట్టి పదార్థంలో ఉన్నాయి.", "మార్పు దశ, కానీ మళ్లీ చురుకుగా మారవచ్చు; చికిత్స తరచుగా కష్టం."],
    CE4: ["లోపలి పదార్థం చిక్కుపడిన ఉన్ని ఉండలా గట్టిగా మారింది.", "సాధారణంగా నిష్క్రియంగా, క్షీణిస్తున్న సిస్ట్."],
    CE5: ["గోడ కాల్షియంతో గుడ్డు పెంకులా గట్టిపడింది.", "నిష్క్రియం; సాధారణంగా పర్యవేక్షణ మాత్రమే చేస్తారు."],
  },
  ur: {
    CL: ["مائع سے بھری ایک سادہ گانٹھ؛ ابھی کوئی ایسی نشانی نہیں جو ثابت کرے کہ یہ ہائیڈیٹڈ سسٹ ہے۔", "یہ ہائیڈیٹڈ یا کوئی اور سسٹ ہو سکتی ہے۔ علاج سے پہلے تصدیق ضروری ہے۔"],
    CE1: ["مائع سے بھری ایک اکیلی تھیلی، جس کی دیوار دوہری نظر آتی ہے۔", "طفیلی زندہ ہے اور سسٹ فعال ہے۔"],
    CE2: ["ایک بڑی تھیلی جس کے اندر کئی چھوٹی 'بیٹی' تھیلیاں ہیں، شہد کے چھتے کی طرح۔", "سسٹ فعال ہے اور بڑھ رہی ہے۔"],
    CE3a: ["اندر کی جھلی الگ ہو کر تیر رہی ہے، پانی میں کنول کی طرح۔", "سسٹ کمزور ہو رہی ہے؛ یہ تبدیلی کے مرحلے میں ہے۔"],
    CE3b: ["بیٹی تھیلیاں ایک گاڑھے، جزوی طور پر ٹھوس مادے کے اندر ہیں۔", "تبدیلی کا مرحلہ، لیکن دوبارہ فعال ہو سکتی ہے؛ علاج اکثر مشکل ہوتا ہے۔"],
    CE4: ["اندر کا مادہ الجھے اون کے گولے کی طرح ٹھوس ہو گیا ہے۔", "عام طور پر غیر فعال اور ختم ہوتی سسٹ۔"],
    CE5: ["دیوار کیلشیم سے انڈے کے چھلکے کی طرح سخت ہو گئی ہے۔", "غیر فعال؛ عام طور پر صرف نگرانی کی جاتی ہے۔"],
  },
};

export function treatmentKeys(options) {
  const keys = [];
  options.forEach((o) => {
    const t = o.toLowerCase();
    if (t.includes("confirm diagnosis")) keys.push("confirm");
    else if (t.includes("watch and wait")) keys.push("watch");
    else if (t.includes("non-pair") || t.includes("catheter")) keys.push("catheter");
    else if (t.includes("pair")) keys.push("pair");
    else if (t.includes("surgery")) keys.push("surgery");
    else if (t.includes("albendazole")) keys.push("tablets");
    if ((t.includes("pair") || t.includes("surgery") || t.includes("catheter")) && t.includes("albendazole")) keys.push("tablets");
  });
  return [...new Set(keys)];
}

export const PHASE_KEY = (phase) => (phase.startsWith("Undetermined") ? "Undetermined" : phase);
