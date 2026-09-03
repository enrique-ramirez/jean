#!/usr/bin/env bash
# Flags the style regressions that are mechanically decidable. Comment *quality* is not,
# and is not attempted here -- CONTRIBUTING.md owns that. This only catches the things a
# grep can be sure about, so a hit is a real violation rather than a suggestion.
set -uo pipefail

file=$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("tool_input",{}).get("file_path",""))' 2>/dev/null)
[ -n "$file" ] && [ -f "$file" ] || exit 0

# Files whose subject is the rules must quote the phrases the rules forbid, so they cannot
# be checked by them.
case "$file" in
  */third_party/*|*/sdk/*|*/node_modules/*|*/.git/*|*.local.md|*/_todo/*) exit 0 ;;
  */.claude/*|*/CONTRIBUTING.md) exit 0 ;;
esac

problems=()

# Personal detail. Public repos; placeholders instead. Repo URLs are deliberately allowed.
if grep -nIE 'user1@|home\.local|10\.100\.100|Musica|Enriques-|MacBook' "$file" >/dev/null 2>&1; then
  problems+=("personal detail (host, address or library path). Use a placeholder such as <player-host> or C:\\Music.")
fi
if grep -nIE '\bEnrique\b' "$file" 2>/dev/null | grep -vE 'github\.com/enrique-ramirez' >/dev/null 2>&1; then
  problems+=("names a person. Docs and comments describe the code, not who decided what.")
fi

# History. Git holds it.
if grep -nIE 'measured on [0-9]|a review pass|an earlier version|this used to|it used to|used to read|used to be' "$file" >/dev/null 2>&1; then
  problems+=("records history (what something used to be, or a dated measurement). Git holds that; state only what is true now.")
fi

# Markdown paragraphs hard-wrapped at ~80 columns.
case "$file" in
  *.md)
    if python3 - "$file" <<'PY' >/dev/null 2>&1
import re,sys
lines=open(sys.argv[1],encoding='utf-8',errors='replace').read().split('\n')
fenced=False; run=0
for ln in lines:
    if ln.lstrip().startswith('```'): fenced=not fenced; run=0; continue
    prose=(not fenced and ln.strip() and not re.match(r'^\s*([|>#\-*+]|\d+\.|\s{4})',ln))
    run = run+1 if prose and 60<=len(ln)<=92 else 0
    if run>=3: sys.exit(0)
sys.exit(1)
PY
    then problems+=("looks hard-wrapped near 80 columns. One paragraph is one line; editors wrap.")
    fi ;;
esac

[ ${#problems[@]} -eq 0 ] && exit 0

{
  echo "Style check on ${file#"$CLAUDE_PROJECT_DIR/"}:"
  for p in "${problems[@]}"; do echo "  - $p"; done
  echo "See CONTRIBUTING.md. Fix it now rather than leaving it for a later pass."
} >&2
exit 2
