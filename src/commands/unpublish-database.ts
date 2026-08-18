import { spawnSync } from 'node:child_process';
import { closeSync, openSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import prompts from 'prompts';
import { auditLog } from '../lib/audit.js';
import { authorize } from '../lib/authorize.js';
import {
    anonymousVolumeMounts,
    composeProject,
    containerExists,
    docker,
    inspectContainer,
    planRecreateWithoutPublishedPorts,
    publishedPorts,
    redactRunArgs,
    waitUntilHealthy,
} from '../lib/container.js';
import { loadConfig } from '../lib/config.js';
import { POSTGRES_CONTAINER, readPostgresCredentials } from '../lib/docker.js';

const ACTION = 'security.unpublish-database';
const DEPENDENT_CONTAINERS = ['nexploy_app', 'nexploy_docker_api'];
const HEALTH_TIMEOUT_SECONDS = 120;

export interface UnpublishDatabaseOptions {
    yes?: boolean;
    dryRun?: boolean;
    skipBackup?: boolean;
}

export async function unpublishDatabase(options: UnpublishDatabaseOptions): Promise<void> {
    const config = loadConfig();
    const info = inspectContainer(POSTGRES_CONTAINER);

    const project = composeProject(info);
    if (project) {
        printComposeInstructions(project, info.Config.Labels?.['com.docker.compose.service']);
        return;
    }

    const ports = publishedPorts(info);
    if (ports.length === 0) {
        console.log('');
        console.log(`${POSTGRES_CONTAINER} publishes no host port — nothing to do.`);
        console.log('');
        return;
    }

    const anonymous = anonymousVolumeMounts(info);
    if (anonymous.length > 0) {
        const destinations = anonymous.map((mount) => mount.Destination).join(', ');
        throw new Error(
            `${POSTGRES_CONTAINER} stores data in an anonymous volume (${destinations}), which would ` +
                'not survive recreating the container. Migrate it to a named volume before running ' +
                'this command.',
        );
    }

    const plan = planRecreateWithoutPublishedPorts(info);
    const namedVolumes = info.Mounts.filter((mount) => mount.Type === 'volume').map(
        (mount) => `${mount.Name} -> ${mount.Destination}`,
    );

    console.log('');
    console.log(`Host ports to remove from ${POSTGRES_CONTAINER}:`);
    for (const port of ports) console.log(`  ${port}`);
    console.log('');
    console.log('Volumes kept as-is:');
    for (const volume of namedVolumes) console.log(`  ${volume}`);
    console.log('');
    console.log('The container will be removed and recreated with:');
    console.log(`  docker ${redactRunArgs(plan.runArgs).join(' ')}`);
    console.log('');
    console.log(`${DEPENDENT_CONTAINERS.join(', ')} will be stopped and started again around it.`);
    console.log('');

    if (options.dryRun) {
        console.log('Dry run — nothing was changed.');
        console.log('');
        return;
    }

    try {
        await authorize(config.cliKeyHash);
    } catch (error) {
        auditLog(config.configDir, {
            action: ACTION,
            outcome: 'failure',
            target: POSTGRES_CONTAINER,
            reason: 'invalid recovery key',
        });
        throw error;
    }

    if (!options.yes) {
        const { confirmed } = await prompts({
            type: 'confirm',
            name: 'confirmed',
            message: `Recreate ${POSTGRES_CONTAINER} without published ports?`,
            initial: false,
        });

        if (!confirmed) {
            console.log('Aborted.');
            return;
        }
    }

    let backupPath: string | undefined;
    const stopped: string[] = [];

    try {
        if (!options.skipBackup) {
            backupPath = dumpDatabase(config.configDir, info);
            console.log(`Backup written to ${backupPath}`);
        }

        for (const name of DEPENDENT_CONTAINERS.filter(containerExists)) {
            console.log(`Stopping ${name}…`);
            docker(['stop', name]);
            stopped.push(name);
        }

        console.log(`Removing ${POSTGRES_CONTAINER}…`);
        docker(['rm', '--force', POSTGRES_CONTAINER]);

        console.log(`Recreating ${POSTGRES_CONTAINER}…`);
        try {
            docker(plan.runArgs);
        } catch (error) {
            console.error('');
            console.error('Recreating the container failed. Your data is untouched in the volume.');
            console.error('Restore the previous container with (contains the database password):');
            console.error(`  docker ${plan.rollbackArgs.join(' ')}`);
            console.error('');
            throw error;
        }

        for (const { network, aliases } of plan.extraNetworks) {
            const aliasArgs = aliases.flatMap((alias) => ['--alias', alias]);
            docker(['network', 'connect', ...aliasArgs, network, POSTGRES_CONTAINER]);
        }

        await waitUntilHealthy(POSTGRES_CONTAINER, HEALTH_TIMEOUT_SECONDS);

        const remaining = publishedPorts(inspectContainer(POSTGRES_CONTAINER));
        if (remaining.length > 0) {
            throw new Error(
                `${POSTGRES_CONTAINER} still publishes ${remaining.join(', ')} after recreation.`,
            );
        }

        auditLog(config.configDir, {
            action: ACTION,
            outcome: 'success',
            target: POSTGRES_CONTAINER,
        });
    } catch (error) {
        auditLog(config.configDir, {
            action: ACTION,
            outcome: 'failure',
            target: POSTGRES_CONTAINER,
            reason: (error as Error).message,
        });
        throw error;
    } finally {
        restartDependents(stopped);
    }

    console.log('');
    console.log(`${POSTGRES_CONTAINER} no longer publishes any host port.`);
    console.log('The database is reachable only from the Docker network and via docker exec.');
    console.log('');
}

function restartDependents(names: string[]): void {
    for (const name of names) {
        try {
            console.log(`Starting ${name}…`);
            docker(['start', name]);
        } catch (error) {
            console.error(`Could not start ${name}: ${(error as Error).message}`);
            console.error(`Start it manually with: docker start ${name}`);
        }
    }
}

function dumpDatabase(
    configDir: string,
    info: ReturnType<typeof inspectContainer>,
): string {
    const { user, db } = readPostgresCredentials(info);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const path = join(configDir, `${db}-pre-unpublish-${timestamp}.dump`);

    const fd = openSync(path, 'w', 0o600);

    try {
        const result = spawnSync(
            'docker',
            ['exec', POSTGRES_CONTAINER, 'pg_dump', '-U', user, '-d', db, '-Fc'],
            { stdio: ['ignore', fd, 'pipe'], encoding: 'utf-8' },
        );

        if (result.status !== 0) {
            throw new Error(
                `pg_dump failed (exit ${result.status}). Re-run with --skip-backup to skip it.\n` +
                    (result.stderr ?? ''),
            );
        }
    } catch (error) {
        closeSync(fd);
        unlinkSync(path);
        throw error;
    }

    closeSync(fd);

    if (statSync(path).size === 0) {
        unlinkSync(path);
        throw new Error('pg_dump produced an empty backup. Aborting before touching the container.');
    }

    return path;
}

function printComposeInstructions(project: string, service: string | undefined): void {
    console.log('');
    console.log(`${POSTGRES_CONTAINER} is managed by Docker Compose (project "${project}").`);
    console.log('Recreating it outside Compose would desynchronise your stack, so do it there:');
    console.log('');
    console.log('  1. Remove the `ports:` block from the postgres service in your compose file');
    console.log(`  2. docker compose up -d --force-recreate ${service ?? 'postgres'}`);
    console.log('');
    console.log('The named volume is reattached automatically — your data is preserved.');
    console.log('');
}
