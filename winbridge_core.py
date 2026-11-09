"""Workspace-confined file and diagnostic operations for WinBridge MCP."""
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from uuid import uuid4

MAX_TEXT_BYTES = 1_000_000
MAX_RESULT_CHARS = 80_000
SKIP_DIRS = {'.git', '.venv', 'node_modules', '__pycache__', '.winbridge_trash'}
SENSITIVE_NAMES = {'.env', '.ssh', '.aws', '.gnupg', '.git', '.winbridge_trash', '.winbridge_audit.jsonl',
                   'credentials.json', 'secrets.json', 'id_rsa', 'id_ed25519'}
SENSITIVE_SUFFIXES = {'.pem', '.p12', '.pfx', '.key', '.kdbx'}


class WorkspaceError(ValueError):
    """The operation violates a workspace policy or cannot be completed."""


class Workspace:
    def __init__(self, roots: list[Path], writes_enabled: bool = True):
        if not roots:
            raise WorkspaceError('Configure at least one workspace root.')
        self.roots = [Path(root).expanduser().resolve() for root in roots]
        for root in self.roots:
            if not root.is_dir():
                raise WorkspaceError(f'Workspace directory does not exist: {root}')
        self.writes_enabled = writes_enabled

    @classmethod
    def from_environment(cls) -> 'Workspace':
        raw = os.environ.get('WINBRIDGE_ROOTS', '').strip()
        if raw:
            roots = [Path(p.strip()) for p in raw.split(os.pathsep) if p.strip()]
        else:
            default = Path.home() / 'Documents' / 'WinBridgeWorkspace'
            default.mkdir(parents=True, exist_ok=True)
            roots = [default]
        return cls(roots, writes_enabled=os.environ.get('WINBRIDGE_WRITE', '1') == '1')

    def _root_for(self, path: Path) -> Path:
        for root in self.roots:
            if path.is_relative_to(root):
                return root
        raise WorkspaceError('Path is outside the authorized workspace roots.')

    def resolve(self, path: str, *, allow_root: bool = False) -> Path:
        if not isinstance(path, str) or not path.strip():
            raise WorkspaceError('A non-empty path is required.')
        candidate = Path(path).expanduser()
        if not candidate.is_absolute():
            candidate = self.roots[0] / candidate
        candidate = candidate.resolve()
        root = self._root_for(candidate)
        if candidate == root and not allow_root:
            raise WorkspaceError('Choose a file or folder within a workspace root.')
        relative = candidate.relative_to(root)
        if any(self._is_sensitive(part) for part in relative.parts):
            raise WorkspaceError('Access to sensitive or internal paths is blocked.')
        return candidate

    @staticmethod
    def _is_sensitive(part: str) -> bool:
        low = part.casefold()
        return (low in SENSITIVE_NAMES or Path(low).suffix in SENSITIVE_SUFFIXES or
                low.startswith('.env.') or low.startswith('credentials.') or low.startswith('secrets.'))

    def _require_write(self) -> None:
        if not self.writes_enabled:
            raise WorkspaceError('Writes are disabled in WINBRIDGE_WRITE configuration.')

    def _audit(self, action: str, path: Path) -> None:
        root = self._root_for(path)
        entry = {'at': datetime.now(timezone.utc).isoformat(), 'operation': action, 'path': str(path)}
        try:
            with (root / '.winbridge_audit.jsonl').open('a', encoding='utf-8') as f:
                f.write(json.dumps(entry, ensure_ascii=False) + '\n')
        except OSError:
            pass  # Audit logging is best-effort; file permissions may prohibit it.

    def roots_info(self) -> dict:
        return {'roots': [str(p) for p in self.roots], 'writes_enabled': self.writes_enabled,
                'limits': {'file_bytes': MAX_TEXT_BYTES, 'max_result_chars': MAX_RESULT_CHARS}}

    def list_directory(self, path: str = '.', limit: int = 100) -> dict:
        directory = self.resolve(path, allow_root=True)
        if not directory.is_dir():
            raise WorkspaceError('Directory not found.')
        limit = min(max(limit, 1), 200)
        result = []
        for item in sorted(directory.iterdir(), key=lambda p: p.name.casefold()):
            if self._is_sensitive(item.name):
                continue
            try:
                checked = self.resolve(str(item))
                result.append({'name': item.name, 'path': str(checked),
                               'type': 'directory' if item.is_dir() else 'file'})
            except (WorkspaceError, OSError):
                continue
            if len(result) >= limit:
                break
        return {'directory': str(directory), 'entries': result, 'limit': limit}

    def read_file(self, path: str, start_line: int = 1, max_lines: int = 300) -> dict:
        target = self.resolve(path)
        if not target.is_file():
            raise WorkspaceError('File not found.')
        if target.stat().st_size > MAX_TEXT_BYTES:
            raise WorkspaceError('File exceeds the 1 MB text limit.')
        try:
            lines = target.read_text(encoding='utf-8').splitlines()
        except UnicodeError as exc:
            raise WorkspaceError('File is not UTF-8 text.') from exc
        start = max(1, start_line)
        end = min(len(lines), start + min(max(1, max_lines), 1000) - 1)
        return {'path': str(target), 'lines_total': len(lines), 'start_line': start,
                'end_line': end, 'content': '\n'.join(f'{i + 1}: {lines[i]}' for i in range(start - 1, end))}

    def write_file(self, path: str, content: str, overwrite: bool = False) -> str:
        self._require_write()
        target = self.resolve(path)
        if target.exists() and (not target.is_file() or not overwrite):
            raise WorkspaceError('File exists; set overwrite=true to replace it, or use replace_text.')
        if len(content.encode('utf-8')) > MAX_TEXT_BYTES:
            raise WorkspaceError('Content exceeds 1 MB limit.')
        target.parent.mkdir(parents=True, exist_ok=True)
        # Exclusive create for new files, atomic replacement for existing files.
        if not overwrite:
            with target.open('x', encoding='utf-8', newline='\n') as f:
                f.write(content)
        else:
            import tempfile
            temp_path = None
            try:
                with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', newline='\n',
                                                 dir=target.parent, delete=False) as f:
                    temp_path = Path(f.name)
                    f.write(content)
                temp_path.replace(target)
            finally:
                if temp_path and temp_path.exists():
                    temp_path.unlink()
        self._audit('write_file', target)
        return f'Wrote {len(content.encode("utf-8"))} bytes to {target}'

    def replace_text(self, path: str, old_text: str, new_text: str) -> str:
        self._require_write()
        target = self.resolve(path)
        if not target.is_file() or target.stat().st_size > MAX_TEXT_BYTES:
            raise WorkspaceError('Target must be an existing UTF-8 file up to 1 MB.')
        if not old_text:
            raise WorkspaceError('old_text may not be empty.')
        source = target.read_text(encoding='utf-8')
        if source.count(old_text) != 1:
            raise WorkspaceError('old_text must occur exactly once to avoid unintended changes.')
        return self.write_file(str(target), source.replace(old_text, new_text, 1), overwrite=True)

    def move_file(self, source: str, destination: str) -> str:
        self._require_write()
        src = self.resolve(source)
        dst = self.resolve(destination)
        if not src.is_file() or dst.exists():
            raise WorkspaceError('Source must be a file and destination must not exist.')
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(src), str(dst))
        self._audit('move_file', dst)
        return f'Moved {src} to {dst}'

    def delete_file(self, path: str) -> dict:
        """Move to a private workspace trash folder instead of permanent deletion."""
        self._require_write()
        target = self.resolve(path)
        if not target.is_file() or target.is_symlink():
            raise WorkspaceError('Only regular files can be moved to the trash.')
        root = self._root_for(target)
        trash = root / '.winbridge_trash'
        trash.mkdir(exist_ok=True)
        item_id = uuid4().hex
        # Only JSON metadata is stored; no file content is copied into the manifest.
        trashed = trash / f'{item_id}.file'
        shutil.move(str(target), str(trashed))
        (trash / f'{item_id}.json').write_text(json.dumps({'original': str(target)}), encoding='utf-8')
        self._audit('delete_file_to_trash', target)
        return {'deleted_from_workspace': str(target), 'restore_id': item_id,
                'message': 'File moved to recoverable trash.'}

    def restore_file(self, restore_id: str, workspace_index: int = 0) -> str:
        self._require_write()
        if len(restore_id) != 32 or any(c not in '0123456789abcdef' for c in restore_id):
            raise WorkspaceError('Invalid restore ID.')
        if workspace_index < 0 or workspace_index >= len(self.roots):
            raise WorkspaceError('Invalid workspace index.')
        trash = self.roots[workspace_index] / '.winbridge_trash'
        data_path, meta_path = trash / f'{restore_id}.file', trash / f'{restore_id}.json'
        if not data_path.is_file() or not meta_path.is_file():
            raise WorkspaceError('Trash item not found.')
        target = self.resolve(json.loads(meta_path.read_text(encoding='utf-8'))['original'])
        if target.exists():
            raise WorkspaceError('Original path is occupied; refusing to overwrite.')
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(data_path), str(target))
        meta_path.unlink()
        self._audit('restore_file', target)
        return f'Restored {target}'

    def search_text(self, query: str, limit: int = 30) -> dict:
        if not query or len(query) > 200:
            raise WorkspaceError('Search query must contain 1 to 200 characters.')
        limit = min(max(limit, 1), 100)
        matches, scanned = [], 0
        for root in self.roots:
            for current, folders, filenames in os.walk(root, followlinks=False):
                folders[:] = [f for f in folders if f not in SKIP_DIRS and not self._is_sensitive(f)
                              and not (Path(current) / f).is_symlink()]
                for name in filenames:
                    if self._is_sensitive(name):
                        continue
                    try:
                        file = self.resolve(str(Path(current) / name))
                        if not file.is_file() or file.stat().st_size > MAX_TEXT_BYTES:
                            continue
                        scanned += 1
                        if scanned > 1000:
                            return {'matches': matches, 'scanned': scanned - 1, 'truncated': True}
                        for number, line in enumerate(file.read_text(encoding='utf-8').splitlines(), 1):
                            if query.casefold() in line.casefold():
                                matches.append({'file': str(file), 'line': number, 'text': line[:300]})
                                if len(matches) >= limit:
                                    return {'matches': matches, 'scanned': scanned, 'truncated': True}
                    except (OSError, UnicodeError, WorkspaceError):
                        continue
        return {'matches': matches, 'scanned': scanned, 'truncated': False}

    def terminal_task(self, task: str, cwd: str = '.') -> dict:
        """Run one of a fixed set of read-only diagnostics, never a shell string."""
        directory = self.resolve(cwd, allow_root=True)
        if not directory.is_dir():
            raise WorkspaceError('Working directory does not exist.')
        choices = {
            'git_status': ['git', 'status', '--short'],
            'git_diff': ['git', 'diff', '--'],
            'git_log': ['git', 'log', '-5', '--oneline'],
            'python_version': [sys.executable, '--version'],
        }
        if task not in choices:
            raise WorkspaceError(f'Unsupported task. Choose: {", ".join(choices)}')
        try:
            process = subprocess.run(choices[task], cwd=directory, shell=False,
                                     capture_output=True, text=True, encoding='utf-8',
                                     errors='replace', timeout=12, check=False)
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise WorkspaceError(str(exc)) from exc
        output = (process.stdout + process.stderr)[:MAX_RESULT_CHARS]
        return {'task': task, 'return_code': process.returncode, 'output': output}


    def create_directory(self, path: str) -> str:
        """Create a directory below an existing authorized workspace root."""
        self._require_write()
        target = self.resolve(path)
        if target.exists() and not target.is_dir():
            raise WorkspaceError("A non-directory already exists at this path.")
        target.mkdir(parents=True, exist_ok=True)
        self._audit("create_directory", target)
        return f"Directory ready: {target}"

    def preview_text_edit(self, path: str, old_text: str, new_text: str) -> dict:
        """Compute an exact-match edit preview without changing anything."""
        import difflib
        target = self.resolve(path)
        if not target.is_file() or target.stat().st_size > MAX_TEXT_BYTES:
            raise WorkspaceError("Target must be a UTF-8 text file up to 1 MB.")
        if not old_text:
            raise WorkspaceError("old_text may not be empty.")
        source = target.read_text(encoding="utf-8")
        count = source.count(old_text)
        if count != 1:
            raise WorkspaceError(f"Expected exactly one match; found {count}.")
        proposed = source.replace(old_text, new_text, 1)
        if len(proposed.encode("utf-8")) > MAX_TEXT_BYTES:
            raise WorkspaceError("Proposed content exceeds 1 MB.")
        diff = "\n".join(difflib.unified_diff(
            source.splitlines(), proposed.splitlines(),
            fromfile=f"a/{target.name}", tofile=f"b/{target.name}",
            lineterm=""
        ))
        return {"path": str(target), "diff": diff[:MAX_RESULT_CHARS],
                "truncated": len(diff) > MAX_RESULT_CHARS, "applied": False}

    def trash_list(self, workspace_index: int = 0) -> list[dict]:
        """List recoverable deletion IDs; do not read private trash contents."""
        if workspace_index < 0 or workspace_index >= len(self.roots):
            raise WorkspaceError("Invalid workspace index.")
        trash = self.roots[workspace_index] / ".winbridge_trash"
        if not trash.is_dir():
            return []
        result = []
        for meta in sorted(trash.glob("*.json"), reverse=True)[:100]:
            if len(meta.stem) != 32 or not all(ch in "0123456789abcdef" for ch in meta.stem):
                continue
            if not (trash / f"{meta.stem}.file").is_file():
                continue
            try:
                original = str(json.loads(meta.read_text(encoding="utf-8"))["original"])
                self.resolve(original)
                result.append({"restore_id": meta.stem, "original": original})
            except (ValueError, KeyError, OSError, WorkspaceError):
                continue
        return result

    def python_syntax_check(self, path: str = ".") -> dict:
        """Parse Python files statically: no imports, scripts or shell execution."""
        import ast
        target = self.resolve(path, allow_root=True)
        if not target.exists():
            raise WorkspaceError("Path not found.")
        checked = 0
        errors = []
        if target.is_file():
            candidates = [target]
        else:
            candidates = []
            for folder, subfolders, filenames in os.walk(target, followlinks=False):
                subfolders[:] = [
                    name for name in subfolders if name not in SKIP_DIRS
                    and not self._is_sensitive(name)
                    and not (Path(folder) / name).is_symlink()
                ]
                for name in filenames:
                    if name.endswith(".py") and not self._is_sensitive(name):
                        candidates.append(Path(folder) / name)
                        if len(candidates) >= 100:
                            break
                if len(candidates) >= 100:
                    break
        for candidate in candidates:
            try:
                resolved = self.resolve(str(candidate))
                if resolved.suffix != ".py":
                    continue
                if resolved.stat().st_size > MAX_TEXT_BYTES:
                    errors.append({"path": str(resolved), "error": "File too large."})
                    continue
                ast.parse(resolved.read_text(encoding="utf-8"), filename=str(resolved))
                checked += 1
            except (SyntaxError, UnicodeError, OSError, WorkspaceError) as exc:
                errors.append({"path": str(candidate), "error": str(exc)[:500]})
        return {"checked": checked, "errors": errors[:100],
                "ok": not errors, "truncated": len(candidates) >= 100}
