import "dotenv/config";
import mysql from "mysql2/promise";
import { Pool } from "pg";

const mysqlPool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});

const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const checks: Record<string, string[]> = {
  users: ["email", "password", "is_admin"],
  products: [
    "name",
    "price",
    "original_price",
    "discount",
    "sku",
    "category",
    "fabric",
    "stock",
    "is_active",
    "in_stock",
  ],
  orders: [
    "order_number",
    "user_id",
    "total",
    "total_amount",
    "status",
    "payment_status",
  ],
};

function normalize(value: unknown, column: string): string {
  if (value === null || value === undefined) return "NULL";

  if (["is_admin", "is_active", "in_stock"].includes(column)) {
    return String(value === true || value === 1 || value === "1");
  }

  return String(value);
}

async function verifyValues() {
  try {
    console.log("\nIMPORTANT DATA VALUE VERIFICATION\n");

    let allMatched = true;

    for (const [table, requestedColumns] of Object.entries(checks)) {
      const [mysqlRows] = await mysqlPool.query(
        `SELECT * FROM \`${table}\` ORDER BY id`
      );

      const pgResult = await pgPool.query(
        `SELECT * FROM "${table}" ORDER BY id`
      );

      const source = mysqlRows as Record<string, unknown>[];
      const target = pgResult.rows as Record<string, unknown>[];

      const columns = requestedColumns.filter(
        (column) =>
          source.length > 0 &&
          target.length > 0 &&
          column in source[0] &&
          column in target[0]
      );

      let mismatches = 0;

      for (let i = 0; i < source.length; i++) {
        const original = source[i];
        const migrated = target.find(
          (row) => String(row.id) === String(original.id)
        );

        if (!migrated) {
          mismatches++;
          continue;
        }

        for (const column of columns) {
          if (
            normalize(original[column], column) !==
            normalize(migrated[column], column)
          ) {
            mismatches++;
            console.log(
              `${table}: Mismatch in record ID ${original.id}, column ${column}`
            );
          }
        }
      }

      const passed = mismatches === 0 && source.length === target.length;

      if (!passed) allMatched = false;

      console.log(
        `${table}: ${passed ? "MATCH" : "MISMATCH"} | ` +
        `${columns.join(", ")} | ${mismatches} mismatches`
      );
    }

    console.log(
      allMatched
        ? "\nSUCCESS: Important data values match!"
        : "\nWARNING: Some values need checking."
    );
  } catch (error) {
    console.error("Data verification failed:", error);
  } finally {
    await mysqlPool.end();
    await pgPool.end();
  }
}

verifyValues();