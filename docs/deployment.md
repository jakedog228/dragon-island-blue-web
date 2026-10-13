# Deploying the Official online game server

Runbook for standing up `apps/game-server` (the token-gated authoritative service) and `apps/web`
(the browser client) behind TLS on a single host.

The current release uses `official-game-v26`. Deploy matching web and server revisions.
The CLI migration chain (newest-first) preserves the newest prior state, including active battles.
v25 adds only the provable Arena/dungeon chats to `dialogsSeen`; v26 settles automatic
battle-opening silver costs and migrates only replay-proven unsettled opening wallets. Older
schemas and receipts remain immutable; no player upload or resource transfer is needed.

---

## Topology

```
                 :80 / :443
                     │
              ┌──────▼───────┐   edge network
              │    proxy     │   Caddy 2 — automatic Let's Encrypt TLS
              │  (Caddy)     │   serves /srv/web (built client)
              └──────┬───────┘   proxies /api/game/* upstream
                     │
        ─────────────┼───────────  internal network (internal: true — no egress)
                     │
              ┌──────▼───────┐
              │     game     │   node:22-alpine, non-root, read-only rootfs
              │  :8788       │   no published ports
              └──┬────────┬──┘
                 │        │
      game-state │        │ /srv/extracted/data  (read-only bind, operator-supplied)
        (volume) │        │ /run/secrets/dib_game_hmac (docker secret)
                 │
          ┌──────▼───────┐
          │    backup    │   reads the state volume read-only, writes host snapshots
          └──────────────┘
```

Client and API share **one origin**. That is deliberate: the server's CORS layer short-circuits
same-host requests entirely, so a single-origin deployment sends no CORS headers, needs no
allowlist, and has no preflight surface. Do not split the origin unless you actually need to.

This applies to `GET /api/game/scoreboard` as well, which is unauthenticated but not exempt from
CORS. It needs no token, so `curl` and any server-side reader can fetch it; a *browser* on another
origin still needs an exact `DIB_GAME_ALLOWED_ORIGINS` entry. If you want the board embedded on a
separate site, that site's origin has to be allowlisted like any other cross-origin client.

### Single replica — not a tuning choice

`FileAuthoritativeSlotStore` serialises transactions in-process and
[explicitly makes no distributed-lock claim](../apps/game-server/src/fileSlotStore.ts). A second
replica against the same volume would interleave read-modify-write cycles on the same slot file and
lose commits. Horizontal scaling requires a database-backed `AuthoritativeSlotStore` first; it is
not a compose change. Do not add `deploy.replicas`.

---

## Prerequisites

- A host with Docker and the Compose plugin.
- A DNS A/AAAA record for your hostname pointing at the host, and ports 80 and 443 reachable from
  the internet. Caddy's ACME challenge fails without both.
- The extracted game resource tree (the directory containing `Monsters.json`, `Worlds.json`, …) on
  the host. This is operator-supplied content: it is never committed, never built into an image, and
  arrives only as a read-only bind mount.

---

## First deploy

### 1. Configure

```sh
cp deploy/.env.example deploy/.env
$EDITOR deploy/.env        # DIB_PUBLIC_HOST, DIB_ACME_EMAIL, and the four host paths
```

`deploy/.env` is gitignored. Do not commit a filled copy.

### 2. Generate the HMAC secret

```sh
deploy/generate-secret.sh /srv/dib/secrets/hmac
```

48 random bytes, mode 600. The script refuses to overwrite an existing secret.

