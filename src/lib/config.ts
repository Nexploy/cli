import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface NexployConfig {
    databaseUrl: string;
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

export function loadConfig(): NexployConfig {
    const configDir = process.env.NEXPLOY_DIR ?? '/etc/nexploy';
    const secretsFile = join(configDir, 'nexploy.env');

    let contents: string;
    try {
        contents = readFileSync(secretsFile, 'utf-8');
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
            throw new Error(
                `No Nexploy installation found at ${secretsFile}. Run this on the server where Nexploy is installed.`,
            );
        }
        if (code === 'EACCES') {
            throw new Error(`Permission denied reading ${secretsFile} — run this command as root.`);
        }
        throw error;
    }

    const values = parseEnvFile(contents);

    const databaseUrl = values.NEXPLOY_CLI_DATABASE_URL;
    const cliKeyHash = values.NEXPLOY_CLI_KEY_HASH;

    if (!cliKeyHash) {
        throw new Error(
            `No recovery key configured for this instance (missing NEXPLOY_CLI_KEY_HASH in ${secretsFile}).\n` +
            'Generate one with: curl -fsSL https://nexploy.app/install.sh | sh -s rotate-cli-key',
        );
    }

    if (!databaseUrl) {
        throw new Error(
            `Could not find NEXPLOY_CLI_DATABASE_URL in ${secretsFile}. This Nexploy installation ` +
            'predates nexploy-cli support — reinstall or upgrade Nexploy to add it.',
        );
    }

    return {
        databaseUrl,
        cliKeyHash,
        configDir,
    };
}
