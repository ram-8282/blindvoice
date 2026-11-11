"""Locate the best completed YOLO training run under ~/runs/detect.

"Best" = highest final-epoch mAP50-95 in results.csv among runs that have weights/best.pt.
Used by export_windows.py and merge_and_train.py so neither hardcodes a run folder.
"""
import csv
from pathlib import Path

RUNS_DIR = Path.home() / "runs" / "detect"


def find_best_run(runs_dir: Path = RUNS_DIR):
    """Return (weights_path, mAP50_95, run_name) or None if no completed run exists."""
    best = None
    for run in sorted(runs_dir.glob("*")):
        weights = run / "weights" / "best.pt"
        results = run / "results.csv"
        if not weights.exists() or not results.exists():
            continue
        with open(results, newline="") as f:
            rows = list(csv.DictReader(f))
        if not rows:
            continue
        last = {k.strip(): v for k, v in rows[-1].items()}
        try:
            score = float(last["metrics/mAP50-95(B)"])
        except (KeyError, ValueError):
            continue
        if best is None or score > best[1]:
            best = (weights, score, run.name)
    return best


if __name__ == "__main__":
    found = find_best_run()
    if found:
        print(f"Best run: {found[2]}  mAP50-95={found[1]:.4f}  weights={found[0]}")
    else:
        print(f"No completed runs found in {RUNS_DIR}")
