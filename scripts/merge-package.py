#!/usr/bin/env python3
import json
from pathlib import Path
import sys

root = Path(sys.argv[1]).resolve()
template_path = Path(sys.argv[2]).resolve()
package_path = root / "package.json"

template = json.loads(template_path.read_text(encoding="utf-8"))

if package_path.exists():
    current = json.loads(package_path.read_text(encoding="utf-8"))
else:
    current = {
        "name": "codex-of-duty",
        "version": "0.1.0",
        "private": True,
        "type": "module",
    }

for key in ["scripts", "dependencies", "devDependencies"]:
    current.setdefault(key, {})
    for name, value in template.get(key, {}).items():
        if name not in current[key]:
            current[key][name] = value

current.setdefault("private", True)
current.setdefault("type", "module")

package_path.write_text(
    json.dumps(current, ensure_ascii=False, indent=2) + "\n",
    encoding="utf-8",
)
print(f"Merged package config -> {package_path}")
