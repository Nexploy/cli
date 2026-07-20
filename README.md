# nexploy-cli

Recovery CLI for self-hosted [Nexploy](https://nexploy.app) instances.

It runs **on the server**, as root, and talks **directly to the instance's
Postgres database** — not through the Nexploy web app. This means it still
works if the app itself is down, misconfigured, or its admin password is lost.

## Install

```bash
npm install -g nexploy-cli
```

## Setup

Nothing to configure: `nexploy-cli` reads `/etc/nexploy/nexploy.env`, the
secrets file written by Nexploy's `install.sh`. Override the location with
`NEXPLOY_DIR` if Nexploy was installed elsewhere.

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
