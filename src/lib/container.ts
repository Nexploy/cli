import { execFileSync } from 'node:child_process';

export interface HealthcheckSpec {
    Test?: string[] | null;
    Interval?: number;
    Timeout?: number;
    Retries?: number;
    StartPeriod?: number;
}

export interface MountSpec {
    Type: string;
    Name?: string;
    Source: string;
    Destination: string;
    RW: boolean;
    Mode?: string;
}

export interface ContainerInspect {
    Id: string;
    Name: string;
    State: { Running: boolean; Health?: { Status: string } };
    Config: {
        Image: string;
        Env: string[] | null;
        Cmd: string[] | null;
        Entrypoint: string[] | null;
        Labels: Record<string, string> | null;
        Healthcheck?: HealthcheckSpec | null;
    };
    HostConfig: {
        PortBindings: Record<string, unknown> | null;
        RestartPolicy: { Name: string; MaximumRetryCount: number };
    };
    Mounts: MountSpec[];
    NetworkSettings: {
        Networks: Record<string, { IPAddress: string; Aliases: string[] | null }>;
    };
}

interface ImageInspect {
    Config: {
        Env: string[] | null;
        Cmd: string[] | null;
        Entrypoint: string[] | null;
        Labels: Record<string, string> | null;
        Healthcheck?: HealthcheckSpec | null;
    };
}

const ANONYMOUS_VOLUME_NAME = /^[0-9a-f]{64}$/;

export function docker(args: string[]): string {
    return execFileSync('docker', args, { encoding: 'utf-8' });
}

export function containerExists(name: string): boolean {
    try {
        execFileSync('docker', ['inspect', '--type', 'container', name], {
            encoding: 'utf-8',
            stdio: ['ignore', 'ignore', 'ignore'],
        });
        return true;
    } catch {
        return false;
    }
}

export function inspectContainer(name: string): ContainerInspect {
    let output: string;

    try {
        output = docker(['inspect', '--type', 'container', name]);
    } catch (error) {
        throw new Error(
            `Could not inspect the ${name} container. Is Nexploy installed and running on this ` +
                `machine, and is this command run as root with access to the Docker socket?\n` +
                (error as Error).message,
        );
    }

    const [info] = JSON.parse(output) as ContainerInspect[];

    if (!info) throw new Error(`Docker returned no data for the ${name} container.`);

    return info;
}

function inspectImage(reference: string): ImageInspect | undefined {
    try {
        const output = execFileSync('docker', ['inspect', '--type', 'image', reference], {
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'ignore'],
        });
        const [info] = JSON.parse(output) as ImageInspect[];
        return info;
    } catch {
        return undefined;
    }
}

export function parseEnv(env: string[]): Record<string, string> {
    const values: Record<string, string> = {};

    for (const entry of env) {
        const eq = entry.indexOf('=');
        if (eq === -1) continue;
        values[entry.slice(0, eq)] = entry.slice(eq + 1);
    }

    return values;
}

export function publishedPorts(info: ContainerInspect): string[] {
    const bindings = info.HostConfig.PortBindings ?? {};

    return Object.entries(bindings).flatMap(([containerPort, hostBindings]) => {
        const targets = Array.isArray(hostBindings) ? hostBindings : [];
        if (targets.length === 0) return [`${containerPort} (ephemeral host port)`];

        return targets.map((target: { HostIp?: string; HostPort?: string }) => {
            const host = target.HostIp ? `${target.HostIp}:` : '';
            return `${host}${target.HostPort ?? ''} -> ${containerPort}`;
        });
    });
}

export function anonymousVolumeMounts(info: ContainerInspect): MountSpec[] {
    return info.Mounts.filter(
        (mount) => mount.Type === 'volume' && (!mount.Name || ANONYMOUS_VOLUME_NAME.test(mount.Name)),
    );
}

export function composeProject(info: ContainerInspect): string | undefined {
    return info.Config.Labels?.['com.docker.compose.project'];
}

function nanosecondsToFlag(value: number | undefined): string | undefined {
    if (!value || value <= 0) return undefined;
    return `${Math.round(value / 1_000_000)}ms`;
}

function healthcheckArgs(
    container: HealthcheckSpec | null | undefined,
    image: HealthcheckSpec | null | undefined,
): string[] {
    const test = container?.Test;
    if (!test || test.length === 0 || test[0] === 'NONE') return [];
    if (JSON.stringify(container) === JSON.stringify(image)) return [];

    const args: string[] = ['--health-cmd', test.slice(1).join(' ')];

    const interval = nanosecondsToFlag(container?.Interval);
    if (interval) args.push('--health-interval', interval);

    const timeout = nanosecondsToFlag(container?.Timeout);
    if (timeout) args.push('--health-timeout', timeout);

    if (container?.Retries) args.push('--health-retries', String(container.Retries));

    const startPeriod = nanosecondsToFlag(container?.StartPeriod);
    if (startPeriod) args.push('--health-start-period', startPeriod);

    return args;
}

