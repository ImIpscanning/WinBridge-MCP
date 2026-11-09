"""Portable tests for v0.2 workspace additions and desktop guardrails."""
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from winbridge_core import Workspace, WorkspaceError
from winbridge_desktop_control import (
    DEFAULT_APPS, input_status, type_text, hotkey, scroll, click
)


class WorkspaceAdditionsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.workspace = Workspace([self.root], writes_enabled=True)

    def tearDown(self):
        self.temp.cleanup()

    def test_create_directory_in_root(self):
        result = self.workspace.create_directory("project/src")
        self.assertIn("Directory ready", result)
        self.assertTrue((self.root / "project" / "src").is_dir())

    def test_create_directory_rejects_outside_root(self):
        with self.assertRaises(WorkspaceError):
            self.workspace.create_directory("../outside")

    def test_preview_does_not_change_file(self):
        f = self.root / "hello.txt"
        f.write_text("one\ntwo\n", encoding="utf-8")
        result = self.workspace.preview_text_edit("hello.txt", "one", "three")
        self.assertIn("+three", result["diff"])
        self.assertFalse(result["applied"])
        self.assertEqual(f.read_text(encoding="utf-8"), "one\ntwo\n")

    def test_preview_requires_exactly_one_occurrence(self):
        (self.root / "hello.txt").write_text("one one", encoding="utf-8")
        with self.assertRaises(WorkspaceError):
            self.workspace.preview_text_edit("hello.txt", "one", "other")

    def test_list_trash_with_restore_id(self):
        (self.root / "old.txt").write_text("old", encoding="utf-8")
        item = self.workspace.delete_file("old.txt")
        items = self.workspace.trash_list()
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["restore_id"], item["restore_id"])

    def test_static_python_check(self):
        (self.root / "good.py").write_text("x = 42\n", encoding="utf-8")
        (self.root / "bad.py").write_text("def broken(:\n", encoding="utf-8")
        result = self.workspace.python_syntax_check(".")
        self.assertEqual(result["checked"], 1)
        self.assertFalse(result["ok"])
        self.assertEqual(len(result["errors"]), 1)
        self.assertIn("bad.py", result["errors"][0]["path"])

    def test_static_python_check_does_not_run_code(self):
        marker = self.root / "must-not-exist.txt"
        (self.root / "safe.py").write_text(
            f"open({str(marker)!r}, 'w').write('bad')\n", encoding="utf-8"
        )
        self.assertTrue(self.workspace.python_syntax_check(".")["ok"])
        self.assertFalse(marker.exists())

    def test_read_only_rejects_directory_creation(self):
        read_only = Workspace([self.root], writes_enabled=False)
        with self.assertRaises(WorkspaceError):
            read_only.create_directory("folder")


class DesktopGuardsTests(unittest.TestCase):
    def test_input_off_by_default(self):
        with patch.dict(os.environ, {"WINBRIDGE_INPUT": "0"}, clear=True):
            self.assertFalse(input_status()["input_enabled"])
            self.assertEqual(
                input_status()["allowed_apps"], DEFAULT_APPS.split(";")
            )
            with self.assertRaises(WorkspaceError):
                click(10, 10)

    def test_unknown_hotkey_rejected(self):
        with self.assertRaises(WorkspaceError):
            hotkey("win+r")

    def test_control_characters_rejected(self):
        with self.assertRaises(WorkspaceError):
            type_text("before\x00after")

    def test_oversized_text_rejected(self):
        with self.assertRaises(WorkspaceError):
            type_text("a" * 501)

    def test_scroll_out_of_bounds(self):
        with self.assertRaises(WorkspaceError):
            scroll(11)

    def test_click_button_validation(self):
        with self.assertRaises(WorkspaceError):
            click(100, 100, button="middle")


if __name__ == "__main__":
    unittest.main()
