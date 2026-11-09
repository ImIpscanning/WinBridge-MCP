"""Unit tests for no-timeout, locally approved Windows terminal tasks."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from winbridge_core import Workspace, WorkspaceError
from winbridge_terminal import MAX_TASKS, TASKS, TerminalManager


class TerminalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.workspace = Workspace([Path(self.temp.name)])
        self.terminal = TerminalManager(self.workspace)

    def tearDown(self):
        self.temp.cleanup()

    def test_catalog_has_both_windows_shells(self):
        catalog = self.terminal.catalog()
        self.assertIn("powershell_version", catalog["tasks"])
        self.assertIn("cmd_version", catalog["tasks"])
        self.assertIsNone(catalog["execution_timeout"])
        self.assertTrue(catalog["has_manual_stop"])
        self.assertFalse(catalog["arbitrary_shell_commands"])

    def test_no_external_command_names(self):
        with self.assertRaises(WorkspaceError):
            self.terminal.start("powershell.exe -Command echo BAD")

    def test_command_arguments_are_static_tuples(self):
        for task_name, args in TASKS.items():
            with self.subTest(task_name=task_name):
                self.assertIsInstance(args, tuple)
                self.assertTrue(all(isinstance(x, str) and x for x in args))
                self.assertTrue(args[0])

    def test_no_windows_launch_on_other_platforms(self):
        if __import__("sys").platform != "win32":
            with self.assertRaises(WorkspaceError):
                self.terminal.start("cmd_version")

    def test_unknown_task_status(self):
        with self.assertRaises(WorkspaceError):
            self.terminal.status("unknown")

    def test_unknown_task_cannot_be_stopped(self):
        with self.assertRaises(WorkspaceError):
            self.terminal.stop("unknown")

    def test_concurrency_limit_is_bounded(self):
        self.assertGreater(MAX_TASKS, 0)
        self.assertLessEqual(MAX_TASKS, 16)


if __name__ == "__main__":
    unittest.main()
