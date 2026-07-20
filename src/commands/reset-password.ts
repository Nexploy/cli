import { hashPassword } from 'better-auth/crypto';
import { authorize } from '../lib/authorize.js';
import { loadConfig } from '../lib/config.js';
import { connect } from '../lib/db.js';
import { randomPassword } from '../lib/randomPassword.js';

interface UserRow {
    id: string;
    email: string;
}

export async function resetPassword(options: { email?: string }): Promise<void> {
    const config = loadConfig();
    await authorize(config.cliKeyHash);

    const client = await connect(config.databaseUrl);

    try {
        const user = await resolveUser(client, options.email);

        const accountResult = await client.query<{ id: string }>(
            `SELECT id FROM account WHERE "userId" = $1 AND "providerId" = 'credential' LIMIT 1`,
            [user.id],
        );

        const account = accountResult.rows[0];
        if (!account) {
            throw new Error(
                `${user.email} has no password-based (email/password) login — it may be an OAuth-only account.`,
            );
        }

        const newPassword = randomPassword();
        const hashed = await hashPassword(newPassword);

        await client.query(
            `UPDATE account SET password = $1, "updatedAt" = now() WHERE id = $2`,
            [hashed, account.id],
        );
        await client.query(`DELETE FROM session WHERE "userId" = $1`, [user.id]);

        console.log('');
        console.log(`Password reset for ${user.email}`);
        console.log('');
        console.log(`  New password: ${newPassword}`);
        console.log('');
        console.log('All active sessions for this user were revoked.');
        console.log('Log in with this password now and change it right away.');
        console.log('');
    } finally {
        await client.end();
    }
}

async function resolveUser(
    client: Awaited<ReturnType<typeof connect>>,
    email: string | undefined,
): Promise<UserRow> {
    if (email) {
        const result = await client.query<UserRow>(
            `SELECT id, email FROM "user" WHERE email = $1 LIMIT 1`,
            [email],
        );
        const user = result.rows[0];
        if (!user) {
            throw new Error(`No user found with email ${email}.`);
        }
        return user;
    }

    const result = await client.query<UserRow>(`SELECT id, email FROM "user" WHERE role = 'admin'`);

    if (result.rows.length === 0) {
        throw new Error('No admin user found. Pass --email <email> to target a specific user.');
    }

    if (result.rows.length > 1) {
        const emails = result.rows.map((row) => row.email).join(', ');
        throw new Error(
            `Multiple admin users found (${emails}). Pass --email <email> to pick one.`,
        );
    }

    return result.rows[0];
}
