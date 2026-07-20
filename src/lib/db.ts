import { Client } from 'pg';

export async function connect(databaseUrl: string): Promise<Client> {
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    return client;
}
