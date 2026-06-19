#!/usr/bin/env python3
"""
Rewrite every package.json under a workspace so that any dep listed in the
pnpm-workspace.yaml catalog uses the "catalog:" reference.

- dependencies   → rewritten
- devDependencies → rewritten
- peerDependencies → LEFT ALONE (those keep their broad ranges by design)

Preserves 4-space indentation (matches both repos' convention) and a trailing
newline.

Usage:
    python scripts/apply-catalog.py /path/to/repo

Run separately in each repo (upstream + private).
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


def load_catalog_names(workspace_yaml: Path) -> set[str]:
    """Extract the set of dep names from the workspace's `catalog:` block.

    We don't depend on PyYAML; the block is simple enough to parse line-by-line:
    everything indented under the `catalog:` key, up to the next dedent or EOF.
    """
    names: set[str] = set()
    in_catalog = False
    for raw in workspace_yaml.read_text().splitlines():
        stripped = raw.rstrip()
        if not in_catalog:
            if stripped.rstrip(":") == "catalog":
                in_catalog = True
            continue
        if not stripped or stripped.lstrip().startswith("#"):
            continue
        # Any line that isn't indented ends the block.
        if not (raw.startswith(" ") or raw.startswith("\t")):
            break
        # Match `  name: value` or `  'name': value` or `  "name": value`.
        m = re.match(r"\s+(['\"]?)([^'\":]+)\1:\s*\S", raw)
        if m:
            names.add(m.group(2).strip())
    return names


def rewrite_package(pkg_path: Path, catalog: set[str]) -> bool:
    """Rewrite a package.json in place. Returns True if anything changed."""
    text = pkg_path.read_text()
    data = json.loads(text)
    changed = False
    for section in ("dependencies", "devDependencies"):
        block = data.get(section)
        if not isinstance(block, dict):
            continue
        for name, value in list(block.items()):
            if name not in catalog:
                continue
            if not isinstance(value, str):
                continue
            if value.startswith("workspace:") or value.startswith("file:"):
                continue
            if value == "catalog:":
                continue
            block[name] = "catalog:"
            changed = True
    if not changed:
        return False
    # Detect existing indent from the file's first nested line, defaulting to 4.
    indent = 4
    m = re.search(r"^( +)\"", text, re.MULTILINE)
    if m:
        indent = len(m.group(1))
    new_text = json.dumps(data, indent=indent, ensure_ascii=False) + "\n"
    pkg_path.write_text(new_text)
    return True


def main(repo_root: Path) -> int:
    workspace_yaml = repo_root / "pnpm-workspace.yaml"
    if not workspace_yaml.exists():
        print(f"missing {workspace_yaml}", file=sys.stderr)
        return 1
    catalog = load_catalog_names(workspace_yaml)
    if not catalog:
        print("catalog is empty; refusing to rewrite anything", file=sys.stderr)
        return 1
    print(f"[apply-catalog] {len(catalog)} cataloged deps")

    changed_files: list[Path] = []
    for sub in ("apps", "packages"):
        base = repo_root / sub
        if not base.is_dir():
            continue
        for pkg in sorted(base.glob("*/package.json")):
            if rewrite_package(pkg, catalog):
                changed_files.append(pkg)

    root_pkg = repo_root / "package.json"
    if root_pkg.exists() and rewrite_package(root_pkg, catalog):
        changed_files.append(root_pkg)

    for f in changed_files:
        print(f"[apply-catalog] rewrote {f.relative_to(repo_root)}")
    print(f"[apply-catalog] {len(changed_files)} files changed")
    return 0


if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.cwd()
    sys.exit(main(target.resolve()))
