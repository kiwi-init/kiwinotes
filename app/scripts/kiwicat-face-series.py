"""T8959 final protocol: twelve alternating CPU pairs, all retained (Kiwi #9209)."""
import argparse
import datetime
import json
import os
from pathlib import Path
import statistics
import subprocess
import time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("out", type=Path, help="new output directory; never overwrite evidence")
args = parser.parse_args()
app = Path(__file__).resolve().parents[1]
out = args.out.resolve()
if out.exists() and any(out.iterdir()):
    parser.error("choose an empty output directory to preserve existing evidence")
out.mkdir(parents=True, exist_ok=True)
head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=app, text=True).strip()
summary = {"task": "T8959", "measuredCommit": head, "pairs": [],
           "criterion": "both all-pair and stable-load medians <= +0.5 point",
           "stableLoadVariation": 1.5, "maxLoadWaitSeconds": 300}
expected_source = None

def save():
    values = [pair["delta"] for pair in summary["pairs"]]
    stable = [pair["delta"] for pair in summary["pairs"] if pair["loadStable"]]
    summary.update(medianAll=statistics.median(values),
                   medianStable=statistics.median(stable) if stable else None,
                   stableCount=len(stable), minDelta=min(values), maxDelta=max(values))
    summary["range"] = max(values) - min(values)
    summary["passes"] = len(values) == 12 and bool(stable) and summary["medianAll"] <= .5 and summary["medianStable"] <= .5
    (out / "serie-12-pares.json").write_text(json.dumps(summary, indent=2) + "\n")

# Hold kiwi lock bench before running this script. No recorder or tests in parallel.
deadline = time.monotonic() + 300
while os.getloadavg()[0] >= 4 and time.monotonic() < deadline:
    print(f"WAIT load1={os.getloadavg()[0]:.3f}; max5min total", flush=True)
    time.sleep(min(45, max(0, deadline - time.monotonic())))
for number in range(1, 13):
    if subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=app, text=True).strip() != head:
        raise RuntimeError("Head changed during frozen series")
    pair = {"pair": number, "startedUTC": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "initialLoad": list(os.getloadavg()),
            "uptimeAtStart": subprocess.check_output(["uptime"], text=True).strip(),
            "order": ["fog", "faces"] if number % 2 else ["faces", "fog"],
            "loadSamples": [os.getloadavg()[0]]}
    print("START " + json.dumps(pair), flush=True)
    for variant in pair["order"]:
        destination = out / f"par-{number}-{variant}"
        command = ["bun", "scripts/kiwicat-face-bench.ts", str(destination), "2", "--cpu-only"]
        if variant == "fog":
            command += ["--fog-only"]
        with (out / f"par-{number}-{variant}.log").open("w") as log:
            process = subprocess.Popen(command, cwd=app, stdout=log, stderr=subprocess.STDOUT)
            while True:
                try:
                    process.wait(timeout=10)
                    break
                except subprocess.TimeoutExpired:
                    pair["loadSamples"].append(os.getloadavg()[0])
            if process.returncode:
                raise RuntimeError(f"Probe failed: {command}")
        pair["loadSamples"].append(os.getloadavg()[0])
        report = json.loads((destination / "report.json").read_text())
        if expected_source is None:
            expected_source = report["source_sha256"]
        if report["measuredCommit"] != head or report["source_sha256"] != expected_source or report.get("errors"):
            raise RuntimeError("Probe provenance mismatch")
        pair[variant] = report["cpuMean"]
    pair["delta"] = pair["faces"] - pair["fog"]
    pair["finalLoad"] = list(os.getloadavg())
    pair["loadVariation"] = max(pair["loadSamples"]) - min(pair["loadSamples"])
    pair["loadStable"] = pair["loadVariation"] <= 1.5
    summary["pairs"].append(pair)
    save()
    print("PAIR " + json.dumps(pair), flush=True)
print("FINAL " + json.dumps(summary), flush=True)
