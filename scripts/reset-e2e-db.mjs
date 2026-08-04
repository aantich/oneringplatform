import { MongoClient } from 'mongodb';

const uri = process.env.MONGO_URI;
if (!uri) throw new Error('MONGO_URI is required for Playwright database isolation');

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
try {
  await client.connect();
  const database = client.db();
  if (database.databaseName !== 'oneringplatform_e2e') {
    throw new Error(`Refusing to reset non-E2E database: ${database.databaseName}`);
  }
  await database.dropDatabase();
} finally {
  await client.close();
}
