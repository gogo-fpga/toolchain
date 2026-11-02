#!/usr/bin/env python3
"""Build isolated formal solver diagnostics, without replacing product assets."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import platform
import re
import shlex
import shutil
import subprocess
import tarfile
import time

ROOT = Path(__file__).resolve().parents[1]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def pin(*arguments: str):
    return subprocess.check_output(
        ["python3", str(ROOT / ".github/scripts/check-pins.py"), *arguments], text=True
    ).strip()


def stage_source(name: str, expected: str, output: Path):
    source = ROOT / "vendor" / name
    if (source / ".git").exists():
        actual = subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip()
        if subprocess.check_output(["git", "-C", str(source), "status", "--porcelain"], text=True).strip():
            raise ValueError(f"Modified upstream source: {name}")
        archive = subprocess.check_output(["git", "-C", str(source), "archive", "HEAD"])
    else:
        actual = (source / ".gitcommit").read_text().strip()
    if actual != expected:
        raise ValueError(f"Upstream pin mismatch: {name}")
    if (source / ".git").exists():
        output.mkdir()
        with tarfile.open(fileobj=io.BytesIO(archive)) as entries:
            entries.extractall(output, filter="data")
    else:
        shutil.copytree(source, output, ignore=shutil.ignore_patterns(".git"), symlinks=True)
    (output / ".gitcommit").write_text(expected + "\n")


def setup_dependency(source: Path, name: str) -> dict[str, str]:
    text = (source / "contrib" / f"setup-{name}.sh").read_text()
    commits = re.findall(r'^COMMIT_ID="([0-9a-f]{40})"$', text, re.MULTILINE)
    urls = re.findall(r'download_github "([A-Za-z0-9_-]+/[A-Za-z0-9_-]+)" "\$COMMIT_ID"', text)
    if len(commits) != 1 or len(urls) != 1:
        raise ValueError(f"Unrecognized upstream dependency pin: {name}")
    return {"commit": commits[0], "url": f"https://github.com/{urls[0]}.git"}


def stage_dependency(name, dependency, output, metadata, run):
    repository = output / f"{name}-git"
    source = output / f"{name}-source"
    metadata.setdefault("dependencies", {})[name] = {**dependency}
    run(f"{name}-init", ["git", "init", "--bare", repository])
    run(f"{name}-fetch", ["git", "--git-dir", repository, "fetch", "--depth=1",
                          dependency["url"], dependency["commit"]])
    actual = subprocess.check_output(["git", "--git-dir", str(repository), "rev-parse", "FETCH_HEAD"], text=True).strip()
    if actual != dependency["commit"]:
        raise ValueError(f"Fetched upstream pin mismatch: {name}")
    archive = subprocess.check_output(["git", "--git-dir", str(repository), "archive", actual])
    archive_path = output / f"{name}-source.tar"
    archive_path.write_bytes(archive)
    source.mkdir()
    with tarfile.open(fileobj=io.BytesIO(archive)) as entries:
        entries.extractall(source, filter="data")
    licenses = sorted(p for p in source.iterdir() if p.name.startswith(("LICENSE", "COPYING")))
    if not licenses or any(not p.is_file() or p.is_symlink() or not p.stat().st_size for p in licenses):
        raise ValueError(f"Missing or unsafe dependency license: {name}")
    metadata["dependencies"][name].update(
        archive_sha256=digest(archive_path), licenses={p.name: digest(p) for p in licenses},
    )
    return source


def build_boolector(args, output, source, metadata, run, environment, compiler, compiler_cxx, c_flags, link_flags, sdk):
    metadata["cmake"] = subprocess.check_output([args.cmake, "--version"], text=True)
    cxx_flags = c_flags.replace(" -std=gnu17", "")
    if args.runtime == "native":
        cxx_flags = f"{cxx_flags} {args.cxx_flags}".strip()
        link_flags = args.cxx_link_flags
    environment = {**environment, "CC": compiler, "CXX": compiler_cxx,
                   "CFLAGS": c_flags, "CXXFLAGS": cxx_flags, "LDFLAGS": link_flags,
                   "GIT_CEILING_DIRECTORIES": str(output)}
    if args.runtime == "wasi":
        environment.update(AR=str(sdk / "bin/llvm-ar"), RANLIB=str(sdk / "bin/llvm-ranlib"))
    prefix = output / "dependencies"
    (prefix / "include").mkdir(parents=True)
    (prefix / "lib").mkdir()
    cadical = stage_dependency("cadical", setup_dependency(source, "cadical"), output, metadata, run)
    btor = stage_dependency("btor2tools", setup_dependency(source, "btor2tools"), output, metadata, run)
    run("cadical-configure", [cadical / "configure", "-O2"], cadical, environment)
    run("cadical-build", ["make", f"-j{args.jobs}", "libcadical.a"], cadical / "build", environment)
    shutil.copyfile(cadical / "build/libcadical.a", prefix / "lib/libcadical.a")
    shutil.copyfile(cadical / "src/ccadical.h", prefix / "include/ccadical.h")
    toolchain = [f"-DCMAKE_EXE_LINKER_FLAGS={link_flags}"]
    if args.runtime == "wasi":
        toolchain = [f"-DCMAKE_TOOLCHAIN_FILE={sdk}/share/cmake/wasi-sdk-p1.cmake",
                     f"-DCMAKE_EXE_LINKER_FLAGS={link_flags}",
                     "-DCMAKE_CXX_STANDARD_LIBRARIES=-lunwind -lsetjmp",
                     "-DCMAKE_CROSSCOMPILING_EMULATOR="]
    elif args.cxx_libraries:
        toolchain += [f"-DCMAKE_CXX_STANDARD_LIBRARIES={args.cxx_libraries}"]
    common = [*toolchain, f"-DCMAKE_C_COMPILER={compiler}", f"-DCMAKE_CXX_COMPILER={compiler_cxx}",
              f"-DCMAKE_C_FLAGS={c_flags}", f"-DCMAKE_CXX_FLAGS={environment['CXXFLAGS']}",
              "-DCMAKE_BUILD_TYPE=Release", "-DCMAKE_POLICY_VERSION_MINIMUM=3.5", "-DBUILD_SHARED_LIBS=OFF"]
    run("btor2tools-configure", [args.cmake, "-S", btor, "-B", output / "btor2tools-build", *common], env=environment)
    run("btor2tools-build", [args.cmake, "--build", output / "btor2tools-build", "--target", "btor2parser",
                            "--parallel", str(args.jobs)], env=environment)
    shutil.copyfile(output / "btor2tools-build/lib/libbtor2parser.a", prefix / "lib/libbtor2parser.a")
    shutil.copyfile(btor / "src/btor2parser/btor2parser.h", prefix / "include/btor2parser.h")
    run("configure", [args.cmake, "-S", source, "-B", output / "objects", *common,
                      f"-DCMAKE_PREFIX_PATH={prefix}", "-DONLY_CADICAL=ON", "-DUSE_GMP=OFF",
                      "-DPYTHON=OFF", "-DTESTING=OFF", "-DTIME_STATS=OFF",
                      "-DCMAKE_DISABLE_FIND_PACKAGE_Threads=TRUE"], env=environment)
    run("build", [args.cmake, "--build", output / "objects", "--target", "boolector-bin",
                  "--parallel", str(args.jobs)], env=environment)
    return output / "objects/bin/boolector"


def build(args):
    output = args.out.absolute()
    if output.exists() or output.is_symlink():
        raise ValueError("Diagnostic output already exists")
    output.mkdir(parents=True)
    metadata = {
        "format": 1, "purpose": __doc__, "solver": args.solver, "runtime": args.runtime,
        "script_sha256": digest(Path(__file__)), "commands": [], "patches": [],
        "status": "error", "started_unix": time.time(),
    }
    environment = {**os.environ, "LC_ALL": "C", "TZ": "UTC", "SOURCE_DATE_EPOCH": "0"}

    def run(label, command, cwd=output, env=None):
        if not label.replace("-", "").isalnum():
            raise ValueError("Invalid log label")
        record = {"label": label, "argv": [str(item) for item in command], "cwd": str(cwd)}
        selected_env = env or environment
        record["environment"] = {key: selected_env[key] for key in (
            "CC", "CXX", "AR", "RANLIB", "STRIP", "CPPFLAGS", "CFLAGS", "CXXFLAGS",
            "LDFLAGS", "LIBS", "LC_ALL", "TZ", "SOURCE_DATE_EPOCH",
            "GIT_CEILING_DIRECTORIES",
        ) if key in selected_env}
        metadata["commands"].append(record)
        (output / "metadata.json").write_text(json.dumps(metadata, indent=2) + "\n")
        with (output / f"{label}.log").open("x") as log:
            log.write(shlex.join(record["argv"]) + "\n")
            log.flush()
            start = time.monotonic()
            result = subprocess.run(record["argv"], cwd=cwd, env=selected_env,
                                    stdout=log, stderr=log, check=False)
            record.update(exit_status=result.returncode, elapsed_seconds=time.monotonic() - start)
            record["log_sha256"] = digest(output / f"{label}.log")
            result.check_returncode()

    try:
        solver_pin = json.loads(pin("formal-pins"))[args.solver]
        metadata["source"] = solver_pin
        metadata["base_commit"] = subprocess.check_output(["git", "-C", str(ROOT), "rev-parse", "HEAD"], text=True).strip()
        metadata["worktree_status"] = subprocess.check_output(["git", "-C", str(ROOT), "status", "--porcelain"], text=True)
        source = output / "source"
        stage_source(args.solver, solver_pin["commit"], source)
        for index, patch_name in enumerate(args.patch or []):
            patch = patch_name.resolve()
            metadata["patches"].append({"path": str(patch_name), "sha256": digest(patch)})
            run(f"patch-{index}", ["patch", "--batch", "--fuzz=0", "-p1", "-i", patch], cwd=source)
        c_flags = "-O2 -DNDEBUG -std=gnu17"
        link_flags = ""
        compiler = os.environ.get("CC", "gcc")
        compiler_cxx = os.environ.get("CXX", "g++")
        sdk = None
        if args.runtime == "wasi":
            version, archive_hash, asset, _url = pin("wasi-sdk-pin").split("\t")
            sdk = (ROOT / "build" / asset.removesuffix(".tar.gz")).resolve()
            archive = ROOT / "build/cache" / asset
            if digest(archive) != archive_hash or not (sdk / "bin/clang").is_file():
                raise ValueError("Missing or mismatched pinned WASI SDK")
            metadata["wasi_sdk"] = {"version": version, "archive_sha256": archive_hash}
            compiler = str(sdk / "bin/clang")
            compiler_cxx = str(sdk / "bin/clang++")
            c_flags += " -fwasm-exceptions -mllvm -wasm-enable-sjlj"
            c_flags += " -D_WASI_EMULATED_SIGNAL -D_WASI_EMULATED_PROCESS_CLOCKS -D_WASI_EMULATED_MMAN"
            link_flags = "-lwasi-emulated-signal -lwasi-emulated-process-clocks -lwasi-emulated-mman"
            link_flags += " -Wl,-z,stack-size=8388608 -Wl,--initial-memory=33554432 -Wl,--max-memory=536870912"
        metadata["compiler"] = subprocess.check_output([compiler, "--version"], text=True)
        if args.solver != "yices2":
            metadata["compiler_cxx"] = subprocess.check_output([compiler_cxx, "--version"], text=True)
        metadata["host"] = {"os": os.uname().sysname, "release": os.uname().release,
                            "machine": os.uname().machine, "cpus": os.cpu_count(),
                            "distribution": platform.freedesktop_os_release()}
        if args.solver == "z3":
            metadata["cmake"] = subprocess.check_output([args.cmake, "--version"], text=True)
            command = [args.cmake, "-S", source, "-B", output / "objects", "-DCMAKE_BUILD_TYPE=Release",
                       "-DBUILD_SHARED_LIBS=OFF", "-DZ3_SINGLE_THREADED=ON", "-DZ3_POLLING_TIMER=ON",
                       "-DZ3_USE_LIB_GMP=OFF", "-DZ3_BUILD_PYTHON_BINDINGS=OFF",
                       "-DZ3_BUILD_TEST_EXECUTABLES=OFF", "-DZ3_INCLUDE_GIT_HASH=OFF",
                       "-DZ3_INCLUDE_GIT_DESCRIBE=OFF", "-DCMAKE_CXX_FLAGS_RELEASE=-O2 -DNDEBUG"]
            if args.runtime == "wasi":
                cxx_flags = c_flags.replace(" -std=gnu17", "")
                command += [f"-DCMAKE_TOOLCHAIN_FILE={sdk}/share/cmake/wasi-sdk-p1.cmake",
                            f"-DCMAKE_CXX_FLAGS={cxx_flags}", f"-DCMAKE_EXE_LINKER_FLAGS={link_flags}",
                            "-DCMAKE_CXX_STANDARD_LIBRARIES=-lunwind -lsetjmp"]
            else:
                command += [f"-DCMAKE_CXX_COMPILER={compiler_cxx}",
                            f"-DCMAKE_CXX_FLAGS={args.cxx_flags}",
                            f"-DCMAKE_EXE_LINKER_FLAGS={args.cxx_link_flags}",
                            f"-DCMAKE_CXX_STANDARD_LIBRARIES={args.cxx_libraries}"]
            run("configure", command)
            run("build", [args.cmake, "--build", output / "objects", "--target", "shell", "--parallel", str(args.jobs)])
            binary = output / "objects/z3"
        elif args.solver == "boolector":
            binary = build_boolector(args, output, source, metadata, run, environment,
                                     compiler, compiler_cxx, c_flags, link_flags, sdk)
        else:
            gmp_version, gmp_hash, gmp_asset, _url = pin("archive-pin", "gmp").split("\t")
            archive = ROOT / "vendor/formal-archives" / gmp_asset
            if not archive.exists():
                archive = ROOT / "build/cache" / gmp_asset
            if digest(archive) != gmp_hash:
                raise ValueError("GMP archive pin mismatch")
            metadata["gmp"] = {"version": gmp_version, "archive_sha256": gmp_hash}
            gmp_source = output / "gmp-source"
            gmp_source.mkdir()
            run("gmp-extract", ["tar", "-xJf", archive, "--strip-components=1", "-C", gmp_source])
            gmp_build = output / "gmp-objects"
            gmp_build.mkdir()
            prefix = output / "gmp-install"
            env = {**environment, "CC": compiler, "CFLAGS": c_flags, "LDFLAGS": link_flags}
            command = [gmp_source / "configure", f"--prefix={prefix}", "--disable-shared",
                       "--enable-static", "--disable-assembly"]
            if args.runtime == "wasi":
                env.update(AR=str(sdk / "bin/llvm-ar"), RANLIB=str(sdk / "bin/llvm-ranlib"))
                command += ["--host=wasm32-unknown-wasi"]
            run("gmp-configure", command, gmp_build, env)
            run("gmp-build", ["make", f"-j{args.jobs}"], gmp_build, env)
            run("gmp-install", ["make", "install"], gmp_build, env)
            metadata["gmp"]["library_sha256"] = digest(prefix / "lib/libgmp.a")
            env["CPPFLAGS"] = f"-I{prefix}/include"
            env["LDFLAGS"] = f"-L{prefix}/lib {link_flags}".strip()
            if args.runtime == "wasi":
                env["STRIP"] = str(sdk / "bin/llvm-strip")
                env["LIBS"] = "-lsetjmp"
            run("autoconf", ["autoconf"], source)
            command = [source / "configure", f"--with-static-gmp={prefix}/lib/libgmp.a",
                       f"--with-static-gmp-include-dir={prefix}/include", "--disable-mcsat",
                       "--disable-thread-safety"]
            if args.runtime == "wasi":
                command += ["--host=wasm32-unknown-wasi"]
            run("configure", command, source, env)
            command = ["make", f"-j{args.jobs}"]
            if args.runtime == "wasi":
                command += ["ARCH=wasm32-unknown-wasi"]
            run("build", [*command, "static-bin"], source, env)
            matches = list(source.glob("build/*/static_bin/yices_smt2"))
            if len(matches) != 1:
                raise ValueError("Expected exactly one Yices SMT2 diagnostic binary")
            binary = matches[0]
        metadata["artifact"] = {"path": str(binary.relative_to(output)), "bytes": binary.stat().st_size,
                                "sha256": digest(binary)}
        if args.runtime == "native":
            run("version", [binary, "--version"])
        metadata["status"] = "built"
    except Exception as error:
        metadata["error"] = str(error)
        raise
    finally:
        metadata["elapsed_seconds"] = time.time() - metadata["started_unix"]
        (output / "metadata.json").write_text(json.dumps(metadata, indent=2) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--solver", choices=("yices2", "z3", "boolector"), required=True)
    parser.add_argument("--runtime", choices=("native", "wasi"), required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--cmake", default="cmake")
    parser.add_argument("--jobs", type=int, default=1)
    parser.add_argument("--patch", type=Path, action="append")
    parser.add_argument("--cxx-flags", default=os.environ.get("CXXFLAGS", ""))
    parser.add_argument("--cxx-link-flags", default="")
    parser.add_argument("--cxx-libraries", default="")
    args = parser.parse_args()
    if args.jobs < 1:
        parser.error("jobs must be positive")
    build(args)


if __name__ == "__main__":
    main()
