#!/usr/bin/env python3
"""Independently audit preliminary SMTBMC process evidence and every CSV column."""

import argparse
import csv
import hashlib
import io
import json
import math
from pathlib import Path
import re


COLUMNS = "solver case phase nativeElapsedMs pyodideElapsedMs nativeExitCode pyodideExitCode status modelSha256 solverSha256 nativeStdoutSha256 pyodideStdoutSha256 error".split()
CASES = {"bmc-prefix": ["bmc"], "bmc-violation": ["bmc"], "prove-inconclusive": ["basecase", "induction"],
         "prove-invariant": ["basecase", "induction"], "cover-reached": ["cover"], "cover-unreached": ["cover"]}


def require(condition, detail):
    if not condition:
        raise ValueError(detail)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def normalize(data):
    return re.sub(rb"^##\s+\d+:\d\d:\d\d\s+", b"## TIME ", data, flags=re.M)


def cell(value):
    return "" if value is None else str(value)


def audit(directory):
    directory = Path(directory)
    def read(name):
        path = Path(name)
        require(not path.is_absolute() and all(p not in [".", ".."] for p in path.parts), "unsafe evidence path")
        require(not (directory / path).is_symlink(), "symlink evidence")
        return (directory / name).read_bytes()
    def data(name):
        return json.loads(read(name))
    meta = data("metadata-final.json")
    start = data("metadata.json")
    require(type(meta["format"]) is int and meta["format"] == 1 and meta["preliminary"] is True, "preliminary evidence format")
    for key in start:
        if key not in ["probes", "models"]:
            require(meta[key] == start[key], f"changed metadata: {key}")
    require(re.fullmatch(r"[a-f0-9]{40}", meta["baseCommit"]) is not None, "harness commit")
    for key in ["node", "python", "pyodide"]:
        require(bool(meta[key]), f"runtime version: {key}")
    require(meta["snapshots"]["scripts/probe-formal-python-engine.mjs"] == meta["scriptSha256"], "script snapshot")
    for name, sha in meta["snapshots"].items():
        require(digest(read("snapshots/" + name)) == sha, f"source snapshot: {name}")
    require(data("assets/manifest.json") == meta["sources"], "asset manifest")
    assets = meta["sources"]["assets"]
    require(len({asset["path"] for asset in assets}) == len(assets), "duplicate source asset")
    for asset in assets:
        raw = read("assets/" + asset["path"])
        require(len(raw) == asset["size"] and digest(raw) == asset["sha256"], "source asset hash")
    require(set(meta["probes"]) == {f"{s}-{r}" for s in ["yices2", "z3"] for r in ["native", "wasi"]}, "solver set")
    for label, info in meta["probes"].items():
        require(digest(read(label + "-build.json")) == info["metadataSha256"], "solver build hash")
        build = data(label + "-build.json")
        require(build["status"] == "built" and build["worktree_status"] == "", "clean successful build")
        require(build["artifact"]["sha256"] == info["binarySha256"], "solver binary hash")
        require(read(label + "-version.log").decode() == info["version"] and info["version"].strip(), "actual solver version")
        require(build["source"]["version"].removeprefix("yices-").removeprefix("z3-") in info["version"], "solver version pin")
    reader = csv.DictReader(io.StringIO(read("results.csv").decode()), strict=True)
    require(reader.fieldnames == COLUMNS, "CSV columns")
    csv_rows = list(reader)
    result = data("results.json")
    require(result["preliminary"] is True, "result mode")
    rows = result["rows"]
    require(len(rows) == len(csv_rows) == 16, "complete row count")
    identities = set()
    for row, csv_row in zip(rows, csv_rows, strict=True):
        identity = (row["solver"], row["case"], row["phase"])
        require(identity not in identities, "duplicated condition")
        identities.add(identity)
        require(identity[0] in ["yices2", "z3"] and identity[1] in CASES and identity[2] in CASES[identity[1]], "unknown condition")
        label = "-".join(identity)
        def child_read(name):
            return read(label + "/" + name)
        def child_data(name):
            return json.loads(child_read(name))
        require(row == child_data("result.json"), "row snapshot")
        native, transport = child_data("native.json"), child_data("transport.json")
        expected = int(row["case"] in ["bmc-violation", "cover-unreached"] or
                       (row["case"] == "prove-inconclusive" and row["phase"] == "induction"))
        require(native["error"] is None and native["signal"] is None and type(native["exitCode"]) is int and native["exitCode"] == expected, "native termination")
        require(transport["status"] == "exited" and type(transport["exitCode"]) is int and transport["exitCode"] == expected and transport["integrityVerified"] is True, "Python termination")
        require(len(transport["children"]) == 1 and row["children"] == transport["children"], "child count")
        solver = transport["children"][0]
        require(solver["status"] == "exited" and type(solver["exitCode"]) is int and solver["exitCode"] == 0 and solver["integrityVerified"] is True, "solver termination")
        solver_sha = meta["probes"][row["solver"] + "-wasi"]["binarySha256"]
        require(solver["sha256"] == solver_sha, "executed solver hash")
        for elapsed in [native["elapsedMs"], transport["elapsedMs"]]:
            require(type(elapsed) in [int, float] and math.isfinite(elapsed) and elapsed > 0, "elapsed time")
        native_out, python_out = child_read("native.stdout.log"), child_read("pyodide.stdout.log")
        require(normalize(native_out) == normalize(python_out), "SMTBMC stdout")
        require(python_out.endswith(b"Status: " + (b"FAILED" if expected else b"PASSED") + b"\n"), "SMTBMC status")
        require(child_read("native.stderr.log") == child_read("pyodide.stderr.log") == b"", "SMTBMC stderr")
        trace = row["case"] in ["bmc-violation", "cover-reached"] or (row["case"] == "prove-inconclusive" and row["phase"] == "induction")
        names = ["model.smt2", "top.v"] + (["trace.vcd", "trace.yw", "trace_tb.v"] if trace else [])
        require(sorted(p.name for p in (directory / label / "native").iterdir()) == names, "native artifact set")
        require([f["path"] for f in row["files"]] == names, "returned artifact set")
        for file in row["files"]:
            raw = child_read("native/" + file["path"])
            require(raw == child_read("pyodide-" + file["path"]), "returned artifact bytes")
            require(digest(raw) == file["sha256"] and len(raw) == file["bytes"] and len(raw) > 0, "artifact metadata")
        model_sha = digest(child_read("native/model.smt2"))
        require(model_sha == meta["models"][row["solver"] + "-" + row["case"]], "baseline SMT model")
        derived = {"solver": identity[0], "case": identity[1], "phase": identity[2],
                   "nativeElapsedMs": native["elapsedMs"], "pyodideElapsedMs": transport["elapsedMs"],
                   "nativeExitCode": expected, "pyodideExitCode": expected, "status": "exited",
                   "modelSha256": model_sha, "solverSha256": solver_sha,
                   "nativeStdoutSha256": digest(native_out), "pyodideStdoutSha256": digest(python_out), "error": ""}
        require({key: cell(derived[key]) for key in COLUMNS} == csv_row, "CSV raw evidence")
        require(all(cell(row.get(key)) == cell(derived[key]) for key in COLUMNS), "JSON raw evidence")
    return {"status": "pass", "preliminary": True, "rows": len(rows), "columns": len(COLUMNS)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    args = parser.parse_args()
    print(json.dumps(audit(args.directory), sort_keys=True))
