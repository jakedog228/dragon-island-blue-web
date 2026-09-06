#!/bin/sh
# Traffic and player-activity report for the Dragon Island Blue deployment.
#
# Run on the deployment host:
#   sudo deploy/traffic-report.sh              # last 7 days
#   sudo deploy/traffic-report.sh --days 30
#   sudo deploy/traffic-report.sh --days 1 --json
#
# Reads the persisted Caddy access log and the game server log straight from their Docker volumes,
# so it reports over the full retained history rather than the current container's lifetime. It
# opens the logs read-only and never writes, which makes it safe to run against production at will.
#
# Why a script rather than an analytics service: the deployment is single-VM and deliberately has no
# third-party beacon in the client. Everything below is derived from logs the stack already writes.

set -eu

DAYS=7
FORMAT=text

while [ $# -gt 0 ]; do
	case "$1" in
		--days)
			[ $# -ge 2 ] || { echo "--days needs a value" >&2; exit 2; }
			DAYS=$2
			shift 2
			;;
		--json)
			FORMAT=json
			shift
			;;
		-h|--help)
			sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
			exit 0
			;;
		*)
			echo "unknown argument: $1" >&2
			exit 2
			;;
	esac
done

case "$DAYS" in
	''|*[!0-9]*) echo "--days must be a positive integer; got '$DAYS'" >&2; exit 2 ;;
esac
[ "$DAYS" -gt 0 ] || { echo "--days must be greater than zero" >&2; exit 2; }

command -v docker >/dev/null 2>&1 || { echo "docker is not on PATH" >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "python3 is required" >&2; exit 1; }

volume_path() {
	# Empty output rather than a hard failure: a stack deployed before the log volumes existed should
	# still get a partial report instead of an error.
	docker volume inspect "$1" --format '{{.Mountpoint}}' 2>/dev/null || true
}

CADDY_LOGS=$(volume_path dib_caddy-logs)
GAME_LOGS=$(volume_path dib_game-logs)

if [ -z "$CADDY_LOGS" ] && [ -z "$GAME_LOGS" ]; then
	echo "Neither dib_caddy-logs nor dib_game-logs exists." >&2
	echo "Redeploy with the current deploy/compose.yaml to create them." >&2
	exit 1
fi

# Rolled generations are concatenated with the active file. Order does not matter: every record
# carries its own timestamp and the reporter sorts on that.
collect() {
	directory=$1
	pattern=$2
	[ -n "$directory" ] && [ -d "$directory" ] || return 0
	find "$directory" -maxdepth 1 -type f -name "$pattern" 2>/dev/null | while read -r file; do
		case "$file" in
			*.gz) gzip -dc -- "$file" 2>/dev/null || true ;;
			*) cat -- "$file" 2>/dev/null || true ;;
		esac
	done
}

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT INT TERM

collect "$CADDY_LOGS" 'access.log*' > "$WORK/access.jsonl"
collect "$GAME_LOGS" 'game.log*' > "$WORK/game.jsonl"

DAYS="$DAYS" FORMAT="$FORMAT" ACCESS="$WORK/access.jsonl" GAME="$WORK/game.jsonl" python3 - <<'PYTHON'
import collections
import datetime
import json
import os
import re
import sys

days = int(os.environ["DAYS"])
fmt = os.environ["FORMAT"]
now = datetime.datetime.now(datetime.timezone.utc)
cutoff = now - datetime.timedelta(days=days)


def load(path):
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    yield json.loads(line)
                except json.JSONDecodeError:
                    continue
    except OSError:
        return


# Caddy stamps `ts` as epoch seconds; the game server stamps ISO-8601 `time`.
def timestamp(record):
    raw = record.get("ts")
    if isinstance(raw, (int, float)):
        return datetime.datetime.fromtimestamp(raw, datetime.timezone.utc)
    raw = record.get("time")
    if isinstance(raw, str):
        try:
            return datetime.datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None


# Self-identified automation. This is deliberately generous: the goal is to stop bot noise from
# being reported as an audience, so a false positive costs less than a false negative. Anything not
# matched here is reported as "unclassified", NOT as a confirmed human.
BOT_PATTERN = re.compile(
    r"bot|crawl|spider|scrape|slurp|scan|monitor|check|probe|preview|fetch|"
    r"curl|wget|python-requests|go-http|okhttp|java/|libwww|headless|lighthouse|"
    r"postman|axios|powershell",
    re.IGNORECASE,
)

# Paths nothing legitimate on this host ever requests. A client asking for them is enumerating.
INTRUSION_PATTERN = re.compile(
    r"^/(wp-|wordpress|xmlrpc|\.env|\.git|admin|phpmyadmin|vendor/|cgi-bin|"
    r"actuator|solr|boaform|hudson|jenkins|owa/|autodiscover)|"
    r"/\.env|/config\.json|/\.aws|/id_rsa",
    re.IGNORECASE,
)

PROBE_PATHS = {"/api/game/health", "/api/game/readiness"}

access = []
for record in load(os.environ["ACCESS"]):
    if record.get("msg") != "handled request":
        continue
    when = timestamp(record)
    if when is None or when < cutoff:
        continue
    request = record.get("request", {}) or {}
    headers = request.get("headers", {}) or {}
    agent = (headers.get("User-Agent") or [""])[0]
    access.append({
        "when": when,
        "ip": request.get("remote_ip", "unknown"),
        "method": request.get("method", "?"),
        "host": (request.get("host") or "").split(":")[0],
        "path": (request.get("uri") or "/").split("?")[0],
        "status": record.get("status", 0),
        "agent": agent,
        "bot": bool(BOT_PATTERN.search(agent)) or not agent,
    })

