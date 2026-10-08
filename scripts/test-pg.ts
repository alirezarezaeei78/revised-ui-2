import { Client } from "pg";

async function test() {
  if (!process.env.DATABASE_URL) {
    throw new Error("Set DATABASE_URL in the environment before checking connectivity.");
  }
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5000
  });
  try {
    await client.connect();
    await client.query("SELECT 1");
    console.log("PostgreSQL connection succeeded.");
  } finally {
    await client.end();
  }
}

test().catch((error: unknown) => {
  // Avoid logging the connection URL or credentials.
  console.error(error instanceof Error ? error.message : "Connection failed.");
  process.exitCode = 1;
});