> **Back this file up somewhere separate from the state snapshots, and read
> [Rotating the HMAC secret](#rotating-the-hmac-secret) before you ever replace it.** It is the
> player identity namespace, not merely a signing key. Losing it makes every stored slot
> unreachable; a state backup alone will not save you.

### 3. Verify the build context

```sh
deploy/verify-build-context.sh
```

### 4. Build and start

```sh
docker compose -f deploy/compose.yaml --env-file deploy/.env up -d --build
```

The image build runs `typecheck` before bundling, so a type error fails the build rather than
producing a bundle that merely happens to run.

Watch the first boot:

```sh
docker compose -f deploy/compose.yaml --env-file deploy/.env logs -f game
```

A misconfiguration exits 1 immediately with **every** problem listed at once, not just the first.

### 5. Confirm

```sh
curl -fsS https://<host>/api/game/health      # {"ok":true}
curl -fsS https://<host>/api/game/readiness   # {"ready":true,"installedLogicPackIds":[...]}
```

Then open `https://<host>/` in a browser and confirm the client loads.

---

## Accounts and invites

Two ways to get a login token: players mint their own from the web client, and operators issue them
from the CLI. Both land in the same `invites.json` registry — a self-registered account *is* an
invite that additionally carries a username and a scoreboard preference.

### Self-service registration

`POST /api/game/accounts` is unauthenticated. It takes a username and a `publicScoreboard` flag,
mints a login token, and returns it **once**. The client offers it behind the secondary "Create
account" action below Online login, shown only when `GET /api/game/registration` reports
`enabled: true`. Account creation fills the new token and authenticates it against the selected
archive; returning players use the primary **Log in** action and receive explicit success or error
feedback before **Play Online** becomes available.

The throttle is deliberately harsh: **one account per client address per five minutes**, keyed the
same way as the session route (`X-Forwarded-For` is only consulted when `DIB_GAME_TRUST_PROXY=1`,
and only its last hop). A throttled caller gets 429 and creates nothing. Usernames are unique
case-insensitively; a collision is 422 `ACTION_NOT_ALLOWED`, not a silent rename.

| Variable | Default | Meaning |
|---|---|---|
| `DIB_GAME_REGISTRATION_ENABLED` | `true` | `0` closes new registrations. Existing accounts keep reading and changing their settings. |
| `DIB_GAME_REGISTRATION_RATE_PER_MINUTE` | `0.2` | Sustained refill; `0.2` is one per five minutes. |
| `DIB_GAME_REGISTRATION_RATE_BURST` | `1` | Bucket depth. Raising it lets an idle address register several times back to back. |
| `DIB_GAME_MAX_ACCOUNTS` | `10000` | Hard ceiling on **accounts**. Further registrations are refused with 422. |

Registration is open by definition, so the cap and the throttle are the only things standing between
this route and an unbounded write surface. Lower `DIB_GAME_MAX_ACCOUNTS` to what you actually expect
to host rather than leaving the default on a small box.

The cap counts registry records that carry a username, not registry records outright. Operator
invites issued without `--username` therefore do not eat into it — before 2026-08-08 they did, which
meant a busy operator could close self-service registration without meaning to.

A signed-in player reads and changes their own settings at `GET /api/game/account` and
`POST /api/game/account/settings` — the in-game Options popup's **Scores** row writes there, in both
the in-world Options panel and the one reached from the main menu.

Usernames become public the moment a player opts into the scoreboard, and there is **no rename
route**. Both entry points apply the same rule — 2–16 characters, letters and digits separated by
single spaces, `-`, or `_`, no leading or trailing separator — so `invite --username` cannot smuggle
in a name registration would have refused. To change a name, revoke and re-invite.

### The registry lockfile

Every mutation of `invites.json` takes an `O_EXCL` lockfile (`invites.json.lock`) in the data
directory, held across the whole read-modify-write. This is what makes running `invite` against a
*live* server safe: the in-process write queue only orders writes within one process, and the CLI is
a second one. A lock left behind by a process killed mid-write is reclaimed after 30 seconds — the
holder's own timestamp inside the file decides, not the file's mtime, so a backup tool touching the
directory cannot keep a dead lock looking alive. A contender that waits more than 10 seconds fails
its request rather than blocking forever.

### Operator-issued invites

```sh
compose="docker compose -f deploy/compose.yaml --env-file deploy/.env"

$compose exec game node /app/dib-game-server.mjs invite "alice"
$compose exec game node /app/dib-game-server.mjs invite --username alice "alice's laptop"
$compose exec game node /app/dib-game-server.mjs invite:list
$compose exec game node /app/dib-game-server.mjs invite:revoke <player-id>
```

`invite` prints a login token **once**. It is not stored and not recoverable — the registry holds
only the HMAC-derived player id. If a player loses their token, revoke and re-invite. This is true
of self-registered tokens too: there is no recovery path, by design.

Without `--username` the token authorizes play but owns no account record; the client hides
account-scoped settings for it rather than inventing them, and `GET /api/game/account` answers 404.

Share tokens over a private channel. A login token is a bearer credential.

---

## Health checks

Two endpoints, two different questions. They are not interchangeable.

| Endpoint | Meaning | Used by |
|---|---|---|
| `GET /api/game/health` | The process is alive and routing. Always 200 while running. | Caddy upstream probe (`health_uri`) |
| `GET /api/game/readiness` | A logic pack is installed and serving. **503** until then. | Container `HEALTHCHECK`, `depends_on: service_healthy` |

The container healthcheck targets *readiness* on purpose: a process that is listening but has
nothing to serve must not be declared healthy, or the proxy starts dispatching into it mid-boot.
Liveness stays 200 in that state, because the right response to "still loading" is to wait, not to
restart.

`start_period` is 90s. Resource loading on a cold container is the long pole; shortening this turns
a slow boot into a restart loop.

### Keep-alive ordering

The origin's `keepAliveTimeout` is 130s and Caddy's upstream `keepalive` is 60s. The origin must be
the **longer** of the two so Caddy always retires a pooled socket first. Reversed, Caddy can
dispatch onto a socket the origin is simultaneously closing and surface a 502 that no request
actually caused. If you change one, change both.

---

## Logs and traffic metrics

There is no analytics service and no beacon in the client. Everything answerable about traffic comes
from two logs the stack writes itself, both on named volumes so they **survive the container
recreation that every redeploy performs**.

| Volume | Contents | Written by | Retention |
|---|---|---|---|
| `dib_caddy-logs` | `access.log` — one JSON record per HTTP request at the edge | Caddy | 20 MiB × 12 generations, 90 days |
| `dib_game-logs` | `game.log` — one JSON record per API request, plus lifecycle and errors | Game server | 32 MiB × 5 generations |

Neither goes to `docker logs` any more for access records. `docker logs` still carries runtime
messages (ACME, config load, errors, startup), which is what it is good for. **Docker's `json-file`
driver rotates against the container lifetime**, so anything living only there is erased on the next
redeploy — that is the reason both logs are now files on volumes.

The Caddy log answers "who reached the site". The game log answers "who played": it carries the
`playerId`, the HMAC-derived pseudonym already used as the on-disk directory name, so player
activity is attributable without any credential ever reaching a log. Probe routes (`/health`,
`/readiness`) log at `debug`, because at ~6-second polling they would otherwise produce roughly
14,000 records a day and bury every real action. Raise `DIB_GAME_LOG_LEVEL=debug` to see them.

### Reading them

```bash
sudo deploy/traffic-report.sh             # last 7 days
sudo deploy/traffic-report.sh --days 30
sudo deploy/traffic-report.sh --days 1 --json
```

It reads both volumes read-only, including rolled generations, and is safe against production. The
report separates traffic that was actually addressed to this site from the two categories that
otherwise inflate every number:

- **Addressed elsewhere.** Requests arriving at the bare IP or naming someone else's domain —
  scanners probing for an open proxy. On this host they have outnumbered real traffic roughly 4:1.
- **Intrusion probes.** `/wp-*`, `/.env`, `/admin` and similar against this site's hostname.

What is left is reported as **unclassified**, never as "humans". Self-identifying agents (ClaudeBot,
GPTBot, `Go-http-client`, …) are filtered by user-agent, but a crawler that presents a browser
user-agent is indistinguishable from a person at the log layer. Treat the unclassified count as a
ceiling. The one unambiguous audience number is **distinct players** from the game log, because
reaching it requires holding a valid session token.

### Raw access

```bash
V=$(sudo docker volume inspect dib_caddy-logs --format '{{.Mountpoint}}')
sudo jq -r 'select(.msg=="handled request") |
  [.ts, .request.remote_ip, .request.method, .request.host, .request.uri, .status] | @tsv' "$V/access.log"

G=$(sudo docker volume inspect dib_game-logs --format '{{.Mountpoint}}')
sudo jq -r 'select(.msg=="game request") | [.time, .playerId // "-", .method, .path, .status] | @tsv' "$G/game.log"
```

Log volumes are deliberately **not** backed up and not part of the state snapshot: they are
diagnostic, and keeping them out of `game-state` means log growth can never crowd out authoritative
player data. If a log volume fills, the writers degrade rather than fail — Caddy rolls, and the game
server's file sink swallows write errors so a full disk cannot turn into a failed player request.

---

## Backups

The `backup` service snapshots the state volume every `DIB_BACKUP_INTERVAL_SECONDS` (default daily),
writing to `DIB_BACKUP_HOST_PATH`. Retention is 7 daily plus 4 weekly (Sunday runs are tagged
weekly). Each archive gets a `.sha256` manifest, and rotation only happens *after* a new archive has
been written and verified, so a failing backup never erodes history.

**Snapshots are safe to take against a live server.** Every state file is written to a temp path,
fsynced, atomically renamed, and the parent directory is fsynced
([`durableWrite.ts`](../apps/game-server/src/durableWrite.ts)); a reader always sees a complete
version. Slots carry no cross-file invariant, so a snapshot cannot capture a torn record.

Put `DIB_BACKUP_HOST_PATH` on **different storage from the Docker volume**. A backup on the same
disk does not survive the failure it exists for.

### Offsite

Set `DIB_BACKUP_OFFSITE_CMD` to a command receiving the file path as `$1`:

```sh
DIB_BACKUP_OFFSITE_CMD='rclone copy "$1" remote:dib-backups/'
```

It runs once for the archive and once for the manifest. A failure is logged loudly but does not fail
the run, because the local snapshot is already valid. Watch for repeated
`offsite push failed` lines — a persistently broken destination is silent otherwise.

Also back up the `caddy-data` volume. Losing it means re-issuing certificates and burning Let's
Encrypt rate limit.

### Restore drill — rehearse this before you need it

An unrehearsed restore is a hope, not a plan. Do this on a scratch directory at least once:

```sh
compose="docker compose -f deploy/compose.yaml --env-file deploy/.env"

$compose stop game                       # required: see below
deploy/restore.sh /srv/dib/backups/dib-game-state-daily-<ts>.tar.gz /tmp/restore-drill
```

The script verifies the sha256 manifest **before** touching the target — a restore that discovers
corruption halfway through has already destroyed what it was restoring over — and refuses a
non-empty target without `--force`. With `--force` it moves the existing contents to
`<target>.replaced-<timestamp>` rather than deleting them, so a wrong-archive restore is reversible.

For a real restore into the live volume:

```sh
$compose stop game
docker run --rm -v dib_game-state:/state -v /srv/dib/backups:/backups:ro \
  -v "$PWD/deploy/restore.sh:/restore.sh:ro" alpine:3.20 \
  sh /restore.sh /backups/dib-game-state-daily-<ts>.tar.gz /state --force
docker run --rm -v dib_game-state:/state alpine:3.20 chown -R 1000:1000 /state
$compose start game
$compose exec game node /app/dib-game-server.mjs invite:list
curl -fsS https://<host>/api/game/readiness
```

**The server must be stopped first.** The store holds no lock a second writer would respect, so
restoring underneath a live server produces state that neither the archive nor the server ever
contained.

If `invite:list` comes back empty after a restore that clearly contained invites, the HMAC secret in
use does not match the one the snapshot was written under. Restoring state does not restore
identity.

---

## Rotating the HMAC secret

> **Rotation is destructive. It is not routine hygiene.**

`playerId = HMAC(secret, loginToken)`
([`invites.ts`](../apps/game-server/src/invites.ts)). The secret does not merely sign sessions — it
*defines the identity namespace*. Change it and:

- every issued login token maps to a different player id,
- every invite in `invites.json` refers to identities nobody can authenticate as,
- every slot under `authoritative-slots/` becomes unreachable — the data is intact on disk and no
  longer addressable.

There is no re-keying migration. Rotate only if the secret is believed compromised, and accept that
you are resetting the player base.

Procedure:

1. Snapshot state and copy the **old** secret somewhere safe. You need it to read the old
   `invites.json` labels and to reverse course.
2. Take the stack down: `docker compose … down`.
3. Generate a new secret to a **new path**, then point `DIB_HMAC_SECRET_HOST_PATH` at it.
4. Bring the stack up. Existing sessions and tokens are now invalid.
5. Re-issue an invite to every player, using the labels from the old registry as your list.
6. Old slot directories are orphaned. Keep them until you are certain nobody needs recovery; they
   are the only copy of that state.

The server refuses `DIB_GAME_HMAC_SECRET` (inline) under `DIB_GAME_ENV=production`, because an
inline secret is readable through `docker inspect`, `ps`, and orchestrator APIs. Mount it and use
`DIB_GAME_HMAC_SECRET_FILE`.

---

## Redeploy and rollback

### Redeploy

`deploy/azure-deploy.ps1 -PublishMods` publishes the curated local mod catalog separately from
application releases (`-DryRun` builds and validates without connecting). See
[mod publication](mod-library.md#deployment-and-backups) for selection, screenshots, verification
and rollback. It uses the current production app image and writes a versioned
`<AppRoot>/official-mods/compose.yaml` override outside app releases; ordinary helper deployments
include that override during preflight, activation and rollback, and both modes hold
`<AppRoot>/.deploy.lock`. Manual Compose commands below must also include
`-f <AppRoot>/official-mods/compose.yaml` after a catalog has been published.

The in-place Compose sequence is:

```sh
deploy/verify-build-context.sh
docker compose -f deploy/compose.yaml --env-file deploy/.env up -d --build
```

Compose sends SIGTERM and waits up to `stop_grace_period` (30s). The runtime stops accepting new
connections, closes idle keep-alive sockets, lets in-flight requests finish within
`DIB_GAME_SHUTDOWN_GRACE_MS` (15s), then destroys anything still hanging and exits 0. A client whose
command was mid-transaction therefore gets its answer rather than a severed socket.

Keep the two windows in that order — the grace must stay **below** `stop_grace_period`, or Docker
SIGKILLs the process mid-drain.

### Rollback

Images are the rollback unit; state is not. Rolling the image back does not roll state back, and
you almost never want it to — a slot written by the newer simulation is the player's real progress.

```sh
git checkout <previous-commit>
docker compose -f deploy/compose.yaml --env-file deploy/.env up -d --build
```

Only restore a state snapshot if the state itself is what went wrong, and only via the drill above.

---

## Environment reference

Every variable is validated once at startup by
[`config.ts`](../apps/game-server/src/config.ts); a bad value is a fail-fast with the complete
problem list. See [`deploy/.env.example`](../deploy/.env.example) for the operator-facing subset.

| Variable | Default | Notes |
|---|---|---|
| `DIB_GAME_ENV` | `development` | `production` enables the refusals below |
| `DIB_GAME_PORT` | `8788` | |
| `DIB_GAME_BIND_HOST` | `127.0.0.1` | `0.0.0.0` in the container; it has no published ports |
| `DIB_GAME_HMAC_SECRET_FILE` | — | Required in production. ≥32 bytes |
| `DIB_GAME_HMAC_SECRET` | — | **Refused** in production |
| `DIB_GAME_DATA_DIR` | repo-relative in dev | Required in production |
| `DIB_GAME_EXTRACTED_DATA` | repo-relative in dev | Required in production; must exist |
| `DIB_GAME_ALLOWED_ORIGINS` | empty | Leave unset for single-origin. https-only in production |
| `DIB_GAME_TRUST_PROXY` | `0` | Set only when a trusted proxy is the sole path to the port |
| `DIB_GAME_LOG_LEVEL` | `info` | `debug`\|`info`\|`warn`\|`error`. `debug` adds health-probe records |
| `DIB_GAME_LOG_FILE` | unset | Durable log copy alongside stdout. Set by compose to `/var/log/dib-game/game.log` |
| `DIB_GAME_LOG_FILE_MAX_BYTES` | `33554432` | Roll threshold for that file |
| `DIB_GAME_LOG_FILE_KEEP` | `5` | Rolled generations retained |
| `DIB_GAME_SHUTDOWN_GRACE_MS` | `15000` | Must stay below `stop_grace_period` |
| `DIB_GAME_SESSION_RATE_PER_MINUTE` / `_BURST` | `20` / `10` | Unauthenticated login route, keyed by client address |
| `DIB_GAME_REGISTRATION_ENABLED` | `true` | `0` closes self-service registration |
| `DIB_PVP_ENABLED` | `true` | `0` disables PvP session/invite/match routes; campaign play remains available |
| `DIB_GAME_REGISTRATION_RATE_PER_MINUTE` / `_BURST` | `0.2` / `1` | One account per address per five minutes |
| `DIB_GAME_MAX_ACCOUNTS` | `10000` | Ceiling on accounts, not on registry records |
| `DIB_GAME_SCOREBOARD_RATE_PER_MINUTE` / `_BURST` | `60` / `20` | Unauthenticated scoreboard reads, keyed by client address |
| `DIB_GAME_COMMAND_RATE_PER_MINUTE` / `_BURST` | `600` / `120` | Authenticated execution, keyed by player |
| `DIB_GAME_START_WORLD` / `_TOWN` | `World_1-1` / `First_City` | |

### Why production refuses repo-relative path defaults

In development the server derives paths from the repository root. The production bundle runs from
`dist/` or from a container, where a repo-relative default resolves to a directory that is not the
deployment's state — and the failure is *silent*: the server boots against an empty directory and
looks fine. Production therefore requires every path stated explicitly and refuses to invent one.

### Why `DIB_GAME_TRUST_PROXY` is opt-in

`X-Forwarded-For` is caller-controlled. On a directly exposed port, honouring it would let any
client mint a fresh rate-limit bucket per request by varying the header. It is safe only when a
trusted proxy is the *only* route to the port — which the compose stack arranges by publishing no
ports on `game` and putting it on an `internal: true` network. Caddy overwrites the header rather
than appending, and the server reads the **last** hop (the one the trusted proxy observed).

---

## Security posture

What the stack does, and why:

- **`game` publishes no ports** and sits on an `internal: true` network. The authoritative service
  is unreachable except through Caddy.
- **`read_only: true` rootfs**, `cap_drop: ALL`, `no-new-privileges`, non-root `node` user, memory
  and pid limits. Only the state volume is writable.
- **No game content in any image.** The client build sets `publicDir: false`, the server reads
  `extracted/data` from a read-only bind at runtime, and `.dockerignore` keeps the copyrighted
  corpus out of the build context entirely.
- **The secret is a Docker secret**, not an environment variable — and production *refuses* the
  environment-variable form.
- **Logs redact structurally.** Any field whose name contains `token`, `secret`, `authorization`,
  `cookie`, `credential`, `password`, or `session` is replaced before serialisation, at any nesting
  depth, with separators and case stripped first — so `X-Login-Token`, `login_token`, and
  `sessionToken` all match. Errors carry a correlation id to the client and the detail to the log.
- **Rate limits** on the unauthenticated session route (keyed by client address) and on command
  execution (keyed by player). The bucket table is bounded so the limiter is not itself a
  memory-exhaustion vector.
- **`frame-ancestors 'none'`** is set by Caddy. The document CSP lives in `apps/web/index.html`, and
  a `<meta>` CSP structurally cannot express `frame-ancestors`.
- **`/downloads/*` returns 404.** Those routes exist in `vite.config.ts` for development only and
  serve operator-owned archives.

---

## Troubleshooting

**`configuration is invalid` on boot.** The message lists every problem at once. Fix them all before
restarting; the list is complete.

**Caddy cannot get a certificate.** Check DNS resolves to this host and that ports 80 *and* 443 are
open inbound. `docker compose logs proxy` carries the ACME error.

**`game` never becomes healthy.** `docker compose logs game`. Readiness stays 503 until a logic pack
installs, so the usual cause is `DIB_GAME_EXTRACTED_DATA` pointing at the wrong directory — which
the config layer catches at boot with `does not point at a directory`.

**Intermittent 502s.** Check the keep-alive ordering above.

**429s in normal play.** Raise `DIB_GAME_COMMAND_RATE_*`. The default of 600/minute is generous for
one player; if legitimate traffic hits it, something is retrying in a loop and is worth finding
before you raise the ceiling.

**Permission errors after a restore.** The server runs as uid 1000. A restore performed as root
leaves root-owned files: `chown -R 1000:1000` the state directory.

## Community mod hosting

The new author portal requires a separate `DIB_COMMUNITY_HOST` DNS name pointing at this VM;
set it in `deploy/.env` before deploying. Also set `DIB_GAME_PUBLIC_ORIGIN` to the one canonical
HTTPS game origin (for example `https://play.example.com`). `DIB_PUBLIC_HOST` is Caddy configuration and
may contain comma-separated aliases; it cannot be used as an origin. Compose derives
`DIB_COMMUNITY_ORIGIN` from the author hostname; the two origins must differ. It mounts a separate
`community-state` volume.
The release helper runs `config:check` against the built image and production mounts before
activation. A failed activation restores the previous running image identities without rebuilding.
The existing scheduled `game-state` backup does not include that volume. Use the consistent
`mods:backup` CLI and archive completed snapshots as described in [the mod-library runbook](mod-library.md).
That runbook also covers quota/free-space limits, restore, `mods:hide` takedowns and author
session isolation. The existing Azure release helper remains the deployment path. This addition
does not authorize or document an already-completed production deployment.

Official mods are optional and off by default. The maintained `-PublishMods` mode provisions
their directory and read-only mount; for other installations, set `DIB_OFFICIAL_MODS_DIR` on the `game` service
to a read-only mount of reviewed `.dibmod` files (with optional `<name>.listing.json` sidecars).
The image does not bundle any mods. The server refuses to start if a package or sidecar in that
directory is invalid, so check the directory before redeploying. See "Official mods" in
[the mod-library runbook](mod-library.md).
