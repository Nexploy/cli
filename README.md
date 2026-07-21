# @nexploy/cli

Recovery CLI for self-hosted [Nexploy](https://nexploy.app) instances.

It runs **on the server**, as root, and talks **directly to the instance's
Postgres database** — not through the Nexploy web app. This means it still
works if the app itself is down, misconfigured, or its admin password is lost.

## Install

```bash
npm install -g @nexploy/cli
```

## Setup

Nothing to configure: `nexploy-cli` reads `/etc/nexploy/nexploy.env`, the
secrets file written by Nexploy's `install.sh`. Override the location with
`NEXPLOY_DIR` if Nexploy was installed elsewhere.

It connects to Postgres as `postgresql://nexploy:<POSTGRES_PASSWORD>@<POSTGRES_HOST>:<POSTGRES_PORT>/nexploy`,
building that URL itself from values in the secrets file — no full connection
string needs to be stored. `POSTGRES_HOST` and `POSTGRES_PORT` are optional
and default to `127.0.0.1` and `5432`; only `POSTGRES_PASSWORD` is required.

If Postgres runs in a container without a port published on the host (no
`127.0.0.1:5432->5432` in `docker ps`), set `POSTGRES_HOST` to the
container's Docker network IP (`docker inspect <container> --format
'{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'`) — the host can
reach it directly over the Docker bridge, it just can't resolve it by
container name.

Every command requires the **recovery key** shown once when Nexploy was
installed (or after running `rotate-cli-key`, if it was lost). You'll be
prompted for it, or pass it non-interactively via the `NEXPLOY_CLI_KEY`
environment variable.

If you lost the recovery key, generate a new one on the server:

```bash
curl -fsSL https://nexploy.app/install.sh | sh -s rotate-cli-key
```

## Commands

### `nexploy admin reset-password [--email <email>]`

Resets a user's password to a freshly generated random one, and revokes all
of their active sessions. Without `--email`, targets the single user with the
`admin` role — pass `--email` if there's more than one admin, or to target a
non-admin account.

```bash
sudo nexploy admin reset-password
```

## Audit log

Every `admin` action (success or failure — invalid key, user not found, etc.)
is appended as a JSON line to `<NEXPLOY_DIR>/cli-audit.log` (default
`/etc/nexploy/cli-audit.log`), root-only (`0600`). Each entry records a
timestamp, host, OS user, action, outcome, and target — never the generated
password itself.

## Development

Reads and writes go through a [Prisma](https://www.prisma.io) client, but
`prisma/schema.prisma` declares no models — this package doesn't own the
Nexploy schema and must not duplicate it. It only uses `$queryRaw`/
`$executeRaw` (tagged templates, so values are parameterized, not
string-concatenated) against the same database.

```bash
npm install        # also runs `prisma generate` via postinstall
npm run dev -- admin reset-password
npm run build       # regenerates the Prisma client, then bundles with tsup
```

## Releasing

Publishing to npm happens in CI (`.github/workflows/publish.yml`) via trusted
publishing (OIDC, no stored token) whenever a `v*` tag is pushed:

```bash
npm version patch   # or minor/major
git push --follow-tags
```
