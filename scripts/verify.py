#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
ALLOW_NO_CHECKS = os.getenv("HARNESS_ALLOW_NO_CHECKS", "0") == "1"
ran = []
failed = []


def banner(text: str) -> None:
    print(f"\n=== {text} ===", flush=True)


def run(label: str, cmd: list[str]) -> bool:
    banner(label)
    print("$ " + " ".join(cmd), flush=True)
    ran.append(label)
    result = subprocess.run(cmd, cwd=ROOT)
    if result.returncode != 0:
        failed.append((label, result.returncode))
        print(f"[FAIL] {label} exited with {result.returncode}", flush=True)
        return False
    print(f"[PASS] {label}", flush=True)
    return True


def command_exists(name: str) -> bool:
    return shutil.which(name) is not None


def package_manager() -> str | None:
    if (ROOT / "pnpm-lock.yaml").exists() and command_exists("pnpm"):
        return "pnpm"
    if (ROOT / "yarn.lock").exists() and command_exists("yarn"):
        return "yarn"
    if ((ROOT / "bun.lock").exists() or (ROOT / "bun.lockb").exists()) and command_exists("bun"):
        return "bun"
    if command_exists("npm"):
        return "npm"
    return None


def js_script_command(pm: str, script: str) -> list[str]:
    if pm == "npm":
        return ["npm", "run", script]
    if pm == "yarn":
        return ["yarn", script]
    if pm == "pnpm":
        return ["pnpm", "run", script]
    if pm == "bun":
        return ["bun", "run", script]
    raise ValueError(pm)


def verify_javascript() -> None:
    pkg = ROOT / "package.json"
    if not pkg.exists():
        return

    try:
        data = json.loads(pkg.read_text(encoding="utf-8"))
    except Exception as exc:
        failed.append(("package.json parse", 1))
        print(f"[FAIL] Could not parse package.json: {exc}")
        return

    scripts = data.get("scripts") or {}
    pm = package_manager()
    if pm is None:
        print("[WARN] package.json found but no supported package manager command is available.")
        return

    candidates = [
        ("JS lint", ["lint"]),
        ("JS typecheck", ["typecheck", "type-check", "check:types", "check-types"]),
        ("JS test", ["test", "test:unit"]),
        ("JS build", ["build"]),
    ]

    used = set()
    for label, names in candidates:
        selected = next((name for name in names if name in scripts and name not in used), None)
        if not selected:
            continue

        body = str(scripts.get(selected, ""))
        if selected == "test" and "no test specified" in body.lower():
            print("[WARN] Skipping placeholder npm test script.")
            continue

        used.add(selected)
        run(f"{label} ({selected})", js_script_command(pm, selected))


def module_available(name: str) -> bool:
    try:
        return importlib.util.find_spec(name) is not None
    except Exception:
        return False


def verify_python() -> None:
    pyproject = ROOT / "pyproject.toml"
    requirements = ROOT / "requirements.txt"
    setup_py = ROOT / "setup.py"
    python_files = list(ROOT.glob("*.py"))
    tests_dir = ROOT / "tests"

    if not (pyproject.exists() or requirements.exists() or setup_py.exists() or python_files or tests_dir.exists()):
        return

    py = sys.executable

    if module_available("ruff"):
        run("Python ruff", [py, "-m", "ruff", "check", "."])

    if module_available("mypy") and pyproject.exists():
        text = pyproject.read_text(encoding="utf-8", errors="ignore").lower()
        if "mypy" in text:
            run("Python mypy", [py, "-m", "mypy", "."])

    has_pytest_signal = tests_dir.exists()
    if pyproject.exists():
        text = pyproject.read_text(encoding="utf-8", errors="ignore").lower()
        has_pytest_signal = has_pytest_signal or "pytest" in text

    if has_pytest_signal and module_available("pytest"):
        run("Python pytest", [py, "-m", "pytest", "-q"])


def verify_rust() -> None:
    if (ROOT / "Cargo.toml").exists() and command_exists("cargo"):
        run("Rust cargo check", ["cargo", "check"])
        run("Rust cargo test", ["cargo", "test"])


def verify_go() -> None:
    if (ROOT / "go.mod").exists() and command_exists("go"):
        run("Go test", ["go", "test", "./..."])


def verify_swift() -> None:
    if (ROOT / "Package.swift").exists() and command_exists("swift"):
        run("Swift test", ["swift", "test"])


def verify_gradle() -> None:
    wrapper = ROOT / "gradlew"
    if wrapper.exists():
        run("Gradle test", [str(wrapper), "test"])


def make_has_target(target: str) -> bool:
    makefile = ROOT / "Makefile"
    if not makefile.exists():
        return False
    for line in makefile.read_text(encoding="utf-8", errors="ignore").splitlines():
        if line.startswith(target + ":"):
            return True
    return False


def verify_make() -> None:
    if not command_exists("make"):
        return
    if make_has_target("check"):
        run("Make check", ["make", "check"])
    elif make_has_target("test"):
        run("Make test", ["make", "test"])


def main() -> int:
    print(f"[HARNESS] Project: {ROOT}")
    verify_javascript()
    verify_python()
    verify_rust()
    verify_go()
    verify_swift()
    verify_gradle()
    verify_make()

    banner("HARNESS SUMMARY")

    if failed and not ran:
        print(f"Failures before validation commands: {len(failed)}")
        for label, code in failed:
            print(f" - {label}: exit {code}")
        return 1

    if not ran:
        message = "No supported validation command was detected."
        if ALLOW_NO_CHECKS:
            print(f"[WARN] {message} HARNESS_ALLOW_NO_CHECKS=1, so verification is allowed.")
            return 0
        print(f"[FAIL] {message}")
        print("Add a project validation command or run with HARNESS_ALLOW_NO_CHECKS=1 only when this is intentional.")
        return 2

    print(f"Checks run: {len(ran)}")
    if failed:
        print(f"Failures: {len(failed)}")
        for label, code in failed:
            print(f" - {label}: exit {code}")
        return 1

    print("All detected checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
