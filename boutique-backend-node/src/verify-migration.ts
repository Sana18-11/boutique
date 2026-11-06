
import "dotenv/config";
import mysql from "mysql2/promise";
import { Pool } from "pg";

const tables = [
  "users",
  "products",
  "product_images",
  "categories",
  "wishlists",
  "videos",
  "offers",
  "store_settings",
  "contact_messages",
  "addresses",
  "orders",
  "order_items",
  "order_status_histories",
  "password_reset_tokens",
];

async function verifyMigration() {
  const mysqlConnection = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  });

  const neonPool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    const client = await neonPool.connect();

    console.log("\nMIGRATION VERIFICATION\n");

    let allMatched = true;

    for (const table of tables) {
      const [mysqlRows] = await mysqlConnection.query(
  `SELECT COUNT(*) AS total FROM \`${table}\``
);

const neonRows = await client.query(
  `SELECT COUNT(*)::int AS total FROM "${table}"`
);

      const mysqlCount = Number(
        (mysqlRows as { total: number }[])[0].total
      );

      const neonCount = Number(neonRows.rows[0].total);

      const matched = mysqlCount === neonCount;

      if (!matched) allMatched = false;

      console.log(
        `${table}: MySQL ${mysqlCount} | Neon ${neonCount} | ${
          matched ? "MATCH" : "MISMATCH"
        }`
      );
    }

    console.log(
      allMatched
        ? "\nSUCCESS: All table counts match!"
        : "\nWARNING: Some table counts do not match."
    );

    client.release();
  } catch (error) {
    console.error("Verification failed:", error);
  } finally {
    await mysqlConnection.end();
    await neonPool.end();
  }
}

verifyMigration();
