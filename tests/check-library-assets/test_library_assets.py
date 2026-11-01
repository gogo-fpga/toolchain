import copy
import hashlib
import importlib.util
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("library_assets", ROOT / "scripts/build-library-assets.py")
library_assets = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(library_assets)


class LibraryAssetsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / "third_party/probe"
        self.source.mkdir(parents=True)
        self.git(self.root, "init", "-q")
        self.git(self.source, "init", "-q")
        (self.source / "LICENSE").write_text("Test license\n", encoding="utf-8")
        (self.source / "probe.v").write_text("module probe; endmodule\n", encoding="utf-8")
        self.git(self.source, "add", ".")
        self.git(self.source, "commit", "-q", "-m", "検証用の固定ソース")
        self.revision = self.git(self.source, "rev-parse", "HEAD").strip()
        self.git(self.root, "update-index", "--add", "--cacheinfo", f"160000,{self.revision},third_party/probe")
        (self.root / ".gitmodules").write_text(
            '[submodule "third_party/probe"]\n'
            "path = third_party/probe\n"
            "url = https://example.invalid/probe.git\n"
            "shallow = true\n"
            "branch = main\n",
            encoding="utf-8",
        )
        self.component = {
            "id": "probe", "label": "検証用回路", "sources": [{"path": "probe.v", "language": "verilog"}],
            "data": [], "dependencies": [], "includeDirectories": [], "defines": {},
            "boards": {"tangnano1k": "unverified"},
        }
        self.entry = {
            "id": "probe", "label": "検証用ライブラリー", "kind": "library", "language": "verilog",
            "submodule": "third_party/probe", "license": {"expression": "LicenseRef-Test", "files": ["LICENSE"]},
            "deprecated": False, "status": "unverified", "reason": "未検証です。", "components": [self.component],
        }
        self.catalog = {"formatVersion": 1, "entries": [self.entry]}

    @staticmethod
    def git(root, *args):
        return subprocess.check_output(["git", "-C", str(root), *args], text=True, stderr=subprocess.PIPE)

    def build(self):
        return library_assets.build_catalog(self.root, self.catalog, self.root / "assets")

    def test_approved_catalog_covers_all_22_candidates_without_duplicate_pins(self):
        catalog = json.loads((ROOT / "libraries/catalog.json").read_text(encoding="utf-8"))
        entries = library_assets.validate_catalog(catalog)
        self.assertEqual(len(entries), 22)
        self.assertEqual(sum(entry["status"] == "unsupported" for entry in entries), 7)
        self.assertEqual({entry["id"] for entry in entries if entry["deprecated"]}, {
            "verilog-axis", "verilog-uart", "verilog-axi", "verilog-ethernet",
        })
        self.assertEqual(set(library_assets.submodules(ROOT)), {entry["submodule"] for entry in entries})
        for entry in entries:
            self.assertNotIn("revision", entry)
            self.assertNotIn("url", entry)

    def test_assets_keep_original_bytes_paths_and_pinned_provenance(self):
        manifest = self.build()
        entry = manifest["entries"][0]
        self.assertEqual(entry["source"], {"url": "https://example.invalid/probe.git", "revision": self.revision})
        assets = entry["license"]["files"] + entry["components"][0]["sources"]
        for asset in assets:
            expected = (self.source / asset["path"]).read_bytes()
            self.assertEqual((self.root / "assets" / asset["asset"]).read_bytes(), expected)
            self.assertEqual(asset["size"], len(expected))
            self.assertEqual(asset["sha256"], hashlib.sha256(expected).hexdigest())
        self.assertEqual(json.loads((self.root / "assets/catalog.json").read_text()), manifest)

    def test_checkout_edits_cannot_replace_pinned_upstream_objects(self):
        (self.source / "probe.v").write_text("modified source\n", encoding="utf-8")
        self.build()
        self.assertEqual((self.root / "assets/probe/probe.v").read_text(), "module probe; endmodule\n")

    def test_builds_are_reproducible_and_do_not_overwrite_existing_evidence(self):
        first = self.build()
        second = library_assets.build_catalog(self.root, self.catalog, self.root / "second")
        self.assertEqual(first, second)
        self.assertEqual((self.root / "assets/catalog.json").read_bytes(), (self.root / "second/catalog.json").read_bytes())
        with self.assertRaisesRegex(ValueError, "overwrite"):
            self.build()

    def test_revision_mismatch_is_rejected(self):
        self.git(self.source, "commit", "--allow-empty", "-q", "-m", "検証用の別の固定版")
        with self.assertRaisesRegex(ValueError, "differs"):
            self.build()
        self.assertFalse((self.root / "assets").exists())

    def test_missing_source_and_license_fail_before_publishing(self):
        for kind in ("source", "license"):
            with self.subTest(kind=kind):
                catalog = copy.deepcopy(self.catalog)
                if kind == "source":
                    catalog["entries"][0]["components"][0]["sources"][0]["path"] = "missing.v"
                else:
                    catalog["entries"][0]["license"]["files"] = ["missing.txt"]
                with self.assertRaisesRegex(ValueError, "Missing pinned source"):
                    library_assets.build_catalog(self.root, catalog, self.root / "assets")
                self.assertFalse((self.root / "assets").exists())

    def test_symlinks_are_not_followed(self):
        (self.source / "linked.v").symlink_to("probe.v")
        self.git(self.source, "add", "linked.v")
        self.git(self.source, "commit", "-q", "-m", "検証用のリンク")
        revision = self.git(self.source, "rev-parse", "HEAD").strip()
        with self.assertRaisesRegex(ValueError, "Not a regular pinned file"):
            library_assets.pinned_file(self.source, revision, "linked.v")

    def test_path_traversal_is_rejected(self):
        for path in ("../LICENSE", "/LICENSE", "a//b.v", "a/./b.v", "a/../b.v", "a\\b.v"):
            with self.subTest(path=path), self.assertRaisesRegex(ValueError, "Invalid library path"):
                library_assets.relative_path(path)

    def test_catalog_cannot_omit_a_registered_submodule(self):
        with self.assertRaisesRegex(ValueError, "do not match"):
            library_assets.build_catalog(self.root, {"formatVersion": 1, "entries": []}, self.root / "assets")

    def test_missing_or_unknown_metadata_fails_closed(self):
        for field in ("license", "reason", "source"):
            with self.subTest(field=field):
                catalog = copy.deepcopy(self.catalog)
                if field == "source":
                    catalog["entries"][0][field] = {"revision": "a" * 40}
                else:
                    del catalog["entries"][0][field]
                with self.assertRaises(ValueError):
                    library_assets.validate_catalog(catalog)

    def test_duplicate_ids_and_unsupported_components_are_rejected(self):
        self.catalog["entries"].append(copy.deepcopy(self.entry))
        with self.assertRaisesRegex(ValueError, "duplicate library id"):
            library_assets.validate_catalog(self.catalog)
        self.catalog["entries"].pop()
        self.entry["status"] = "unsupported"
        with self.assertRaisesRegex(ValueError, "cannot expose components"):
            library_assets.validate_catalog(self.catalog)

    def test_vhdl_sources_need_named_libraries(self):
        self.component["sources"] = [{"path": "probe.vhd", "language": "vhdl"}]
        with self.assertRaisesRegex(ValueError, "VHDL library name"):
            library_assets.validate_catalog(self.catalog)
        self.component["sources"][0]["library"] = "work"
        library_assets.validate_catalog(self.catalog)

    def test_available_status_requires_a_confirmed_board(self):
        self.entry["status"] = "available"
        with self.assertRaisesRegex(ValueError, "no confirmed board"):
            library_assets.validate_catalog(self.catalog)
        self.component["boards"]["tangnano1k"] = "confirmed"
        library_assets.validate_catalog(self.catalog)

    def test_missing_and_cyclic_dependencies_are_rejected(self):
        self.component["dependencies"] = ["missing/probe"]
        with self.assertRaisesRegex(ValueError, "Unknown component"):
            library_assets.validate_catalog(self.catalog)
        self.component["dependencies"] = ["probe/probe"]
        with self.assertRaisesRegex(ValueError, "Cyclic component"):
            library_assets.validate_catalog(self.catalog)

    def test_release_sources_rebuild_without_git_and_reject_modified_files(self):
        manifest = self.build()
        archive = self.root / "archive"
        (archive / "libraries").mkdir(parents=True)
        shutil.copyfile(self.root / ".gitmodules", archive / ".gitmodules")
        shutil.copytree(self.source, archive / "third_party/probe", ignore=shutil.ignore_patterns(".git"))
        (archive / "third_party/probe/.gitcommit").write_text(self.revision + "\n")
        (archive / "libraries/source-manifest.json").write_text(json.dumps(manifest))
        with patch.object(library_assets, "git", side_effect=AssertionError("Git is unavailable")):
            rebuilt = library_assets.build_catalog(archive, self.catalog, self.root / "rebuilt")
        self.assertEqual(rebuilt, manifest)
        (archive / "third_party/probe/probe.v").write_text("different\n")
        with self.assertRaisesRegex(ValueError, "hash mismatch"):
            library_assets.build_catalog(archive, self.catalog, self.root / "corrupt")
        self.assertFalse((self.root / "corrupt").exists())


if __name__ == "__main__":
    unittest.main()
