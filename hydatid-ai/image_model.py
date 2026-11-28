"""Image judge: fine-tuned CNN that stages a hydatid cyst from a scan image.

Quick mode (default, ~10 min on an M-series Mac):
    python image_model.py train --images /path/to/folder_with_1_2_3_4_5 [--csv hydatid_cyst_attributes.csv]
    -> EfficientNet-B0 @224, then XGBoost / LogReg / SVM heads with isotonic calibration + ensemble,
       best picked on validation, reported once on a held-out test set.

Strong mode (~45-90 min):
    python image_model.py train --images ... --strong
    -> EfficientNet-B2 @288, longer training, 5-fold cross-validation (mean +/- std) and a
       5-model ensemble evaluated on the same untouched test set.

Folder layout:  1/ 2/ 3/ 4/ 5/  ->  CE1 CE2 CE3 CE4 CE5   (CE3a + CE3b merged: only 11 CE3a images exist;
the report/rule judge separates CE3a from CE3b.)
Outputs in ./image_model_out/
"""
import argparse
import base64
import io
import json
import os
import random
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "image_model_out")
CLASSES = ["CE1", "CE2", "CE3", "CE4", "CE5"]
FOLDER_TO_CLASS = {"1": "CE1", "2": "CE2", "3": "CE3", "4": "CE4", "5": "CE5"}
MEAN, STD = [0.485, 0.456, 0.406], [0.229, 0.224, 0.225]
ARCHS = {"efficientnet_b0": 224, "efficientnet_b2": 288, "efficientnet_b3": 300, "convnext_tiny": 224}


def _torch():
    import torch
    import torchvision
    return torch, torchvision


def pick_device(torch):
    if torch.backends.mps.is_available():
        return torch.device("mps")
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


def build_model(arch, torch, pretrained=True):
    import torchvision.models as M
    fn = getattr(M, arch)
    weights = "DEFAULT" if pretrained else None
    try:
        m = fn(weights=weights)
    except Exception as e:  # no internet for weights -> train from scratch (much weaker)
        print("WARNING: could not load ImageNet weights (%s). Training from scratch." % e)
        m = fn(weights=None)
    last = m.classifier[-1]
    m.classifier[-1] = torch.nn.Linear(last.in_features, len(CLASSES))
    return m


def features_of(m, x, torch):
    """Penultimate features for any supported architecture."""
    z = m.avgpool(m.features(x))
    if hasattr(m.classifier, "__len__") and len(m.classifier) == 3:  # convnext: LayerNorm, Flatten, Linear
        z = m.classifier[1](m.classifier[0](z))
    return torch.flatten(z, 1)


def collect(images_dir, csv_path=None):
    items = []
    exts = (".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff")
    for folder, cls in FOLDER_TO_CLASS.items():
        d = os.path.join(images_dir, folder)
        if not os.path.isdir(d):
            continue
        for name in sorted(os.listdir(d)):
            if name.lower().endswith(exts) and not name.startswith("."):
                items.append((os.path.join(d, name), CLASSES.index(cls), folder + "/" + name))
    if csv_path and os.path.exists(csv_path):
        import pandas as pd
        df = pd.read_csv(csv_path, encoding="utf-8-sig")
        known = set(df["image_name"].astype(str))
        before = len(items)
        items = [it for it in items if it[2] in known] or items
        print(f"CSV {os.path.basename(csv_path)}: {len(df)} rows, matched {len(items)}/{before} image files")
    return items


def dedupe(items):
    """Drop exact duplicate files (same bytes) so they cannot leak between train and test."""
    import hashlib
    seen, out, dup = set(), [], 0
    for it in items:
        h = hashlib.md5(open(it[0], "rb").read()).hexdigest()
        if h in seen:
            dup += 1; continue
        seen.add(h); out.append(it)
    if dup:
        print(f"Removed {dup} exact duplicate images (prevents train/test leakage)")
    return out


def strat_split(items, frac, seed):
    rnd = random.Random(seed); by = {}
    for it in items:
        by.setdefault(it[1], []).append(it)
    a, b = [], []
    for lst in by.values():
        lst = lst[:]; rnd.shuffle(lst); n = max(1, int(round(len(lst) * frac)))
        a += lst[:n]; b += lst[n:]
    return a, b  # a = held-out part, b = rest


