# ============================================================================
# Do boosted trees rank an email's candidates better than the conditional logit's weight table?
# Same options, folds and right/wrong rule as scripts/gold/weights.mts, which exports them.
# ----------------------------------------------------------------------------
# One row per option (each candidate, and "none of these"): every family's level as a category,
# how many of the email's candidates share that level, and the email's context. A tree scores
# rows one at a time, so the scores are normalised over each email to compare with the logit.
# Measured 23 Oct (gold v1, 1,522 emails): 92.8 to 93.2% right against the logit's 94.3%, and at
# 0.95 it decided 38 to 45% of emails against 70.5%. The logit's one softmax per email is the
# structure the problem has; trees scoring rows apart do not see the rivals.
#
#   npx tsx scripts/gold/weights.mts --export .tmp-data/gold/rank-rows.jsonl
#   python scripts/gold/trees.py .tmp-data/gold/rank-rows.jsonl [--measure]
# ============================================================================
import json, math, subprocess, sys
import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier

rows = [json.loads(l) for l in open(sys.argv[1], encoding="utf8")]
fams = ["reference", "person", "precedent", "company", "time", "coverage", "size", "place", "subject", "thread", "state", "age"]
levels = {f: sorted({r["cmp"][f] for r in rows if r["cmp"] and r["cmp"][f] is not None}) for f in fams}
by_email = {}
for i, r in enumerate(rows):
    by_email.setdefault(r["e"], []).append(i)
X = np.full((len(rows), len(fams) * 2 + 4), np.nan)
for e, ix in by_email.items():
    for k, f in enumerate(fams):
        vals = [rows[i]["cmp"][f] if rows[i]["cmp"] else None for i in ix]
        for i, v in zip(ix, vals):
            X[i, k] = levels[f].index(v) if v is not None else np.nan
            X[i, len(fams) + k] = vals.count(v) if v is not None else 0
for i, r in enumerate(rows):
    X[i, -4:] = [r["none"], r["asks_new"], r["density"], r["n"]]
cat = [True] * len(fams) + [False] * (len(fams) + 4)
y = np.array([r["good"] for r in rows])
fold = np.array([r["fold"] for r in rows])


def wilson(k, n, z=1.96):
    if not n:
        return 0
    p = k / n
    d, c = 1 + z * z / n, p + z * z / (2 * n)
    return (c - z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d


runs = []
for lr, it, leaf in [(0.05, 300, 20), (0.05, 600, 20), (0.03, 600, 40)]:
    p = np.zeros(len(rows))
    for k in range(5):
        tr, te = fold != k, fold == k
        m = HistGradientBoostingClassifier(learning_rate=lr, max_iter=it, min_samples_leaf=leaf, l2_regularization=1.0, categorical_features=cat, random_state=0)
        m.fit(X[tr], y[tr])
        p[te] = m.predict_proba(X[te])[:, 1]
    res, ll = [], 0.0
    for ix in by_email.values():
        q = p[ix] / p[ix].sum()
        ll += math.log(max(sum(q[j] for j, i in enumerate(ix) if rows[i]["good"]), 1e-9))
        i = ix[int(np.argmax(q))]
        res.append((rows[i]["ok"] == 1, float(q.max()), not rows[i]["none"] and rows[i]["ok"] != 1))
    n, right = len(res), sum(r[0] for r in res)
    coverage = []
    for t in [0.9, 0.95, 0.99]:
        a = [r for r in res if r[1] >= t]
        k2 = sum(r[0] for r in a)
        coverage.append({"threshold": t, "coverage": round(len(a) / n, 3), "accuracy": round(k2 / max(1, len(a)), 4), "lower95": round(wilson(k2, len(a)), 4), "wrong_links": sum(r[2] for r in a)})
    runs.append({"learning_rate": lr, "iters": it, "min_leaf": leaf, "log_loss": round(-ll / n, 4), "right": right, "of": n, "wrong_links": sum(r[2] for r in res), "coverage": coverage})
    print(f"trees lr {lr} iters {it} leaf {leaf}: log-loss {-ll / n:.4f}; right {right}/{n} ({100 * right / n:.1f}%); " + "; ".join(f"{c['threshold']}: {100 * c['coverage']:.1f}% at {100 * c['accuracy']:.2f}%" for c in coverage))

if "--measure" in sys.argv:
    entry = {"dataset": f"gold set v1 firm labels: {len(by_email)} emails, {len(rows)} options, 5-fold by thread", "instrument": "scripts/gold/trees.py (sklearn HistGradientBoosting, scores normalised per email)", "denominator": "as matcher_score_alone", "runs": runs}
    subprocess.run(["node", "-e", "import('./scripts/_gateMeasure.mjs').then(m => m.recordMeasurement('matcher_rank_trees', JSON.parse(process.argv[1])))", json.dumps(entry)], check=True)
