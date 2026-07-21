import { execFileSync } from 'node:child_process';

const POSTGRES_CONTAINER = 'nexploy_postgres';

interface ContainerInspect {
    Config: { Env: string[] };
    NetworkSettings: { Networks: Record<string, { IPAddress: string }> };
}

function parseEnv(env: string[]): Record<string, string> {
    const values: Record<string, string> = {};
    for (const entry of env) {
        const eq = entry.indexOf('=');
        if (eq === -1) continue;
        values[entry.slice(0, eq)] = entry.slice(eq + 1);
    }
    return values;
}

export function resolvePostgresUrl(): string {
    let output: string;
    try {
        output = execFileSync('docker', ['inspect', POSTGRES_CONTAINER], { encoding: 'utf-8' });
    } catch (error) {
        throw new Error(
            `Could not inspect the ${POSTGRES_CONTAINER} container. Is Nexploy installed and running ` +
            `on this machine, and is this command run as root with access to the Docker socket?\n` +
            (error as Error).message,
        );
    }

    const [info] = JSON.parse(output) as ContainerInspect[];
    const env = parseEnv(info.Config.Env);

    const password = env.POSTGRES_PASSWORD;
    const user = env.POSTGRES_USER ?? 'nexploy';
    const db = env.POSTGRES_DB ?? 'nexploy';

    if (!password) {
        throw new Error(
            `Could not find POSTGRES_PASSWORD in the ${POSTGRES_CONTAINER} container's environment.`,
        );
    }

    const network = Object.values(info.NetworkSettings.Networks)[0];
    if (!network?.IPAddress) {
        throw new Error(`Could not determine the Docker network IP of ${POSTGRES_CONTAINER}.`);
    }

    return `postgresql://${user}:${encodeURIComponent(password)}@${network.IPAddress}:5432/${db}`;
}
