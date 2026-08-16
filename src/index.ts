import { Command } from 'commander';
import { resetPassword } from './commands/reset-password.js';
import { unpublishDatabase } from './commands/unpublish-database.js';

const program = new Command();

program
    .name('nexploy')
    .description(
        'Recovery CLI for self-hosted Nexploy instances. Run on the server, acts directly on ' +
            'the database using the recovery key generated at install time — works even if the ' +
            'Nexploy web app is down.',
    )
    .version('0.1.9');

const admin = program.command('admin').description('Sensitive admin recovery actions');

admin
    .command('reset-password')
    .description('Reset a user password (defaults to the admin account) and revoke their sessions')
    .option('--email <email>', 'Target a specific user by email')
    .action(async (options: { email?: string }) => {
        try {
            await resetPassword(options);
        } catch (error) {
            console.error(`Error: ${(error as Error).message}`);
            process.exitCode = 1;
        }
    });

const security = program.command('security').description('Hardening fixes for an existing instance');

security
    .command('unpublish-database')
    .description(
        'Remove the host port published by the PostgreSQL container (installs before v0.1.9 bound ' +
            'it to 127.0.0.1:5432). Recreates the container in place, keeping its named volume.',
    )
    .option('--dry-run', 'Show what would change without touching anything')
    .option('--skip-backup', 'Do not take a pg_dump before recreating the container')
    .option('-y, --yes', 'Skip the confirmation prompt')
    .action(async (options: { dryRun?: boolean; skipBackup?: boolean; yes?: boolean }) => {
        try {
            await unpublishDatabase(options);
        } catch (error) {
            console.error(`Error: ${(error as Error).message}`);
            process.exitCode = 1;
        }
    });

program.parseAsync(process.argv);
