import { appendFileSync } from 'node:fs';
import { hostname, userInfo } from 'node:os';
import { join } from 'node:path';

export interface AuditEvent {
    action: string;
    outcome: 'success' | 'failure';
    target?: string;
    reason?: string;
}

export function auditLog(configDir: string, event: AuditEvent): void {
    const entry = {
        timestamp: new Date().toISOString(),
        host: hostname(),
        user: userInfo().username,
        pid: process.pid,
        ...event,
    };

    try {
        appendFileSync(join(configDir, 'cli-audit.log'), `${JSON.stringify(entry)}\n`, {
            mode: 0o600,
        });
    } catch {
    }
}