game = []
for record in load(os.environ["GAME"]):
    if record.get("msg") != "game request":
        continue
    when = timestamp(record)
    if when is None or when < cutoff:
        continue
    game.append({
        "when": when,
        "path": record.get("path", "?"),
        "status": record.get("status", 0),
        "player": record.get("playerId"),
        "address": record.get("clientAddress", "unknown"),
        "duration": record.get("durationMs", 0.0),
    })

# The site's own hostnames, learned from what actually resolved here rather than hardcoded: requests
# addressed to a bare IP or to someone else's domain are scanners using this host as an open proxy.
site_hosts = collections.Counter(
    row["host"] for row in access
    if row["host"] and not re.match(r"^[\d.]+$|^\[?[0-9a-f:]+\]?$", row["host"])
)
primary_hosts = {host for host, count in site_hosts.items() if count >= max(3, len(access) // 200)}

on_site = [row for row in access if row["host"] in primary_hosts]
misdirected = [row for row in access if row["host"] not in primary_hosts]
intrusion = [row for row in on_site if INTRUSION_PATTERN.search(row["path"])]
human_candidate = [
    row for row in on_site
    if not row["bot"] and not INTRUSION_PATTERN.search(row["path"])
]

real_game = [row for row in game if row["path"] not in PROBE_PATHS]
players = collections.Counter(row["player"] for row in real_game if row["player"])
by_player_day = collections.defaultdict(set)
for row in real_game:
    if row["player"]:
        by_player_day[row["when"].date().isoformat()].add(row["player"])

summary = {
    "generatedAt": now.isoformat(),
    "windowDays": days,
    "oldestRecord": min(
        [row["when"] for row in access] + [row["when"] for row in game],
        default=None,
    ),
    "edgeRequests": len(access),
    "onSiteRequests": len(on_site),
    "misdirectedRequests": len(misdirected),
    "intrusionProbes": len(intrusion),
    "humanCandidateRequests": len(human_candidate),
    "uniqueClients": len({row["ip"] for row in on_site}),
    "uniqueHumanCandidateClients": len({row["ip"] for row in human_candidate}),
    "apiRequests": len(real_game),
    "distinctPlayers": len(players),
}

if fmt == "json":
    payload = dict(summary)
    payload["oldestRecord"] = summary["oldestRecord"].isoformat() if summary["oldestRecord"] else None
    payload["playersByDay"] = {day: sorted(ids) for day, ids in sorted(by_player_day.items())}
    payload["topPaths"] = collections.Counter(row["path"] for row in on_site).most_common(20)
    payload["statusCounts"] = dict(collections.Counter(row["status"] for row in on_site))
    json.dump(payload, sys.stdout, indent=2)
    sys.stdout.write("\n")
    sys.exit(0)


def heading(text):
    print(f"\n{text}")
    print("-" * len(text))


print(f"Dragon Island Blue traffic report - last {days} day(s), to {now:%Y-%m-%d %H:%M} UTC")
if summary["oldestRecord"]:
    print(f"Oldest retained record in window: {summary['oldestRecord']:%Y-%m-%d %H:%M} UTC")
else:
    print("No log records found in this window.")
    sys.exit(0)

heading("Edge traffic")
print(f"  Total requests reaching Caddy      {summary['edgeRequests']:>8}")
print(f"  Addressed to this site             {summary['onSiteRequests']:>8}")
print(f"  Addressed elsewhere (proxy abuse)  {summary['misdirectedRequests']:>8}")
print(f"  Intrusion probes on this site      {summary['intrusionProbes']:>8}")
print(f"  Unclassified (possible humans)     {summary['humanCandidateRequests']:>8}"
      f"  from {summary['uniqueHumanCandidateClients']} client(s)")

if on_site:
    heading("Status codes (this site)")
    for status, count in sorted(collections.Counter(row["status"] for row in on_site).items()):
        print(f"  {status}  {count:>7}")

    heading("Requests per day (this site)")
    per_day = collections.Counter(row["when"].date().isoformat() for row in on_site)
    human_per_day = collections.Counter(row["when"].date().isoformat() for row in human_candidate)
    print(f"  {'date':<12} {'total':>7} {'unclassified':>13}")
    for day in sorted(per_day):
        print(f"  {day:<12} {per_day[day]:>7} {human_per_day.get(day, 0):>13}")

    heading("Top paths (this site)")
    for path, count in collections.Counter(row["path"] for row in on_site).most_common(12):
        print(f"  {count:>6}  {path}")

    heading("Top user agents (this site)")
    for agent, count in collections.Counter(
        (row["agent"] or "<none>")[:72] for row in on_site
    ).most_common(8):
        print(f"  {count:>6}  {agent}")

heading("Game API and players")
if not game:
    print("  No game server records in this window.")
    print("  (Request logging landed with the observability change; older deployments logged none.)")
else:
    print(f"  Non-probe API requests             {summary['apiRequests']:>8}")
    print(f"  Distinct players                   {summary['distinctPlayers']:>8}")
    if players:
        print("\n  Active players per day:")
        for day in sorted(by_player_day):
            print(f"    {day}  {len(by_player_day[day])} player(s)")
        print("\n  Requests per player (id truncated):")
        for player, count in players.most_common(15):
            print(f"    {player[:12]}  {count:>6}")
    failures = [row for row in real_game if row["status"] >= 400]
    if failures:
        print(f"\n  Failed API requests: {len(failures)}")
        for (path, status), count in collections.Counter(
            (row["path"], row["status"]) for row in failures
        ).most_common(8):
            print(f"    {status}  {count:>5}  {path}")

print()
PYTHON
