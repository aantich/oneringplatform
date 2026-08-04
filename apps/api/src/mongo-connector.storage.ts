import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Db } from 'mongodb';
import type { IConnectorConfigStorage, ITokenStorage, StoredConnectorConfig, StoredToken } from '@everworker/oneringai';
import { connectorDocumentToStored, type OrganizationConnectorDocument } from './organization-auth.types.js';

export class MongoOrganizationConnectorStorage implements IConnectorConfigStorage {
  constructor(private readonly database: Db, private readonly platformOrganizationId: string) {}

  async save(name: string, stored: StoredConnectorConfig): Promise<void> {
    const now = Date.now();
    await this.database.collection<OrganizationConnectorDocument>('platform_connector_configs').updateOne(
      { platformOrganizationId: this.platformOrganizationId, name },
      {
        $set: {
          config: stored.config,
          version: stored.version,
          updatedAt: stored.updatedAt,
          ...(stored.templateCredentials ? { templateCredentials: stored.templateCredentials } : {}),
          ...(stored.vendorId ? { vendorId: stored.vendorId } : {}),
          ...(stored.authTemplateId ? { authTemplateId: stored.authTemplateId } : {}),
        },
        $setOnInsert: {
          id: randomUUID(),
          platformOrganizationId: this.platformOrganizationId,
          name,
          createdAt: stored.createdAt || now,
          isLoginProvider: false,
          loginProviderConfig: { autoCreateUsers: true, allowedDomains: [] },
        },
      },
      { upsert: true },
    );
  }

  async get(name: string): Promise<StoredConnectorConfig | null> {
    const document = await this.database.collection<OrganizationConnectorDocument>('platform_connector_configs')
      .findOne({ platformOrganizationId: this.platformOrganizationId, name });
    return document ? connectorDocumentToStored(document) : null;
  }

  async delete(name: string): Promise<boolean> {
    const result = await this.database.collection<OrganizationConnectorDocument>('platform_connector_configs')
      .deleteOne({ platformOrganizationId: this.platformOrganizationId, name });
    return result.deletedCount === 1;
  }

  async has(name: string): Promise<boolean> {
    return Boolean(await this.database.collection<OrganizationConnectorDocument>('platform_connector_configs')
      .findOne({ platformOrganizationId: this.platformOrganizationId, name }, { projection: { _id: 1 } }));
  }

  async list(): Promise<string[]> {
    const documents = await this.database.collection<OrganizationConnectorDocument>('platform_connector_configs')
      .find({ platformOrganizationId: this.platformOrganizationId }, { projection: { name: 1 } }).toArray();
    return documents.map((document) => document.name);
  }

  async listAll(): Promise<StoredConnectorConfig[]> {
    const documents = await this.database.collection<OrganizationConnectorDocument>('platform_connector_configs')
      .find({ platformOrganizationId: this.platformOrganizationId }).toArray();
    return documents.map(connectorDocumentToStored);
  }
}

type EncryptedTokenDocument = {
  keyHash: string;
  encryptedData: string;
  expiresAt: Date;
  updatedAt: Date;
};

export class MongoEncryptedTokenStorage implements ITokenStorage {
  private readonly key: Buffer;

  constructor(private readonly database: Db, encryptionSecret: string) {
    this.key = createHash('sha256').update(encryptionSecret).digest();
  }

  async storeToken(key: string, token: StoredToken): Promise<void> {
    const encryptedData = this.encrypt(JSON.stringify(token));
    await this.database.collection<EncryptedTokenDocument>('platform_oauth_tokens').updateOne(
      { keyHash: this.hashKey(key) },
      {
        $set: {
          encryptedData,
          expiresAt: new Date(token.obtained_at + token.expires_in * 1000),
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );
  }

  async getToken(key: string): Promise<StoredToken | null> {
    const document = await this.database.collection<EncryptedTokenDocument>('platform_oauth_tokens')
      .findOne({ keyHash: this.hashKey(key) });
    return document ? JSON.parse(this.decrypt(document.encryptedData)) as StoredToken : null;
  }

  async deleteToken(key: string): Promise<void> {
    await this.database.collection<EncryptedTokenDocument>('platform_oauth_tokens')
      .deleteOne({ keyHash: this.hashKey(key) });
  }

  async hasToken(key: string): Promise<boolean> {
    return Boolean(await this.database.collection<EncryptedTokenDocument>('platform_oauth_tokens')
      .findOne({ keyHash: this.hashKey(key) }, { projection: { _id: 1 } }));
  }

  async moveAuthorizationCodeToken(
    clientId: string,
    fromUserId: string,
    fromAccountId: string,
    toUserId: string,
    toAccountId: string,
  ): Promise<void> {
    const sourceKey = `auth_code:${clientId}:${fromUserId}:${fromAccountId}`;
    const token = await this.getToken(sourceKey);
    if (!token) return;
    await this.storeToken(`auth_code:${clientId}:${toUserId}:${toAccountId}`, token);
    await this.deleteToken(sourceKey);
  }

  private hashKey(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private encrypt(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.');
  }

  private decrypt(value: string): string {
    const [ivValue, tagValue, encryptedValue] = value.split('.');
    if (!(ivValue && tagValue && encryptedValue)) throw new Error('Invalid encrypted OAuth token');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivValue, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}
