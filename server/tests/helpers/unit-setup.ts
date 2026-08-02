/**
 * Unit-project setup: provides dummy connection strings so modules that build
 * lazy clients at import time (e.g. the DBOS data source) can be imported
 * without a real database. No connection is opened — unit tests never touch a
 * DB; they stub the pieces that would.
 */
process.env.DATABASE_URL ??= 'postgresql://stub:stub@localhost:5432/stub';
process.env.DBOS_SYSTEM_DATABASE_URL ??= 'postgresql://stub:stub@localhost:5432/stub_dbos';
