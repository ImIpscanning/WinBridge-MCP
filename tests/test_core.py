from pathlib import Path
import tempfile
import unittest

from winbridge_core import Workspace, WorkspaceError


class WorkspaceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        self.root = self.base / 'project'
        self.root.mkdir()
        self.outside = self.base / 'private.txt'
        self.outside.write_text('do not touch', encoding='utf-8')
        self.ws = Workspace([self.root])

    def tearDown(self):
        self.temp.cleanup()

    def test_prevents_traversal(self):
        with self.assertRaises(WorkspaceError):
            self.ws.read_file('../private.txt')
        with self.assertRaises(WorkspaceError):
            self.ws.write_file(str(self.outside), 'bad')

    def test_prevents_sensitive_files(self):
        with self.assertRaises(WorkspaceError):
            self.ws.write_file('.env', 'token=secret')
        with self.assertRaises(WorkspaceError):
            self.ws.read_file('.git/config')

    def test_create_edit_trash_restore(self):
        self.ws.write_file('src/example.txt', 'hello')
        self.ws.replace_text('src/example.txt', 'hello', 'hello world')
        self.assertIn('hello world', self.ws.read_file('src/example.txt')['content'])
        removed = self.ws.delete_file('src/example.txt')
        self.assertFalse((self.root / 'src/example.txt').exists())
        self.ws.restore_file(removed['restore_id'])
        self.assertEqual((self.root / 'src/example.txt').read_text(), 'hello world')

    def test_requires_explicit_overwrite(self):
        self.ws.write_file('file.txt', 'first')
        with self.assertRaises(WorkspaceError):
            self.ws.write_file('file.txt', 'second')
        self.assertEqual((self.root / 'file.txt').read_text(), 'first')

    def test_write_disabled(self):
        ws = Workspace([self.root], writes_enabled=False)
        with self.assertRaises(WorkspaceError):
            ws.write_file('a.txt', 'hello')

    def test_exact_replacement(self):
        self.ws.write_file('a.txt', 'x x')
        with self.assertRaises(WorkspaceError):
            self.ws.replace_text('a.txt', 'x', 'y')

    def test_search(self):
        self.ws.write_file('a.txt', 'first\nneedle here')
        results = self.ws.search_text('needle')
        self.assertEqual(len(results['matches']), 1)
        self.assertEqual(results['matches'][0]['line'], 2)

    def test_terminal_rejects_arbitrary_commands(self):
        with self.assertRaises(WorkspaceError):
            self.ws.terminal_task('powershell')
        result = self.ws.terminal_task('python_version')
        self.assertEqual(result['return_code'], 0)


if __name__ == '__main__':
    unittest.main()
