import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface NexployConfig {
    cliKeyHash: string;
    configDir: string;
}

function parseEnvFile(contents: string): Record<string, string> {
    const values: Record<string, string> = {};

    for (const rawLine of contents.split('\n')) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;

        const eq = line.indexOf('=');
        if (eq === -1) continue;

        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim();

        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith('\'') && value.endsWith('\''))
        ) {
            value = value.slice(1, -1);
        }

        values[key] = value;
    }

    return values;
}

function readSecretsFile(configDir: string): Record<string, string> {
    // `cli.env` holds only what the CLI needs (currently just the recovery
    // key hash) since app secrets now live solely in the containers'
    // environments. `nexploy.env` is a fallback for installs from before
    // that split.
    for (const filename of ['cli.env', 'nexploy.env']) {
        const path = join(configDir, filename);
        try {
            return parseEnvFile(readFileSync(path, 'utf-8'));
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code === 'EACCES') {
                throw new Error(`Permission denied reading ${path} — run this command as root.`);
            }
            if (code !== 'ENOENT') throw error;
        }
    }

    throw new Error(
        `No Nexploy installation found at ${join(configDir, 'cli.env')}. Run this on the server where Nexploy is installed.`,
    );
}

export function loadConfig(): NexployConfig {
    const configDir = process.env.NEXPLOY_DIR ?? '/etc/nexploy';
    const values = readSecretsFile(configDir);

    const cliKeyHash = values.NEXPLOY_CLI_KEY_HASH;

    if (!cliKeyHash) {
        throw new Error(
            `No recovery key configured for this instance (missing NEXPLOY_CLI_KEY_HASH in ${configDir}).\n` +
            'Generate one with: curl -fsSL https://nexploy.app/install.sh | sh -s rotate-cli-key',
        );
    }

    return { cliKeyHash, configDir };
}
