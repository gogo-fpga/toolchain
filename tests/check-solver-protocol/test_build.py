import argparse
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import tarfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("solver_build", ROOT / "scripts/build-solver-probe.py")
BUILD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILD)


class BuildTest(unittest.TestCase):
    def test_upstream_setup_pin_is_literal_and_unique(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "contrib").mkdir()
            setup = root / "contrib/setup-cadical.sh"
            text = 'COMMIT_ID="' + '1' * 40 + '"\ndownload_github "upstream/cadical" "$COMMIT_ID" "$DEST"\n'
            setup.write_text(text)
            self.assertEqual(BUILD.setup_dependency(root, "cadical"), {
                "commit": "1" * 40, "url": "https://github.com/upstream/cadical.git",
            })
            for changed in (text.replace("1" * 40, "$REVISION"), text + text,
                            text.replace('"upstream/cadical"', '"$REPO"'), text.replace('"$COMMIT_ID"', '"main"')):
                with self.subTest(changed=changed):
                    setup.write_text(changed)
                    with self.assertRaisesRegex(ValueError, "Unrecognized"):
                        BUILD.setup_dependency(root, "cadical")

    def test_dependency_fetch_checks_commit_and_preserves_license_hash(self):
        archive = io.BytesIO()
        with tarfile.open(fileobj=archive, mode="w") as contents:
            member = tarfile.TarInfo("LICENSE")
            member.size = 3
            contents.addfile(member, io.BytesIO(b"MIT"))
        dependency = {"commit": "1" * 40, "url": "https://github.com/upstream/cadical.git"}
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp)
            records = []
            metadata = {}
            with patch.object(BUILD.subprocess, "check_output", side_effect=["1" * 40, archive.getvalue()]):
                source = BUILD.stage_dependency("cadical", dependency, output, metadata,
                                                lambda name, command: records.append((name, command)))
            self.assertIn("--depth=1", records[1][1])
            self.assertEqual((source / "LICENSE").read_bytes(), b"MIT")
            self.assertEqual(metadata["dependencies"]["cadical"]["licenses"]["LICENSE"],
                             hashlib.sha256(b"MIT").hexdigest())
            self.assertEqual(metadata["dependencies"]["cadical"]["archive_sha256"],
                             hashlib.sha256(archive.getvalue()).hexdigest())
        with tempfile.TemporaryDirectory() as temp, \
             patch.object(BUILD.subprocess, "check_output", return_value="2" * 40):
            with self.assertRaisesRegex(ValueError, "pin mismatch"):
                BUILD.stage_dependency("cadical", dependency, Path(temp), {}, lambda *_: None)

    def test_boolector_profile_uses_only_explicit_static_dependencies(self):
        for runtime in ("native", "wasi"):
            with self.subTest(runtime=runtime), tempfile.TemporaryDirectory() as temp:
                output = Path(temp)
                for name, files in {"cadical": ("build/libcadical.a", "src/ccadical.h"),
                                    "btor2tools": ("src/btor2parser/btor2parser.h",),
                                    "btor2tools-build": ("lib/libbtor2parser.a",)}.items():
                    for file in files:
                        path = output / name / file
                        path.parent.mkdir(parents=True, exist_ok=True)
                        path.write_bytes(b"fixture")
                commands = []
                args = argparse.Namespace(runtime=runtime, cmake="cmake", jobs=2,
                                          cxx_flags="-Ihost", cxx_link_flags="-Lhost", cxx_libraries="-lhost")
                with patch.object(BUILD.subprocess, "check_output", return_value="cmake fixture"), \
                     patch.object(BUILD, "setup_dependency", return_value={}), \
                     patch.object(BUILD, "stage_dependency", side_effect=lambda name, *_: output / name):
                    binary = BUILD.build_boolector(args, output, output / "source", {},
                        lambda label, command, *a, **kw: commands.append((label, command, kw)),
                        {}, "cc", "c++", "-O2 -std=gnu17", "-lsdk", output / "sdk")
                config = next(command for label, command, _ in commands if label == "configure")
                self.assertIn("-DONLY_CADICAL=ON", config)
                self.assertIn("-DUSE_GMP=OFF", config)
                self.assertIn("-DCMAKE_DISABLE_FIND_PACKAGE_Threads=TRUE", config)
                self.assertEqual(binary, output / "objects/bin/boolector")
                env = next(kw["env"] for label, _, kw in commands if label == "configure")
                self.assertEqual(env["GIT_CEILING_DIRECTORIES"], str(output))
                if runtime == "wasi":
                    self.assertIn("-DCMAKE_CXX_STANDARD_LIBRARIES=-lunwind -lsetjmp", config)
                    self.assertEqual(env["AR"], str(output / "sdk/bin/llvm-ar"))
                else:
                    self.assertIn("-DCMAKE_EXE_LINKER_FLAGS=-Lhost", config)
                    self.assertIn("-DCMAKE_CXX_STANDARD_LIBRARIES=-lhost", config)
                    self.assertIn("-Ihost", env["CXXFLAGS"])

    def run_build(self, runtime):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = Path(tmp.name)
        archive = root / "build/cache/fixture-sdk.tar.gz"
        archive.parent.mkdir(parents=True)
        archive.write_bytes(b"sdk")
        sdk = root / "build/fixture-sdk/bin"
        sdk.mkdir(parents=True)
        (sdk / "clang").touch()
        out = root / "probe"
        args = argparse.Namespace(out=out, solver="z3", runtime=runtime, patch=[], cmake="fixture-cmake", jobs=2,
                                  cxx_flags="-Ihost", cxx_link_flags="-Lhost", cxx_libraries="-lc++abi -lunwind")

        def pin(*argv):
            if argv == ("formal-pins",):
                return json.dumps({"z3": {"commit": "2" * 40}})
            self.assertEqual(argv, ("wasi-sdk-pin",))
            return "34\t" + hashlib.sha256(b"sdk").hexdigest() + "\tfixture-sdk.tar.gz\thttps://example.invalid"

        def output(argv, **_kwargs):
            if argv[-2:] == ["rev-parse", "HEAD"]:
                return "1" * 40
            if argv[-2:] == ["status", "--porcelain"]:
                return ""
            self.assertEqual(argv[-1], "--version")
            return "fixture version"

        def run(argv, **_kwargs):
            if "--build" in argv:
                (out / "objects").mkdir()
                (out / "objects/z3").write_bytes(b"\0asm\1\0\0\0")
            return subprocess.CompletedProcess(argv, 0)

        with patch.object(BUILD, "ROOT", root), patch.object(BUILD, "pin", side_effect=pin), \
             patch.object(BUILD, "stage_source", side_effect=lambda _n, _p, dest: dest.mkdir()), \
             patch.object(BUILD.subprocess, "check_output", side_effect=output), \
             patch.object(BUILD.subprocess, "run", side_effect=run):
            BUILD.build(args)
        return json.loads((out / "metadata.json").read_text())

    def test_wasi_uses_sdk_exception_libraries_and_actual_cmake_output_name(self):
        info = self.run_build("wasi")
        configure = next(c["argv"] for c in info["commands"] if c["label"] == "configure")
        self.assertIn("-DCMAKE_CXX_STANDARD_LIBRARIES=-lunwind -lsetjmp", configure)
        self.assertTrue(any("-fwasm-exceptions" in arg for arg in configure))
        self.assertIn("-DZ3_POLLING_TIMER=ON", configure)
        self.assertIn("-DZ3_SINGLE_THREADED=ON", configure)
        self.assertEqual(info["artifact"]["path"], "objects/z3")
        self.assertEqual(info["compiler_cxx"], "fixture version")
        self.assertEqual(info["status"], "built")

    def test_native_keeps_caller_compiler_and_library_settings(self):
        info = self.run_build("native")
        configure = next(c["argv"] for c in info["commands"] if c["label"] == "configure")
        self.assertIn("-DCMAKE_CXX_FLAGS=-Ihost", configure)
        self.assertIn("-DCMAKE_EXE_LINKER_FLAGS=-Lhost", configure)
        self.assertIn("-DCMAKE_CXX_STANDARD_LIBRARIES=-lc++abi -lunwind", configure)
        self.assertFalse(any("wasi-sdk-p1" in arg for arg in configure))
        self.assertEqual(info["artifact"]["path"], "objects/z3")
        self.assertEqual(info["status"], "built")


if __name__ == "__main__":
    unittest.main()
