import { type ContainerInspect, inspectContainer, parseEnv } from './container.js';

export const POSTGRES_CONTAINER = 'nexploy_postgres';

export interface PostgresCredentials {
    user: string;
    password: string;
    db: string;
}

export function readPostgresCredentials(info: ContainerInspect): PostgresCredentials {
    const env = parseEnv(info.Config.Env ?? []);

    const password = env.POSTGRES_PASSWORD;

    if (!password) {
        throw new Error(
            `Could not find POSTGRES_PASSWORD in the ${POSTGRES_CONTAINER} container's environment.`,
        );
    }

    return {
        user: env.POSTGRES_USER ?? 'nexploy',
        password,
        db: env.POSTGRES_DB ?? 'nexploy',
    };
}

export function resolvePostgresUrl(): string {
    const info = inspectContainer(POSTGRES_CONTAINER);
    const { user, password, db } = readPostgresCredentials(info);

    const network = Object.values(info.NetworkSettings.Networks)[0];

    if (!network?.IPAddress) {
        throw new Error(`Could not determine the Docker network IP of ${POSTGRES_CONTAINER}.`);
    }

    return `postgresql://${user}:${encodeURIComponent(password)}@${network.IPAddress}:5432/${db}`;
}
