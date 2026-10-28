import importlib.util
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


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
        with (self.root / "RESEARCH.md").open("a", encoding="utf-8") as research:
            research.write(
                "\n| 依存 | 版 | SHA-256 | 取得元 |\n"
                "|---|---|---|---|\n"
                "| wasi-sdk | 34.0 | `" + "e" * 64 + "` | "
                "https://github.com/WebAssembly/wasi-sdk/releases/download/"
                "wasi-sdk-34/wasi-sdk-34.0-x86_64-linux.tar.gz |\n"
                "| boost | 1.92.0 | `" + "a" * 64 + "` | "
                "https://github.com/boostorg/boost/releases/download/boost-1.92.0/"
                "boost-1.92.0-b2-nodocs.tar.xz |\n"
                "| eigen | 5.0.1 | `" + "b" * 64 + "` | "
                "https://gitlab.com/libeigen/eigen/-/archive/5.0.1/eigen-5.0.1.tar.gz |\n"
            )
        (self.root / check_pins.APYCULA_REQUIREMENTS).write_text(
            "apycula==0.35 \\\n    --hash=sha256:" + "a" * 64 + "\n"
            "fastcrc==0.5.0 \\\n    --hash=sha256:" + "b" * 64 + "\n"
            "msgspec==0.22.0 \\\n    --hash=sha256:" + "c" * 64 + "\n"
            "numpy==2.5.4 \\\n    --hash=sha256:" + "d" * 64 + "\n",
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

    def commit_fixture(self, message):
        env = os.environ | {
            "GIT_AUTHOR_NAME": "Test",
            "GIT_AUTHOR_EMAIL": "test@example.invalid",
            "GIT_COMMITTER_NAME": "Test",
            "GIT_COMMITTER_EMAIL": "test@example.invalid",
        }
        subprocess.run(["git", "commit", "-qm", message], cwd=self.root, env=env, check=True)

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

    def test_wasi_sdk_pin_parser_reads_version_checksum_and_url(self):
        research = (
            "| 依存 | 版 | SHA-256 | 取得元 |\n"
            "|---|---|---|---|\n"
            "| wasi-sdk | 34.0 | `" + "e" * 64 + "` | "
            "https://github.com/WebAssembly/wasi-sdk/releases/download/"
            "wasi-sdk-34/wasi-sdk-34.0-x86_64-linux.tar.gz |\n"
        )
        self.assertEqual(
            {
                "version": "34.0",
                "sha256": "e" * 64,
                "asset": "wasi-sdk-34.0-x86_64-linux.tar.gz",
                "url": "https://github.com/WebAssembly/wasi-sdk/releases/download/"
                "wasi-sdk-34/wasi-sdk-34.0-x86_64-linux.tar.gz",
            },
            check_pins.parse_wasi_sdk_pin(research),
        )

    def test_archive_pin_parser_reads_version_checksum_and_url(self):
        research = (
            "| 依存 | 版 | SHA-256 | 取得元 |\n"
            "|---|---|---|---|\n"
            "| boost | 1.92.0 | `" + "a" * 64 + "` | "
            "https://github.com/boostorg/boost/releases/download/boost-1.92.0/"
            "boost-1.92.0-b2-nodocs.tar.xz |\n"
        )
        self.assertEqual(
            {
                "version": "1.92.0",
                "sha256": "a" * 64,
                "asset": "boost-1.92.0-b2-nodocs.tar.xz",
                "url": "https://github.com/boostorg/boost/releases/download/boost-1.92.0/"
                "boost-1.92.0-b2-nodocs.tar.xz",
            },
            check_pins.parse_archive_pin(research, "boost"),
        )

    def test_apycula_requirements_require_all_hashes(self):
        version, hashes = check_pins.parse_apycula_requirements(
            "apycula==0.35 \\\n    --hash=sha256:" + "a" * 64 + "\n"
            "numpy==2.5.4 \\\n    --hash=sha256:" + "b" * 64 + "\n"
        )
        self.assertEqual("0.35", version)
        self.assertEqual(["a" * 64, "b" * 64], hashes)
        with self.assertRaisesRegex(RuntimeError, "hash"):
            check_pins.parse_apycula_requirements("apycula==0.35\n")

    def test_apycula_wheel_pin_comes_from_requirement_and_release_metadata(self):
        wheel_hash = "a" * 64
        requirements = (
            "apycula==0.35 \\\n    --hash=sha256:"
            + "b" * 64
            + " \\\n    --hash=sha256:"
            + wheel_hash
            + "\n"
        )
        release = json.dumps(
            {
                "urls": [
                    {
                        "filename": "apycula-0.35-py3-none-any.whl",
                        "digests": {"sha256": wheel_hash},
                        "url": "https://files.pythonhosted.org/apycula.whl",
                    }
                ]
            }
        )
        self.assertEqual(
            ("apycula-0.35-py3-none-any.whl", wheel_hash, "https://files.pythonhosted.org/apycula.whl"),
            check_pins.parse_apycula_wheel_info(requirements, release),
        )
        with self.assertRaisesRegex(RuntimeError, "一致する"):
            check_pins.parse_apycula_wheel_info(
                requirements,
                release.replace(wheel_hash, "c" * 64),
            )

    def test_invalid_wasi_sdk_checksum_is_rejected(self):
        research = (
            "| 依存 | 版 | SHA-256 | 取得元 |\n"
            "|---|---|---|---|\n"
            "| wasi-sdk | 34.0 | `short` | "
            "https://github.com/WebAssembly/wasi-sdk/releases/download/"
            "wasi-sdk-34/wasi-sdk-34.0-x86_64-linux.tar.gz |\n"
        )
        with self.assertRaisesRegex(RuntimeError, "SHA-256"):
            check_pins.parse_wasi_sdk_pin(research)

    def test_wasi_sdk_release_reads_linux_asset_version_and_digest(self):
        version, digest = check_pins.parse_wasi_sdk_release(
            '{"assets":[{"name":"wasi-sdk-35.0-x86_64-linux.tar.gz","digest":"sha256:'
            + "f" * 64
            + '"}]}'
        )
        self.assertEqual(("35.0", "f" * 64), (version, digest))

    def test_numeric_tag_order_and_prerelease_filter(self):
        tags = "\n".join(
            (
                "a" * 40 + "\trefs/tags/6.0.9",
                "b" * 40 + "\trefs/tags/6.0.13",
                "c" * 40 + "\trefs/tags/6.0.14-rc1",
                "d" * 40 + "\trefs/tags/6.0.15beta",
                "e" * 40 + "\trefs/tags/6.0.13^{}",
            )
        )
        self.assertEqual("6.0.13", check_pins.latest_stable_tag(tags))
        self.assertGreater(check_pins.parse_version("6.0.13"), check_pins.parse_version("6.0.9"))

    def test_compact_and_dashed_date_tags_are_ordered_as_dates(self):
        tags = "\n".join(
            (
                "a" * 40 + "\trefs/tags/v20240124",
                "b" * 40 + "\trefs/tags/v20240322",
                "c" * 40 + "\trefs/tags/v2024-04-05",
                "d" * 40 + "\trefs/tags/v2024-12-30",
            )
        )
        self.assertEqual("v2024-12-30", check_pins.latest_stable_tag(tags))
        self.assertEqual("v20240322", check_pins.fixed_stable_tag("b" * 40, tags))
        self.assertEqual("更新あり", check_pins.compare_status("v20240322", "v2024-12-30"))

    def prepare_upstream_fixture(self, libftdi_branch=None):
        names = (*check_pins.TAGGED_SUBMODULES, *check_pins.BRANCH_SUBMODULES)
        self.pinned = {
            name: f"{index + 1:040x}"
            for index, name in enumerate(names)
        }
        lines = []
        for name in names:
            lines.extend(
                (
                    f'[submodule "vendor/{name}"]',
                    f"\tpath = vendor/{name}",
                    f"\turl = https://example.invalid/{name}.git",
                    "\tshallow = true",
                )
            )
            if name == "libftdi" and libftdi_branch is not None:
                lines.append(f"\tbranch = {libftdi_branch}")
        lines.append("")
        (self.root / ".gitmodules").write_text("\n".join(lines), encoding="utf-8")
        subprocess.run(["git", "add", ".gitmodules"], cwd=self.root, check=True)
        for name, sha in self.pinned.items():
            subprocess.run(
                [
                    "git",
                    "update-index",
                    "--add",
                    "--cacheinfo",
                    f"160000,{sha},vendor/{name}",
                ],
                cwd=self.root,
                check=True,
            )
        self.commit_fixture("upstream fixture")
        self.latest_wasi_sdk = (
            '{"assets":[{"name":"wasi-sdk-34.0-x86_64-linux.tar.gz","digest":"sha256:'
            + "e" * 64
            + '"}]}'
        )
        return {
            name: f"{sha}\trefs/tags/v1.0.0\n"
            for name, sha in self.pinned.items()
            if name in check_pins.TAGGED_SUBMODULES
        }

    def upstream_report(self, tag_outputs, branch_output=None, branch_error=False):
        real_run = check_pins.run
        module_urls = {
            f"https://example.invalid/{name}.git": name
            for name in (*check_pins.TAGGED_SUBMODULES, *check_pins.BRANCH_SUBMODULES)
        }
        archive_tags = {
            check_pins.ARCHIVE_TAG_SOURCES["boost"]: "1" * 40 + "\trefs/tags/boost-1.92.0\n",
            check_pins.ARCHIVE_TAG_SOURCES["eigen"]: "2" * 40 + "\trefs/tags/5.0.1\n",
        }
        refs = []

        def fake_run(*args, cwd=check_pins.ROOT):
            if args[:3] == ("git", "ls-tree", "HEAD"):
                return real_run(*args, cwd=cwd)
            if args[:2] == ("git", "ls-remote"):
                if args[2] == "--tags":
                    if args[3] in archive_tags:
                        return archive_tags[args[3]]
                    return tag_outputs[module_urls[args[3]]]
                refs.append(args[3])
                if branch_error:
                    raise subprocess.CalledProcessError(2, args)
                return branch_output or ""
            raise AssertionError(f"unexpected command: {args}")

        def fake_fetch(url):
            if url == check_pins.NODE_INDEX:
                return '[{"version":"v24.22.1","lts":"Krypton"}]'
            if url == check_pins.ACTIONLINT_RELEASE:
                return '{"tag_name":"v1.7.12"}'
            if url == check_pins.RUNNER_IMAGES_README:
                return "## Available Images\n| `ubuntu-26.04` |\n"
            if url == check_pins.WASI_SDK_RELEASE:
                return self.latest_wasi_sdk
            if url == check_pins.APYCULA_PYPI_RELEASE:
                return '{"info":{"version":"0.35"}}'
            raise AssertionError(f"unexpected URL: {url}")

        with patch.object(check_pins, "run", side_effect=fake_run), patch.object(
            check_pins, "fetch", side_effect=fake_fetch
        ):
            report = check_pins.upstream_report(self.root)
        return check_pins.parse_report_rows(report), refs

    def test_annotated_tag_resolves_gitlink_without_submodule_checkout(self):
        tags = self.prepare_upstream_fixture()
        pinned = self.pinned["openFPGALoader"]
        tags["openFPGALoader"] = "\n".join(
            (
                "f" * 40 + "\trefs/tags/v1.0.0",
                pinned + "\trefs/tags/v1.0.0^{}",
                "e" * 40 + "\trefs/tags/v1.1.0",
            )
        )
        rows, _ = self.upstream_report(tags, "a" * 40 + "\tHEAD\n")
        self.assertEqual(
            ("openFPGALoader", "v1.0.0", "v1.1.0", "更新あり"),
            next(row for row in rows if row[0] == "openFPGALoader"),
        )
        self.assertFalse((self.root / "vendor/openFPGALoader").exists())

    def test_lightweight_tag_resolves_gitlink(self):
        tags = self.prepare_upstream_fixture()
        rows, _ = self.upstream_report(tags, self.pinned["libftdi"] + "\tHEAD\n")
        self.assertEqual(
            ("libusb", "v1.0.0", "v1.0.0", "最新"),
            next(row for row in rows if row[0] == "libusb"),
        )

    def test_yosys_tag_and_wasi_sdk_are_monitored(self):
        tags = self.prepare_upstream_fixture()
        rows, _ = self.upstream_report(tags, self.pinned["libftdi"] + "\tHEAD\n")
        self.assertEqual(
            ("yosys", "v1.0.0", "v1.0.0", "最新"),
            next(row for row in rows if row[0] == "yosys"),
        )
        self.assertEqual(
            ("wasi-sdk", "34.0 (" + "e" * 12 + ")", "34.0 (" + "e" * 12 + ")", "最新"),
            next(row for row in rows if row[0] == "wasi-sdk"),
        )
        self.assertEqual(
            ("nextpnr", "v1.0.0", "v1.0.0", "最新"),
            next(row for row in rows if row[0] == "nextpnr"),
        )
        self.assertEqual(
            ("zstd", "v1.0.0", "v1.0.0", "最新"),
            next(row for row in rows if row[0] == "zstd"),
        )
        self.assertEqual(
            ("xz-embedded", "v1.0.0", "v1.0.0", "最新"),
            next(row for row in rows if row[0] == "xz-embedded"),
        )
        self.assertEqual(
            ("boost archive", "1.92.0 (" + "a" * 12 + ")", "boost-1.92.0", "最新"),
            next(row for row in rows if row[0] == "boost archive"),
        )
        self.assertEqual(
            ("eigen archive", "5.0.1 (" + "b" * 12 + ")", "5.0.1", "最新"),
            next(row for row in rows if row[0] == "eigen archive"),
        )
        self.assertEqual(
            ("Apycula", "0.35", "0.35", "最新"),
            next(row for row in rows if row[0] == "Apycula"),
        )

    def test_wasi_sdk_release_update_is_reported(self):
        tags = self.prepare_upstream_fixture()
        self.latest_wasi_sdk = (
            '{"assets":[{"name":"wasi-sdk-35.0-x86_64-linux.tar.gz","digest":"sha256:'
            + "f" * 64
            + '"}]}'
        )
        rows, _ = self.upstream_report(tags, self.pinned["libftdi"] + "\tHEAD\n")
        self.assertEqual(
            ("wasi-sdk", "34.0 (" + "e" * 12 + ")", "35.0 (" + "f" * 12 + ")", "更新あり"),
            next(row for row in rows if row[0] == "wasi-sdk"),
        )

    def test_gitlink_without_matching_tag_needs_review(self):
        tags = self.prepare_upstream_fixture()
        tags["openFPGALoader"] = "f" * 40 + "\trefs/tags/v1.0.0\n"
        rows, _ = self.upstream_report(tags, self.pinned["libftdi"] + "\tHEAD\n")
        self.assertEqual(
            ("openFPGALoader", "取得できません", "取得できません", "要確認"),
            next(row for row in rows if row[0] == "openFPGALoader"),
        )

    def test_non_gitlink_entry_needs_review(self):
        tags = self.prepare_upstream_fixture()
        subprocess.run(
            ["git", "update-index", "--force-remove", "vendor/openFPGALoader"],
            cwd=self.root,
            check=True,
        )
        path = self.root / "vendor/openFPGALoader"
        path.write_text("not a submodule\n", encoding="utf-8")
        subprocess.run(["git", "add", "vendor/openFPGALoader"], cwd=self.root, check=True)
        self.commit_fixture("replace gitlink")
        rows, _ = self.upstream_report(tags, self.pinned["libftdi"] + "\tHEAD\n")
        self.assertEqual(
            ("openFPGALoader", "取得できません", "取得できません", "要確認"),
            next(row for row in rows if row[0] == "openFPGALoader"),
        )

    def test_libftdi_branch_at_gitlink_is_latest(self):
        tags = self.prepare_upstream_fixture()
        rows, refs = self.upstream_report(tags, self.pinned["libftdi"] + "\tHEAD\n")
        self.assertEqual(
            ("libftdi (branch)", self.pinned["libftdi"][:12], self.pinned["libftdi"][:12], "最新"),
            next(row for row in rows if row[0] == "libftdi (branch)"),
        )
        self.assertIn("HEAD", refs)

    def test_libftdi_branch_update_is_reported(self):
        tags = self.prepare_upstream_fixture(libftdi_branch="next")
        latest = "0" * 40
        rows, refs = self.upstream_report(tags, latest + "\trefs/heads/next\n")
        self.assertEqual(
            ("libftdi (branch)", self.pinned["libftdi"][:12], latest[:12], "更新あり"),
            next(row for row in rows if row[0] == "libftdi (branch)"),
        )
        self.assertIn("refs/heads/next", refs)

    def test_libftdi_branch_lookup_failure_needs_review(self):
        tags = self.prepare_upstream_fixture()
        rows, _ = self.upstream_report(tags, branch_error=True)
        self.assertEqual(
            ("libftdi (branch)", "取得できません", "取得できません", "要確認"),
            next(row for row in rows if row[0] == "libftdi (branch)"),
        )

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
