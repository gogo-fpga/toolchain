import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("solver_build", ROOT / "scripts/build-solver-probe.py")
BUILD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILD)


class BuildTest(unittest.TestCase):
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
