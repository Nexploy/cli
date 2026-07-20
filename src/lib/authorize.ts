import { createHash, timingSafeEqual } from 'node:crypto';
import prompts from 'prompts';

function hashKey(key: string): Buffer {
    return createHash('sha256').update(key, 'utf8').digest();
}

function matchesHash(candidate: string, expectedHashHex: string): boolean {
    const candidateHash = hashKey(candidate);
    const expectedHash = Buffer.from(expectedHashHex, 'hex');

    if (candidateHash.length !== expectedHash.length) return false;
    return timingSafeEqual(candidateHash, expectedHash);
}

export async function authorize(expectedHashHex: string): Promise<void> {
    let key = process.env.NEXPLOY_CLI_KEY;
    if (!key) {
        const response = await prompts({
            type: 'password',
            name: 'key',
            message: 'Recovery key',
        });
        key = response.key;
    }

    if (!key || !matchesHash(key, expectedHashHex)) {
        throw new Error('Invalid recovery key.');
    }
}
