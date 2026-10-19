import {
    SecretsManagerClient,
    GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

export interface DatabaseSecret {
    user_db_casa: string;
    pass_db_casa: string;
    host: string;
    port: string;
    dbname: string;
    engine: string;
}

export interface AppSecret {
    JWT_ACCESS_SECRET: string;
    ROOT_BOOTSTRAP_EMAIL: string;
    ROOT_BOOTSTRAP_PASSWORD: string;
    RESEND_API_KEY?: string;
    EMAIL_FROM_ADDRESS?: string;
}


const secretsClient = new SecretsManagerClient({
    region: process.env.AWS_REGION || 'us-east-1',
});


export async function getSecret<T>(secretId: string): Promise<T> {
    const command = new GetSecretValueCommand({ SecretId: secretId });
    const response = await secretsClient.send(command);

    if (!response.SecretString) {
        throw new Error(`Secret ${secretId} not found`);
    }

    return JSON.parse(response.SecretString) as T;
}

async function getDatabaseSecret<T>(): Promise<T> {
    // The existing production secret has a trailing slash and the EC2 role is
    // scoped to its ARN. Try it first; keep the canonical name as a later cutover.
    for (const secretId of ['casa/prod/database/', 'casa/prod/database']) {
        try {
            return await getSecret<T>(secretId);
        } catch (error) {
            if ((error as { name?: string }).name !== 'ResourceNotFoundException') {
                throw error;
            }
        }
    }
    throw new Error('Production database secret not found');
}

export async function loadProductionSecrets(): Promise<void> {
    const db_secret = await getDatabaseSecret<DatabaseSecret>();
    const app_secret = await getSecret<AppSecret>("casa/prod/app");

    const user_db_casa = encodeURIComponent(db_secret.user_db_casa);
    const pass_db_casa = encodeURIComponent(db_secret.pass_db_casa);

    if (
        !db_secret.user_db_casa ||
        !db_secret.pass_db_casa ||
        !db_secret.host ||
        !db_secret.port ||
        !db_secret.dbname ||
        !db_secret.engine
    ) {
        throw new Error('Invalid database secret configuration');
    }

    if (
        !app_secret.JWT_ACCESS_SECRET ||
        !app_secret.ROOT_BOOTSTRAP_EMAIL ||
        !app_secret.ROOT_BOOTSTRAP_PASSWORD
    ) {
        throw new Error('Invalid app secret configuration in casa/prod/app');
    }
    if (db_secret.engine !== 'mysql' || !/^\d+$/.test(db_secret.port)) {
        throw new Error('Invalid database engine or port in casa/prod/database');
    }
    // Construct a single-line URL; whitespace here makes Joi/Prisma reject it.
    const db_url = `mysql://${user_db_casa}:${pass_db_casa}@${db_secret.host}:${db_secret.port}/${encodeURIComponent(db_secret.dbname)}`;

    process.env.DATABASE_URL = db_url;
    process.env.JWT_ACCESS_SECRET = app_secret.JWT_ACCESS_SECRET;
    process.env.ROOT_BOOTSTRAP_EMAIL = app_secret.ROOT_BOOTSTRAP_EMAIL;
    process.env.ROOT_BOOTSTRAP_PASSWORD = app_secret.ROOT_BOOTSTRAP_PASSWORD;
    process.env.RESEND_API_KEY = app_secret.RESEND_API_KEY || '';
    process.env.EMAIL_FROM_ADDRESS =
        app_secret.EMAIL_FROM_ADDRESS ||
        process.env.EMAIL_FROM_ADDRESS ||
        'noreply@somoscasa.site';

}
