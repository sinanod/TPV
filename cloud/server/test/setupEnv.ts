import "dotenv/config";

if (!process.env.TEST_DATABASE_URL) {
  throw new Error("Define TEST_DATABASE_URL (una base de datos PostgreSQL que se puede borrar) para los tests");
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
