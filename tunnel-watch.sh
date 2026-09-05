#!/bin/bash
# tunnel-watch.sh — keep the published MCP registry endpoint alive.
# When the cloudflared quick tunnel hostname rotates, repoint server.json,
# glama.json AND every README live-endpoint block in the casper-tools repo,
# tag a new patch version, and push the tag so the GitHub Actions workflow
# republishes to the official MCP registry. Keeps every discoverable surface
# (registry + Glama + README) pointing at the current live URL.
set -u

MCP_DIR="/home/ubuntu/agentic-tools/mcp-server"
REPO_DIR="/home/ubuntu/casper-tools"
STATE="$MCP_DIR/.tunnel-url"
ANALYTICS="$MCP_DIR/logs/calls.jsonl"

detect_url() {
  journalctl -u mcp-cloudflared --no-pager -n 2000 2>/dev/null \
    | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1
}

is_live() {
  local u="$1"
  curl -s -m 8 -X POST "$u/mcp" \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' \
    -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"tunnel-watch","version":"1"}}}' \
    2>/dev/null | grep -q '"serverInfo"'
}

repoint() {
  local new="$1"
  python3 - "$MCP_DIR/server.json" "$REPO_DIR/server.json" "$REPO_DIR/glama.json" "$REPO_DIR/README.md" "$new" <<'PYEOF'
import json, sys, re
deployed, repo, glama, readme, newurl = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]
needle = "trycloudflare.com"
changed = False
for p in (deployed, repo, glama):
    with open(p) as f:
        d = json.load(f)
    for r in d.get("remotes", []):
        if r.get("type") == "streamable-http" and r.get("url", "").endswith(needle):
            r["url"] = newurl
            changed = True
    with open(p, "w") as f:
        json.dump(d, f, indent=2)
        f.write("\n")
with open(readme) as f:
    readme_text = f.read()
new_readme, n = re.subn(r'https://[a-z0-9-]+\.trycloudflare\.com(?:/mcp)?', newurl, readme_text)
if n:
    changed = True
    with open(readme, "w") as f:
        f.write(new_readme)
sys.exit(0 if changed else 1)
PYEOF
}

NEW="$(detect_url)"
[ -z "$NEW" ] && exit 0

if [ ! -f "$STATE" ]; then
  printf '%s\n' "$NEW" > "$STATE"
  exit 0
fi

# Only fast-exit if state matches AND server.json already carries the same URL.
CURRENT_DEPLOYED_URL="$(python3 -c "import json;print(json.load(open('$MCP_DIR/server.json'))['remotes'][0]['url'])" 2>/dev/null)"
if [ "$NEW" = "$(cat "$STATE" 2>/dev/null)" ] && [ "$CURRENT_DEPLOYED_URL" = "$NEW" ]; then
  exit 0
fi

if ! is_live "$NEW"; then
  exit 0
fi

# Repoint FIRST; only persist state after the repoint+push actually succeeds,
# so a failed push never leaves STATE ahead of the deployed server.json.
repoint "$NEW" || exit 0

cd "$REPO_DIR" || exit 1
git add server.json glama.json README.md >/dev/null 2>&1
git commit -m "chore: repoint MCP registry + Glama + README to current tunnel URL" >/dev/null 2>&1 || true
git push origin main >/dev/null 2>&1 || exit 1

printf '%s\n' "$NEW" > "$STATE"

# Re-index mcprepository from GitHub so the external listing follows the
# repointed server.json instead of serving a stale dead tunnel URL.
curl -s -m 20 -X POST https://mcprepository.com/api/index \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://github.com/magiautonomous/casper-tools"}' \
  -o /dev/null 2>/dev/null || true

LATEST="$(git tag | grep '^v' | sort -V | tail -1)"
PATCH="$(printf '%s' "$LATEST" | sed 's/^v//' | awk -F. '{print $NF+1}')"
BASE="$(printf '%s' "$LATEST" | sed 's/^v//' | awk -F. '{print $1"."$2}')"
NEWTAG="v${BASE}.${PATCH}"

git tag "$NEWTAG" >/dev/null 2>&1
git push origin "$NEWTAG" >/dev/null 2>&1 || exit 1

if [ -f "$ANALYTICS" ]; then
  printf '{"event":"tunnel_rotation","url":"%s","tag":"%s","ts":"%s","surfaces":"registry+glama+readme+mcprepository"}\n' \
    "$NEW" "$NEWTAG" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$ANALYTICS"
fi

echo "republished to $NEWTAG url=$NEW surfaces=registry+glama+readme"