def transforms(img):
    from torchvision import transforms as T
    train_tf = T.Compose([T.Grayscale(3), T.RandomResizedCrop(img, scale=(0.65, 1.0), ratio=(0.85, 1.18)),
                          T.RandomHorizontalFlip(), T.RandomRotation(15), T.ColorJitter(0.3, 0.3),
                          T.RandomApply([T.GaussianBlur(3)], p=0.2), T.ToTensor(), T.Normalize(MEAN, STD),
                          T.RandomErasing(p=0.15, scale=(0.02, 0.08))])
    eval_tf = T.Compose([T.Grayscale(3), T.Resize((img, img)), T.ToTensor(), T.Normalize(MEAN, STD)])
    return train_tf, eval_tf


def loader(items, tf, torch, bs, balanced=False):
    from PIL import Image

    class DS(torch.utils.data.Dataset):
        def __len__(self):
            return len(items)

        def __getitem__(self, i):
            p, y, _ = items[i]
            return tf(Image.open(p).convert("RGB")), y

    kw = {}
    if balanced:
        counts = [0] * len(CLASSES)
        for _, y, _ in items:
            counts[y] += 1
        w = [1.0 / counts[y] for _, y, _ in items]
        kw["sampler"] = torch.utils.data.WeightedRandomSampler(w, num_samples=len(items), replacement=True)
    return torch.utils.data.DataLoader(DS(), batch_size=bs, num_workers=0, **kw)


def predict_logits(model, dl, torch, device):
    model.eval(); out = []
    with torch.no_grad():
        for x, _ in dl:
            x = x.to(device)
            out.append(((model(x) + model(torch.flip(x, dims=[3]))) / 2).cpu())  # flip TTA
    return torch.cat(out) if out else torch.zeros(0, len(CLASSES))


def embed(model, dl, torch, device):
    model.eval(); out = []
    with torch.no_grad():
        for x, _ in dl:
            x = x.to(device)
            out.append(((features_of(model, x, torch) + features_of(model, torch.flip(x, dims=[3]), torch)) / 2).cpu())
    return torch.cat(out).numpy()


def fit_temperature(logits, ys, torch):
    y = torch.tensor(ys); best, bestT = 1e9, 1.0
    for T in [x / 20 for x in range(10, 81)]:
        nll = torch.nn.functional.cross_entropy(logits / T, y).item()
        if nll < best:
            best, bestT = nll, T
    return bestT


def ece(probs, y, bins=10):
    import numpy as np
    probs, y = np.asarray(probs), np.asarray(y)
    conf, pred = probs.max(1), probs.argmax(1)
    edges, e = np.linspace(0, 1, bins + 1), 0.0
    for lo, hi in zip(edges[:-1], edges[1:]):
        m = (conf > lo) & (conf <= hi)
        if m.any():
            e += m.mean() * abs((pred[m] == y[m]).mean() - conf[m].mean())
    return float(e)


def score(p, y):
    import numpy as np
    from sklearn.metrics import accuracy_score, f1_score, log_loss
    p = np.clip(np.asarray(p), 1e-7, 1); p = p / p.sum(1, keepdims=True)
    return {"accuracy": round(accuracy_score(y, p.argmax(1)), 4), "macro_f1": round(f1_score(y, p.argmax(1), average="macro"), 4),
            "log_loss": round(log_loss(y, p, labels=list(range(len(CLASSES)))), 4), "ece": round(ece(p, y), 4)}


