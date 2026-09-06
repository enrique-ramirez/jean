"""Register and recorded measurements, in prose only.

Comment lines in code and body text in markdown are checked. Code, strings and
fixture data never are: the judgement half of `.claude/prose.txt` is ordinary
English and would fire on an album title or a genre name.

Prints one line per problem and exits 0 either way. `check-style.sh` decides.
"""

import re
import sys


def prose_lines(path: str, text: str) -> list[tuple[int, str]]:
    """The lines a human wrote as prose, numbered from one."""
    out: list[tuple[int, str]] = []
    fenced = False
    in_block = False
    for number, line in enumerate(text.split("\n"), 1):
        stripped = line.strip()
        if path.endswith(".md"):
            if stripped.startswith("```"):
                fenced = not fenced
                continue
            if not fenced and stripped and not line.startswith("    "):
                out.append((number, line))
            continue
        opens = "/*" in stripped
        if opens:
            in_block = True
        keep = in_block or stripped.startswith("//") or stripped.startswith("*")
        if "*/" in stripped:
            in_block = False
        if keep:
            out.append((number, line))
    return out


# A number somebody measured, as against a limit the outside world imposes.
# `~6 ms` and `measured at 40 MB` go; `over 1 MiB` and `under 16px` stay.
RECORDED = re.compile(
    r"~\s*[\d.]+\s*(ms|s\b|MB|MiB|GB|kB|kbps|fps)"
    r"|\bmeasured\s+(at|around|about)?\s*~?\s*[\d.]+\s*(ms|s\b|MB|MiB|GB|kB|kbps)"
    r"|\b(costs?|takes?|spends?)\s+(about|around|roughly|~)?\s*[\d.]+\s*(ms|s\b|MB|MiB|GB)"
    r"|\b(roughly|about|around)\s+[\d.]+\s*(ms|MB|MiB|GB|kB|kbps)",
    re.IGNORECASE,
)


def main() -> int:
    path, listing = sys.argv[1], sys.argv[2]
    text = open(path, encoding="utf-8", errors="replace").read()
    phrases = [
        line[1:].strip().lower()
        for line in open(listing, encoding="utf-8")
        if line.startswith("!") and line[1:].strip()
    ]

    problems: list[str] = []
    for number, line in prose_lines(path, text):
        lowered = line.lower()
        hit = next((p for p in phrases if p in lowered), None)
        if hit:
            problems.append(f"line {number}: \"{hit}\" reads as an assistant. See .claude/prose.txt.")
        elif RECORDED.search(line):
            problems.append(f"line {number}: reads as a recorded measurement. Keep the constraint, drop the number.")

    for problem in problems[:6]:
        print(problem)
    return 0


if __name__ == "__main__":
    sys.exit(main())
