import { randomBytes } from 'node:crypto';

export function randomPassword(length = 24): string {
    return randomBytes(length)
        .toString('base64')
        .replace(/[+/=]/g, '')
        .slice(0, length);
}