def make_heads():
    from sklearn.calibration import CalibratedClassifierCV
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler
    from sklearn.svm import LinearSVC
    heads = {}
    try:
        from xgboost import XGBClassifier
        heads["XGBoost + isotonic"] = CalibratedClassifierCV(XGBClassifier(n_estimators=300, max_depth=4, learning_rate=0.05,
                                      subsample=0.8, colsample_bytree=0.5, eval_metric="mlogloss"), method="isotonic", cv=3)
    except Exception as e:
        from sklearn.ensemble import HistGradientBoostingClassifier
        print("(XGBoost unavailable: %s; using sklearn gradient boosting instead)" % e)
        heads["GradBoost + isotonic"] = CalibratedClassifierCV(HistGradientBoostingClassifier(max_iter=300, learning_rate=0.05), method="isotonic", cv=3)
    heads["LogReg + isotonic"] = CalibratedClassifierCV(make_pipeline(StandardScaler(), LogisticRegression(C=0.5, max_iter=4000)), method="isotonic", cv=3)
    heads["SVM + isotonic"] = CalibratedClassifierCV(make_pipeline(StandardScaler(), LinearSVC(C=0.05, max_iter=8000)), method="isotonic", cv=3)
    return heads


def train_cnn(tr, va, args, torch, device, tag=""):
    """Fine-tune one CNN: frozen-backbone warm-up, then full fine-tuning with early stopping on validation macro-F1."""
    from sklearn.metrics import f1_score
    img = ARCHS[args.arch]
    train_tf, eval_tf = transforms(img)
    trl, val = loader(tr, train_tf, torch, args.batch, balanced=True), loader(va, eval_tf, torch, args.batch)
    model = build_model(args.arch, torch, pretrained=not args.scratch).to(device)
    crit = torch.nn.CrossEntropyLoss(label_smoothing=0.05)
    yv = [it[1] for it in va]
    state = {"best": -1, "sd": None, "pat": 0, "log": []}

    def run(epochs, lr, freeze):
        for p in model.features.parameters():
            p.requires_grad = not freeze
        opt = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=lr, weight_decay=1e-4)
        sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=lr, total_steps=max(1, epochs * len(trl)), pct_start=0.15)
        state["pat"] = 0
        for ep in range(epochs):
            model.train(); t0 = time.time(); tot = n = correct = 0
            for x, y in trl:
                x, y = x.to(device), y.to(device)
                opt.zero_grad(); out = model(x); loss = crit(out, y); loss.backward(); opt.step(); sched.step()
                tot += loss.item() * len(y); n += len(y); correct += (out.argmax(1) == y).sum().item()
            pv = predict_logits(model, val, torch, device).argmax(1).tolist()
            f1 = f1_score(yv, pv, average="macro"); acc = sum(a == b for a, b in zip(yv, pv)) / len(yv)
            rec = {"fold": tag, "epoch": len(state["log"]) + 1, "phase": "head" if freeze else "full", "loss": round(tot / n, 4),
                   "train_acc": round(correct / n, 4), "val_acc": round(acc, 4), "val_macro_f1": round(f1, 4), "sec": round(time.time() - t0, 1)}
            state["log"].append(rec)
            print("%sepoch %2d %-4s loss %.3f  train acc %.3f  val acc %.3f  val F1 %.3f  (%.0fs)" % (
                (tag + " ") if tag else "", rec["epoch"], rec["phase"], rec["loss"], rec["train_acc"], acc, f1, rec["sec"]))
            if f1 > state["best"]:
                state["best"], state["pat"] = f1, 0
                state["sd"] = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
            else:
                state["pat"] += 1
                if state["pat"] >= args.patience:
                    print("  early stop (no validation improvement for %d epochs)" % args.patience); return

    run(args.head_epochs, 1e-3, freeze=True)
    run(args.epochs, args.lr, freeze=False)
    model.load_state_dict(state["sd"])
    T = fit_temperature(predict_logits(model, val, torch, device), yv, torch)
    return model, T, state["log"], state["best"]


