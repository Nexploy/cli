import type { PrismaClient } from '@prisma/client';
import { hashPassword } from 'better-auth/crypto';
import { auditLog } from '../lib/audit.js';
import { authorize } from '../lib/authorize.js';
import { loadConfig } from '../lib/config.js';
import { createPrismaClient } from '../lib/db.js';
import { resolvePostgresUrl } from '../lib/docker.js';
import { randomPassword } from '../lib/randomPassword.js';

const ACTION = 'admin.reset-password';

interface UserRow {
    id: string;
    email: string;
}

interface AccountRow {
    id: string;
}

export async function resetPassword(options: { email?: string }): Promise<void> {
    const config = loadConfig();

    try {
        await authorize(config.cliKeyHash);
    } catch (error) {
        auditLog(config.configDir, {
            action: ACTION,
            outcome: 'failure',
            target: options.email,
            reason: 'invalid recovery key',
        });
        throw error;
    }

    let prisma: PrismaClient | undefined;

    try {
        prisma = createPrismaClient(resolvePostgresUrl());

        const user = await resolveUser(prisma, options.email);

        const accounts = await prisma.$queryRaw<AccountRow[]>`
            SELECT id
            FROM account
            WHERE "userId" = ${user.id}
              AND "providerId" = 'credential'
            LIMIT 1
        `;
        const account = accounts[0];

        if (!account) {
            throw new Error(
                `${user.email} has no password-based (email/password) login — it may be an OAuth-only account.`,
            );
        }

        const newPassword = randomPassword();
        const hashed = await hashPassword(newPassword);

        await prisma.$transaction([
            prisma.$executeRaw`
                UPDATE account
                SET password    = ${hashed},
                    "updatedAt" = now()
                WHERE id = ${account.id}
            `,
            prisma.$executeRaw`DELETE
                               FROM session
                               WHERE "userId" = ${user.id}`,
        ]);

        auditLog(config.configDir, { action: ACTION, outcome: 'success', target: user.email });

        console.log('');
        console.log(`Password reset for ${user.email}`);
        console.log('');
        console.log(`  New password: ${newPassword}`);
        console.log('');
        console.log('All active sessions for this user were revoked.');
        console.log('Log in with this password now and change it right away.');
        console.log('');
    } catch (error) {
        auditLog(config.configDir, {
            action: ACTION,
            outcome: 'failure',
            target: options.email,
            reason: (error as Error).message,
        });
        throw error;
    } finally {
        await prisma?.$disconnect();
    }
}

async function resolveUser(prisma: PrismaClient, email: string | undefined): Promise<UserRow> {
    if (email) {
        const rows = await prisma.$queryRaw<UserRow[]>`
            SELECT id, email
            FROM "user"
            WHERE email = ${email}
            LIMIT 1
        `;
        const user = rows[0];
        if (!user) {
            throw new Error(`No user found with email ${email}.`);
        }
        return user;
    }

    const admins = await prisma.$queryRaw<UserRow[]>`
        SELECT id, email
        FROM "user"
        WHERE role = 'admin'
    `;

    if (admins.length === 0) {
        throw new Error('No admin user found. Pass --email <email> to target a specific user.');
    }

    if (admins.length > 1) {
        const emails = admins.map((admin) => admin.email).join(', ');
        throw new Error(
            `Multiple admin users found (${emails}). Pass --email <email> to pick one.`,
        );
    }

    return admins[0];
}
