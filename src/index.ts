import { Command } from 'commander';
import { resetPassword } from './commands/reset-password.js';

const program = new Command();

program
    .name('nexploy')
    .description(
        'Recovery CLI for self-hosted Nexploy instances. Run on the server, acts directly on ' +
            'the database using the recovery key generated at install time — works even if the ' +
            'Nexploy web app is down.',
    )
    .version('0.1.0');

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

program.parseAsync(process.argv);
