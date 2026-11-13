"""Eight alternating CPU pairs under the T8959 bench lease; no recording."""
import datetime
import json
import os
from pathlib import Path
import statistics
import subprocess
import time

app = Path(__file__).resolve().parents[1]
out = app.parent / "docs/brand/kiwi-cat/caretas/desempenho"
out.mkdir(exist_ok=True)
head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=app, text=True).strip()
summary = {"task": "T8959", "measuredCommit": head, "loadLimit": 2,
           "cpuUnit": "percent of one core", "pairs": [],
           "criterion": "median delta <= 0.5 and at least 6 of 8 deltas <= 0.5"}

def save():
    deltas = [pair["delta"] for pair in summary["pairs"]]
    if deltas:
        summary.update(medianDelta=statistics.median(deltas), minDelta=min(deltas),
                       maxDelta=max(deltas), pairsWithinLimit=sum(v <= .5 for v in deltas))
        summary["passes"] = len(deltas) == 8 and summary["medianDelta"] <= .5 and summary["pairsWithinLimit"] >= 6
    (out / "serie-8-pares.json").write_text(json.dumps(summary, indent=2) + "\n")

for number in range(1, 9):
    while os.getloadavg()[0] >= 2:
        print(f"WAIT pair {number}: load1={os.getloadavg()[0]:.3f} (need <2)", flush=True)
        time.sleep(45)
    if subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=app, text=True).strip() != head:
        raise RuntimeError("Head changed during the frozen series")
    pair = {"pair": number, "startedUTC": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "initialLoad": list(os.getloadavg()),
            "uptimeAtStart": subprocess.check_output(["uptime"], text=True).strip(),
            "order": ["fog", "faces"] if number % 2 else ["faces", "fog"]}
    print("START " + json.dumps(pair), flush=True)
    for variant in pair["order"]:
        destination = out / f"par-{number}-{variant}"
        command = ["bun", "scripts/kiwicat-face-bench.ts", str(destination), "2", "--cpu-only"]
        if variant == "fog":
            command += ["--fog-only"]
        with (out / f"par-{number}-{variant}.log").open("w") as log:
            subprocess.run(command, cwd=app, stdout=log, stderr=subprocess.STDOUT, check=True)
        report = json.loads((destination / "report.json").read_text())
        if report["measuredCommit"] != head or report.get("errors"):
            raise RuntimeError("Invalid probe report")
        pair[variant] = report["cpuMean"]
        print(f"CPU pair {number} {variant}: {pair[variant]}", flush=True)
    pair["delta"] = pair["faces"] - pair["fog"]
    pair["finalLoad"] = list(os.getloadavg())
    summary["pairs"].append(pair)
    save()
    print("PAIR " + json.dumps(pair), flush=True)
print("FINAL " + json.dumps(summary), flush=True)
