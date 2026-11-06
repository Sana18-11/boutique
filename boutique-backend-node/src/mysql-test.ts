import "dotenv/config";
import mysql from "mysql2/promise";

async function checkTables() {
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  });

  try {
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

    for (const table of tables) {
      const [rows] = await connection.query(
        `SELECT COUNT(*) AS total FROM \`${table}\``
      );

      const result = rows as { total: number }[];

      console.log(`${table}: ${result[0].total}`);
    }
  } finally {
    await connection.end();
  }
}

checkTables().catch(console.error);