function mountArgs(mounts: MountSpec[]): string[] {
    return mounts.flatMap((mount) => {
        const source = mount.Type === 'volume' ? (mount.Name as string) : mount.Source;
        const readonly = mount.RW ? '' : ':ro';
        return ['--volume', `${source}:${mount.Destination}${readonly}`];
    });
}

export interface RecreatePlan {
    runArgs: string[];
    extraNetworks: Array<{ network: string; aliases: string[] }>;
    removedPorts: string[];
    rollbackArgs: string[];
}

export function planRecreateWithoutPublishedPorts(info: ContainerInspect): RecreatePlan {
    const name = info.Name.replace(/^\//, '');
    const shortId = info.Id.slice(0, 12);
    const image = inspectImage(info.Config.Image);

    const imageEnv = new Set(image?.Config.Env ?? []);
    const env = (info.Config.Env ?? []).filter((entry) => !imageEnv.has(entry));

    const imageLabels = image?.Config.Labels ?? {};
    const labels = Object.entries(info.Config.Labels ?? {}).filter(
        ([key, value]) => imageLabels[key] !== value,
    );

    const networks = Object.entries(info.NetworkSettings.Networks);
    const [primaryNetwork, ...otherNetworks] = networks;

    const aliasesOf = (aliases: string[] | null): string[] =>
        (aliases ?? []).filter((alias) => alias !== shortId && alias !== name);

    const runArgs = ['run', '--detach', '--name', name];

    const restart = info.HostConfig.RestartPolicy;
    if (restart?.Name && restart.Name !== 'no') {
        const policy =
            restart.Name === 'on-failure' && restart.MaximumRetryCount > 0
                ? `on-failure:${restart.MaximumRetryCount}`
                : restart.Name;
        runArgs.push('--restart', policy);
    }

    if (primaryNetwork) {
        runArgs.push('--network', primaryNetwork[0]);
        for (const alias of aliasesOf(primaryNetwork[1].Aliases)) {
            runArgs.push('--network-alias', alias);
        }
    }

    for (const entry of env) runArgs.push('--env', entry);
    runArgs.push(...mountArgs(info.Mounts));
    for (const [key, value] of labels) runArgs.push('--label', `${key}=${value}`);
    runArgs.push(...healthcheckArgs(info.Config.Healthcheck, image?.Config.Healthcheck));

    const entrypoint = info.Config.Entrypoint;
    const imageEntrypoint = image?.Config.Entrypoint ?? null;
    if (entrypoint && JSON.stringify(entrypoint) !== JSON.stringify(imageEntrypoint)) {
        runArgs.push('--entrypoint', entrypoint[0]);
    }

    runArgs.push(info.Config.Image);

    if (entrypoint && entrypoint.length > 1 && JSON.stringify(entrypoint) !== JSON.stringify(imageEntrypoint)) {
        runArgs.push(...entrypoint.slice(1));
    }

    const cmd = info.Config.Cmd;
    if (cmd && JSON.stringify(cmd) !== JSON.stringify(image?.Config.Cmd ?? null)) {
        runArgs.push(...cmd);
    }

    const publishArgs = Object.entries(info.HostConfig.PortBindings ?? {}).flatMap(
        ([containerPort, hostBindings]) => {
            const targets = Array.isArray(hostBindings) ? hostBindings : [];
            return targets.map((target: { HostIp?: string; HostPort?: string }) => {
                const host = target.HostIp ? `${target.HostIp}:` : '';
                return `${host}${target.HostPort ?? ''}:${containerPort}`;
            });
        },
    );

    const rollbackArgs = [...runArgs];
    const imageIndex = rollbackArgs.lastIndexOf(info.Config.Image);
    for (const publish of publishArgs.reverse()) {
        rollbackArgs.splice(imageIndex, 0, '--publish', publish);
    }

    return {
        runArgs,
        extraNetworks: otherNetworks.map(([network, settings]) => ({
            network,
            aliases: aliasesOf(settings.Aliases),
        })),
        removedPorts: publishedPorts(info),
        rollbackArgs,
    };
}

const SENSITIVE_ENV_KEY = /(PASSWORD|SECRET|TOKEN|KEY)/i;

export function redactRunArgs(args: string[]): string[] {
    return args.map((arg, index) => {
        if (args[index - 1] !== '--env') return arg;

        const eq = arg.indexOf('=');
        if (eq === -1) return arg;

        const key = arg.slice(0, eq);
        return SENSITIVE_ENV_KEY.test(key) ? `${key}=********` : arg;
    });
}

export async function waitUntilHealthy(name: string, timeoutSeconds: number): Promise<void> {
    const deadline = Date.now() + timeoutSeconds * 1000;

    while (Date.now() < deadline) {
        const info = inspectContainer(name);
        const status = info.State.Health?.Status;

        if (!info.State.Running) throw new Error(`${name} stopped while starting up.`);
        if (!status || status === 'healthy') return;

        await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    throw new Error(`${name} did not become healthy within ${timeoutSeconds}s.`);
}