def train(args):
    import numpy as np
    torch, _ = _torch()
    torch.manual_seed(0); random.seed(0)
    os.makedirs(OUT, exist_ok=True)
    for f in os.listdir(OUT):
        if f.startswith("fold") and f.endswith(".pt"):
            os.remove(os.path.join(OUT, f))
    items = collect(args.images, args.csv)
    if len(items) < 50:
        sys.exit(f"Found only {len(items)} images under {args.images}. Expected folders 1/ 2/ 3/ 4/ 5/ with scans.")
    items = dedupe(items)
    te, rest = strat_split(items, 0.15, seed=42)          # untouched test set, same in every mode
    device = pick_device(torch)
    img = ARCHS[args.arch]
    print(f"Images: {len(items)}  test (held out) {len(te)}  | arch {args.arch} @{img}px | device {device} | "
          f"{'%d-fold CV' % args.kfold if args.kfold > 1 else 'single split'}")
    _, eval_tf = transforms(img)
    tel = loader(te, eval_tf, torch, args.batch)
    yt = np.array([it[1] for it in te])
    logs, comparison, extra = [], {}, {}

    if args.kfold > 1:
        from sklearn.model_selection import StratifiedKFold
        skf = StratifiedKFold(n_splits=args.kfold, shuffle=True, random_state=7)
        ys_rest = [it[1] for it in rest]
        fold_scores, test_probs = [], []
        for k, (a, b) in enumerate(skf.split(np.zeros(len(rest)), ys_rest)):
            tr, va = [rest[i] for i in a], [rest[i] for i in b]
            model, T, log, _ = train_cnn(tr, va, args, torch, device, tag=f"[fold {k + 1}/{args.kfold}]")
            logs += log
            pv = torch.softmax(predict_logits(model, loader(va, eval_tf, torch, args.batch), torch, device) / T, 1).numpy()
            fs = score(pv, np.array([it[1] for it in va])); fold_scores.append(fs)
            print("  fold %d validation: acc %.3f  macro-F1 %.3f" % (k + 1, fs["accuracy"], fs["macro_f1"]))
            test_probs.append(torch.softmax(predict_logits(model, tel, torch, device) / T, 1).numpy())
            torch.save({"state_dict": model.state_dict(), "temperature": T, "arch": args.arch, "img": img}, os.path.join(OUT, f"fold{k + 1}.pt"))
            if k == 0:
                first = (model, T)
        accs = np.array([f["accuracy"] for f in fold_scores]); f1s = np.array([f["macro_f1"] for f in fold_scores])
        extra["cv"] = {"folds": fold_scores, "acc_mean": round(float(accs.mean()), 4), "acc_std": round(float(accs.std()), 4),
                       "f1_mean": round(float(f1s.mean()), 4), "f1_std": round(float(f1s.std()), 4)}
        for k, p in enumerate(test_probs):
            comparison[f"Fold {k + 1} model"] = {"test": score(p, yt)}
        ens = np.mean(test_probs, axis=0)
        comparison["%d-fold ensemble" % args.kfold] = {"test": score(ens, yt)}
        best, probs_t = "%d-fold ensemble" % args.kfold, ens
        model, T = first
        print("\nCross-validation: accuracy %.1f%% +/- %.1f%%   macro-F1 %.3f +/- %.3f   (%d folds)" % (
            100 * accs.mean(), 100 * accs.std(), f1s.mean(), f1s.std(), args.kfold))
        heads_obj = None
    else:
        va, tr = strat_split(rest, 0.1765, seed=43)        # ~15% of all images for validation
        model, T, log, _ = train_cnn(tr, va, args, torch, device)
        logs += log
        val = loader(va, eval_tf, torch, args.batch); yv = np.array([it[1] for it in va])
        cand_val = {"CNN (temperature-scaled)": torch.softmax(predict_logits(model, val, torch, device) / T, 1).numpy()}
        cand_test = {"CNN (temperature-scaled)": torch.softmax(predict_logits(model, tel, torch, device) / T, 1).numpy()}
        print("\nExtracting CNN features for XGBoost / LogReg / SVM heads ...")
        Ftr = embed(model, loader(tr, eval_tf, torch, args.batch), torch, device)
        Fva, Fte = embed(model, val, torch, device), embed(model, tel, torch, device)
        ytr = np.array([it[1] for it in tr]); heads = {}
        for name, h in make_heads().items():
            try:
                h.fit(Ftr, ytr); heads[name] = h
                cand_val[name], cand_test[name] = h.predict_proba(Fva), h.predict_proba(Fte)
            except Exception as e:
                print("  skipped %s: %s" % (name, e))
        cand_val["Ensemble (average)"] = np.mean(list(cand_val.values()), axis=0)
        cand_test["Ensemble (average)"] = np.mean(list(cand_test.values()), axis=0)
        comparison = {n: {"val": score(cand_val[n], yv), "test": score(cand_test[n], yt)} for n in cand_val}
        best = max(comparison, key=lambda n: (comparison[n]["val"]["macro_f1"], -comparison[n]["val"]["ece"]))
        probs_t = cand_test[best]
        heads_obj = {"choice": best, "heads": heads}
        extra["split"] = {"train": len(tr), "val": len(va), "test": len(te)}

    # ---- report ----
    from sklearn.metrics import accuracy_score, classification_report, confusion_matrix
    print("\n%-26s | %-20s | %s" % ("model", "VALIDATION acc / F1", "TEST acc / F1 / log-loss / ECE"))
    for n, c in comparison.items():
        v, t = c.get("val"), c["test"]
        vs = "%6.3f / %6.3f" % (v["accuracy"], v["macro_f1"]) if v else "   (cross-val)  "
        print("%-26s | %-20s | %6.3f / %6.3f / %6.3f / %5.3f%s" % (n, vs, t["accuracy"], t["macro_f1"], t["log_loss"], t["ece"], "  <- chosen" if n == best else ""))
    ps, ys = probs_t.argmax(1).tolist(), yt.tolist()
    rep = classification_report(ys, ps, labels=list(range(len(CLASSES))), target_names=CLASSES, output_dict=True, zero_division=0)
    cm = confusion_matrix(ys, ps, labels=list(range(len(CLASSES))))
    conf = probs_t.max(1); hi = conf >= 0.7
    acc_hi = float((probs_t.argmax(1)[hi] == yt[hi]).mean()) if hi.any() else None
    metrics = dict(extra, **{
        "mode": "strong" if args.kfold > 1 else "quick", "arch": args.arch, "img": img,
        "chosen_model": best, "model_comparison": comparison,
        "test_images": len(ys), "test_accuracy": round(accuracy_score(ys, ps), 4),
        "test_macro_f1": round(rep["macro avg"]["f1-score"], 4), "test_ece": comparison[best]["test"]["ece"],
        "per_class": {c: {k: round(rep[c][k], 4) for k in ("precision", "recall", "f1-score", "support")} for c in CLASSES},
        "confusion_matrix": cm.tolist(), "classes": CLASSES, "temperature": T,
        "confident_share": round(float(hi.mean()), 4), "accuracy_when_confident": None if acc_hi is None else round(acc_hi, 4),
        "device": str(device),
        "note": "Test set held out from all training and model choice. Random image-level split: if several images come from the same patient, scores are optimistic.",
    })
    torch.save({"state_dict": model.state_dict(), "classes": CLASSES, "temperature": T, "img": img, "arch": args.arch, "metrics": metrics},
               os.path.join(OUT, "model.pt"))
    hp = os.path.join(OUT, "heads.joblib")
    if heads_obj:
        import joblib
        joblib.dump(heads_obj, hp)
    elif os.path.exists(hp):
        os.remove(hp)
    json.dump(metrics, open(os.path.join(OUT, "metrics.json"), "w"), indent=1)
    import csv
    with open(os.path.join(OUT, "training_log.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(logs[0].keys())); w.writeheader(); w.writerows(logs)
    try:
        import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
        fig, ax = plt.subplots(figsize=(5.4, 4.6)); ax.imshow(cm, cmap="Greens")
        ax.set_xticks(range(len(CLASSES))); ax.set_xticklabels(CLASSES); ax.set_yticks(range(len(CLASSES))); ax.set_yticklabels(CLASSES)
        ax.set_xlabel("Predicted"); ax.set_ylabel("True")
        title = "%s · test acc %.1f%%" % (best, 100 * metrics["test_accuracy"])
        if "cv" in metrics:
            title += "\nCV %.1f%% ± %.1f%%" % (100 * metrics["cv"]["acc_mean"], 100 * metrics["cv"]["acc_std"])
        ax.set_title(title, fontsize=10)
        for i in range(len(CLASSES)):
            for j in range(len(CLASSES)):
                ax.text(j, i, cm[i, j], ha="center", va="center")
        fig.tight_layout(); fig.savefig(os.path.join(OUT, "confusion_matrix.png"), dpi=140)
    except Exception as e:
        print("(no confusion matrix image:", e, ")")
    print("\n================ TEST RESULTS (untouched test set) ================")
    print("Chosen: %s" % best)
    if "cv" in metrics:
        print("Cross-validation accuracy: %.1f%% +/- %.1f%%" % (100 * metrics["cv"]["acc_mean"], 100 * metrics["cv"]["acc_std"]))
    print("Test accuracy: %.1f%%   macro-F1: %.3f   calibration error (ECE): %.3f   (%d unseen images)" % (
        100 * metrics["test_accuracy"], metrics["test_macro_f1"], metrics["test_ece"], len(ys)))
    for c in CLASSES:
        r = metrics["per_class"][c]
        print("  %-4s precision %.2f  recall %.2f  F1 %.2f  (n=%d)" % (c, r["precision"], r["recall"], r["f1-score"], r["support"]))
    print("Confusion matrix (rows = true):", CLASSES)
    for i, row in enumerate(cm.tolist()):
        print("  ", CLASSES[i], row)
    if acc_hi is not None:
        print("When confidence >= 70%% (%.0f%% of cases): accuracy %.1f%%" % (100 * metrics["confident_share"], 100 * acc_hi))
    last = logs[-1]
    if last["train_acc"] < 0.8:
        print("NOTE: training accuracy is only %.0f%% -> the model may be UNDERFITTING (try --strong)." % (100 * last["train_acc"]))
    elif last["train_acc"] - metrics["test_accuracy"] > 0.15:
        print("NOTE: train %.0f%% vs test %.0f%% -> some OVERFITTING." % (100 * last["train_acc"], 100 * metrics["test_accuracy"]))
    if metrics["test_accuracy"] > 0.985:
        print("NOTE: near-perfect test score -> check for near-duplicate slices of the same patient across splits.")
    print("Saved to", OUT)


# ---------------- inference (used by the web app) ----------------
_cache = {}


def available():
    try:
        import torch  # noqa
        return os.path.exists(os.path.join(OUT, "model.pt"))
    except Exception:
        return False


def _load():
    if "m" in _cache:
        return _cache["m"]
    torch, _ = _torch()
    ck = torch.load(os.path.join(OUT, "model.pt"), map_location="cpu", weights_only=False)
    arch = ck.get("arch", "efficientnet_b0")
    m = build_model(arch, torch, pretrained=False); m.load_state_dict(ck["state_dict"]); m.eval()
    ck["folds"] = []
    for f in sorted(os.listdir(OUT)):
        if f.startswith("fold") and f.endswith(".pt"):
            fk = torch.load(os.path.join(OUT, f), map_location="cpu", weights_only=False)
            fm = build_model(fk["arch"], torch, pretrained=False); fm.load_state_dict(fk["state_dict"]); fm.eval()
            ck["folds"].append((fm, fk["temperature"]))
    hp = os.path.join(OUT, "heads.joblib")
    if os.path.exists(hp):
        try:
            import joblib
            ck["heads"] = joblib.load(hp)
        except Exception as e:
            print("heads not loaded, using CNN only:", e)
    _cache["m"] = (m, ck)
    return _cache["m"]


def predict(image_bytes):
    import numpy as np
    torch, _ = _torch()
    from PIL import Image
    from torchvision import transforms as Tr
    m, ck = _load()
    img_size = ck.get("img", 224)
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    tf = Tr.Compose([Tr.Grayscale(3), Tr.Resize((img_size, img_size)), Tr.ToTensor(), Tr.Normalize(MEAN, STD)])
    x = tf(img).unsqueeze(0)

    feats = {}
    h1 = m.features[-1].register_forward_hook(lambda mod, i, o: feats.__setitem__("a", o))
    h2 = m.features[-1].register_full_backward_hook(lambda mod, gi, go: feats.__setitem__("g", go[0]))
    logits = m(x)
    avg = (logits.detach() + m(torch.flip(x, dims=[3])).detach()) / 2
    probs = torch.softmax(avg / ck["temperature"], 1)[0].numpy()
    used = "CNN (temperature-scaled)"
    if ck["folds"]:
        with torch.no_grad():
            ps = [torch.softmax(((fm(x) + fm(torch.flip(x, dims=[3]))) / 2) / T, 1)[0].numpy() for fm, T in ck["folds"]]
        probs, used = np.mean(ps, axis=0), "%d-fold ensemble" % len(ps)
    elif ck.get("heads") and ck["heads"]["choice"] != used:
        H = ck["heads"]
        with torch.no_grad():
            feat = ((features_of(m, x, torch) + features_of(m, torch.flip(x, dims=[3]), torch)) / 2).numpy()
        hp = {n: h.predict_proba(feat)[0] for n, h in H["heads"].items()}
        probs = np.mean([probs] + list(hp.values()), axis=0) if H["choice"].startswith("Ensemble") else hp.get(H["choice"], probs)
        used = H["choice"]
    probs = probs / probs.sum()
    k = int(probs.argmax())
    m.zero_grad(); logits[0, k].backward()
    h1.remove(); h2.remove()
    a, g = feats["a"][0], feats["g"][0]
    cam = torch.relu((g.mean((1, 2), keepdim=True) * a).sum(0)); cam = cam / (cam.max() + 1e-8)
    heat = _overlay(img, cam.detach().numpy(), img_size)
    p = {c: float(probs[i]) for i, c in enumerate(ck["classes"])}
    top = sorted(p.items(), key=lambda kv: -kv[1])
    ent = float(-(probs * np.log(probs + 1e-9)).sum() / np.log(len(p)))
    met = ck["metrics"]
    return {"stage": top[0][0], "prob": top[0][1], "second": top[1][0], "second_prob": top[1][1],
            "probs": p, "uncertainty": round(ent, 3), "heatmap": heat, "model_used": used,
            "test_accuracy": met["test_accuracy"], "test_macro_f1": met["test_macro_f1"],
            "cv": met.get("cv", {}).get("acc_mean"), "cv_std": met.get("cv", {}).get("acc_std")}


def _overlay(img, cam, size):
    import numpy as np
    from PIL import Image
    base = img.convert("RGB").resize((size * 2, size * 2))
    c = Image.fromarray((cam * 255).astype("uint8")).resize(base.size, Image.BILINEAR)
    c = np.asarray(c, dtype=np.float32) / 255.0
    r = np.clip(1.5 - abs(4 * c - 3), 0, 1); g = np.clip(1.5 - abs(4 * c - 2), 0, 1); b = np.clip(1.5 - abs(4 * c - 1), 0, 1)
    jet = (np.stack([r, g, b], -1) * 255).astype("uint8")
    base_a = np.asarray(base, dtype=np.float32)
    out = (base_a * 0.55 + jet * 0.45 * c[..., None] + base_a * 0.45 * (1 - c[..., None])).clip(0, 255).astype("uint8")
    buf = io.BytesIO(); Image.fromarray(out).save(buf, format="JPEG", quality=85)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["train"])
    ap.add_argument("--images", required=True)
    ap.add_argument("--csv", default=None)
    ap.add_argument("--strong", action="store_true", help="EfficientNet-B2 @288, 25 epochs, 5-fold CV ensemble")
    ap.add_argument("--arch", default=None, choices=list(ARCHS))
    ap.add_argument("--kfold", type=int, default=None)
    ap.add_argument("--epochs", type=int, default=None)
    ap.add_argument("--head-epochs", type=int, default=3)
    ap.add_argument("--batch", type=int, default=None)
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--patience", type=int, default=None)
    ap.add_argument("--scratch", action="store_true")
    a = ap.parse_args()
    if a.strong:
        a.arch, a.kfold = a.arch or "efficientnet_b2", a.kfold or 5
        a.epochs, a.batch, a.patience = a.epochs or 25, a.batch or 16, a.patience or 6
    a.arch, a.kfold = a.arch or "efficientnet_b0", a.kfold or 1
    a.epochs, a.batch, a.patience = a.epochs or 14, a.batch or 32, a.patience or 5
    train(a)
