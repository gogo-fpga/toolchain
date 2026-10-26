import importlib.util
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "check_pins",
    ROOT / ".github/scripts/check-pins.py",
)
check_pins = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(check_pins)


class CheckPinsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / ".github/workflows").mkdir(parents=True)
        (self.root / "vendor/libusb").mkdir(parents=True)
        (self.root / ".gitmodules").write_text(
            '[submodule "vendor/libusb"]\n'
            "\tpath = vendor/libusb\n"
            "\turl = https://example.invalid/libusb.git\n"
            "\tshallow = true\n",
            encoding="utf-8",
        )
        (self.root / "RESEARCH.md").write_text(
            "| 依存 | 版 | commit | 取得元 |\n"
            "|---|---|---|---|\n"
            "| libusb | v1.0.30 | `01234567` | https://example.invalid/libusb.git |\n",
            encoding="utf-8",
        )
        (self.root / "package.json").write_text("{}", encoding="utf-8")
        (self.root / ".github/workflows/build.yml").write_text(
            "jobs:\n"
            "  build:\n"
            "    runs-on: ubuntu-26.04\n"
            "    steps:\n"
            "      - uses: actions/checkout@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa # v7.0.1\n"
            "      - uses: actions/setup-node@bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb # v7.1.0\n"
            "        with:\n"
            "          node-version: 24\n",
            encoding="utf-8",
        )
        (self.root / ".github/workflows/lint.yml").write_text(
            "env:\n"
            "  ACTIONLINT_VERSION: 1.7.12\n"
            "  ACTIONLINT_SHA256: " + "c" * 64 + "\n"
            "jobs:\n"
            "  lint:\n"
            "    runs-on: ubuntu-26.04\n"
            "    steps:\n"
            "      - uses: actions/checkout@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa # v7.0.1\n",
            encoding="utf-8",
        )
        (self.root / ".github/workflows/agent-docs.yml").write_text(
            "jobs:\n"
            "  docs:\n"
            "    runs-on: ubuntu-26.04\n"
            "    steps:\n"
            "      - uses: actions/checkout@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa # v7.0.1\n",
            encoding="utf-8",
        )
        (self.root / ".github/workflows/pins-check.yml").write_text(
            "jobs:\n"
            "  pins:\n"
            "    runs-on: ubuntu-26.04\n"
            "    steps:\n"
            "      - uses: actions/checkout@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa # v7.0.1\n",
            encoding="utf-8",
        )
        subprocess.run(["git", "init", "-q"], cwd=self.root, check=True)
        subprocess.run(["git", "add", ".gitmodules", "RESEARCH.md", ".github", "package.json"], cwd=self.root, check=True)
        subprocess.run(
            [
                "git",
                "update-index",
                "--add",
                "--cacheinfo",
                "160000,0123456789abcdef0123456789abcdef01234567,vendor/libusb",
            ],
            cwd=self.root,
            check=True,
        )
        env = os.environ | {
            "GIT_AUTHOR_NAME": "Test",
            "GIT_AUTHOR_EMAIL": "test@example.invalid",
            "GIT_COMMITTER_NAME": "Test",
            "GIT_COMMITTER_EMAIL": "test@example.invalid",
        }
        subprocess.run(["git", "commit", "-qm", "fixture"], cwd=self.root, env=env, check=True)

    def tearDown(self):
        self.temp.cleanup()

    def errors(self):
        return check_pins.consistency(self.root)

    def test_consistency_passes(self):
        self.assertEqual([], self.errors())

    def test_missing_shallow_is_rejected(self):
        path = self.root / ".gitmodules"
        path.write_text(path.read_text(encoding="utf-8").replace("\tshallow = true\n", ""), encoding="utf-8")
        self.assertTrue(any("shallow = true" in error for error in self.errors()))

    def test_unpinned_uses_is_rejected(self):
        path = self.root / ".github/workflows/build.yml"
        path.write_text(path.read_text(encoding="utf-8").replace("actions/setup-node@bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb # v7.1.0", "actions/setup-node@v7"), encoding="utf-8")
        self.assertTrue(any("40 桁の SHA" in error for error in self.errors()))

    def test_mismatched_action_sha_is_rejected(self):
        path = self.root / ".github/workflows/lint.yml"
        path.write_text(path.read_text(encoding="utf-8").replace("a" * 40, "d" * 40), encoding="utf-8")
        self.assertTrue(any("SHA が workflow 間で一致しません" in error for error in self.errors()))

    def test_research_gitlink_mismatch_is_rejected(self):
        path = self.root / "RESEARCH.md"
        path.write_text(path.read_text(encoding="utf-8").replace("01234567", "abcdefab"), encoding="utf-8")
        self.assertTrue(any("gitlink" in error for error in self.errors()))

    def test_research_commit_parser_uses_dependency_table(self):
        research = (
            "| 依存 | 版 | commit | 取得元 |\n"
            "|---|---|---|---|\n"
            "| openFPGALoader | v1.2.0 | `01234567` | https://example.invalid/openFPGALoader.git |\n"
            "\n"
            "| 部品 | ライセンス | 配布で必要なこと |\n"
            "|---|---|---|\n"
            "| openFPGALoader | Apache-2.0 | LICENSE と NOTICE の同梱 |\n"
        )
        self.assertEqual(
            {"openFPGALoader": "01234567"},
            check_pins.parse_research_commits(research),
        )

    def test_numeric_tag_order_and_prerelease_filter(self):
        tags = "\n".join(
            (
                "a" * 40 + "\trefs/tags/6.0.9",
                "b" * 40 + "\trefs/tags/6.0.13",
                "c" * 40 + "\trefs/tags/6.0.14-rc1",
                "d" * 40 + "\trefs/tags/6.0.15beta",
            )
        )
        self.assertEqual("6.0.13", check_pins.latest_stable_tag(tags))
        self.assertGreater(check_pins.parse_version("6.0.13"), check_pins.parse_version("6.0.9"))

    def test_node_active_lts_uses_first_lts_entry(self):
        self.assertEqual(
            ("v24.22.1", "Krypton"),
            check_pins.parse_node_lts('[{"version":"v24.22.1","lts":"Krypton"},{"version":"v25.0.0","lts":false}]'),
        )

    def test_runner_label_status(self):
        labels = check_pins.parse_runner_labels(
            "## Available Images\n| `ubuntu-26.04` |\n"
            "## Image Definitions\n### Beta\n`ubuntu-27.04`\n### GA\n`ubuntu-24.04`\n"
        )
        self.assertEqual("listed", labels["ubuntu-26.04"])
        self.assertEqual("beta", labels["ubuntu-27.04"])
        self.assertEqual("listed", labels["ubuntu-24.04"])


    def test_needs_update_is_false_when_all_rows_are_latest(self):
        rows = [
            ("openFPGALoader", "v1.2.0", "v1.2.0", "最新"),
            ("libusb", "v1.0.30", "v1.0.30", "最新"),
        ]
        self.assertFalse(check_pins.needs_update(rows))

    def test_needs_update_is_true_when_a_row_has_an_update(self):
        rows = [("Node.js Active LTS", "22", "v24.22.1", "更新あり")]
        self.assertTrue(check_pins.needs_update(rows))

    def test_needs_update_is_true_when_a_row_needs_confirmation(self):
        rows = [("actionlint", "1.7.12", "取得できません", "要確認")]
        self.assertTrue(check_pins.needs_update(rows))

    def test_parse_upstream_report_table_format(self):
        report = (
            "| 依存 | 固定値 | 最新 | 状態 |\n"
            "|---|---|---|---|\n"
            "| openFPGALoader | v1.2.0 | v1.2.0 | 最新 |\n"
            "| libusb | v1.0.30 | v1.0.30 | 最新 |\n"
        )
        rows = check_pins.parse_report_rows(report)
        self.assertEqual(
            [
                ("openFPGALoader", "v1.2.0", "v1.2.0", "最新"),
                ("libusb", "v1.0.30", "v1.0.30", "最新"),
            ],
            rows,
        )
        self.assertFalse(check_pins.needs_update(rows))


if __name__ == "__main__":
    unittest.main()
