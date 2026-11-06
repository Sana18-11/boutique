
import "dotenv/config";
import mysql from "mysql2/promise";
import { Pool } from "pg";

// Tables are ordered to preserve foreign-key relationships.
const tables = [
  "users",
  "categories",
  "products",
  "product_images",
  "addresses",
  "orders",
  "order_items",
  "order_status_histories",
  "wishlists",
  "videos",
  "offers",
  "store_settings",
  "contact_messages",
  "password_reset_tokens",
];

// MySQL TINYINT(1) fields that represent PostgreSQL booleans.
const booleanColumns = new Set([
  "is_admin",
  "is_active",
  "in_stock",
  "is_read",
  "is_default",
]);

async function migrateData() {
  const mysqlConnection = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    multipleStatements: false,
    timezone: "Z",
  });

  const neonPool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  let pgClient;

  try {
    pgClient = await neonPool.connect();

    console.log("Both database connections established.");

    await pgClient.query("BEGIN");

    const copiedCounts: Record<string, number> = {};

    for (const table of tables) {
      // Read all records from the original MySQL database.
      const [rows] = await mysqlConnection.query(
        `SELECT * FROM \`${table}\``
      );

      const records = rows as Record<string, unknown>[];

      if (records.length === 0) {
        copiedCounts[table] = 0;
        console.log(`${table}: No records to copy.`);
        continue;
      }

      const columns = Object.keys(records[0]);

      const columnNames = columns
        .map((column) => `"${column}"`)
        .join(", ");

      for (const record of records) {
        const values = columns.map((column) => {
          const value = record[column];

          if (booleanColumns.has(column) && value !== null) {
            return Boolean(value);
          }

          return value;
        });

        const placeholders = values
          .map((_, index) => `$${index + 1}`)
          .join(", ");

        await pgClient.query(
          `INSERT INTO "${table}" (${columnNames})
           VALUES (${placeholders})`,
          values
        );
      }

      copiedCounts[table] = records.length;

      console.log(`${table}: Prepared ${records.length} records.`);
    }

    // Synchronize PostgreSQL auto-increment sequences.
    for (const table of tables.filter(
      (name) => name !== "password_reset_tokens"
    )) {
      await pgClient.query(
        `SELECT setval(
          pg_get_serial_sequence($1, 'id'),
          COALESCE(MAX(id), 1),
          COUNT(*) > 0
        )
        FROM "${table}"`,
        [`"${table}"`]
      );
    }

    // Commit only after all tables have been copied.
    await pgClient.query("COMMIT");

    console.log("\nMigration completed successfully!");
    console.log("\nCopied record counts:");

    for (const [table, count] of Object.entries(copiedCounts)) {
      console.log(`${table}: ${count}`);
    }
  } catch (error) {
    if (pgClient) {
      await pgClient.query("ROLLBACK");
    }

    console.error("\nMigration failed. Neon transaction rolled back.");
    console.error(
      error instanceof Error ? error.message : String(error)
    );
  } finally {
    if (pgClient) {
      pgClient.release();
    }

    await mysqlConnection.end();
    await neonPool.end();
  }
}

migrateData();
