import "dotenv/config";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function verifyRelationships() {
  try {
    console.log("\nYAALÉ RELATIONSHIP VERIFICATION\n");

    const checks = [
      {
        name: "Orders with valid customers",
        query: `
          SELECT COUNT(*)::int AS total
          FROM orders o
          LEFT JOIN users u ON o.user_id = u.id
          WHERE u.id IS NULL
        `,
      },
      {
        name: "Order items with valid orders",
        query: `
          SELECT COUNT(*)::int AS total
          FROM order_items oi
          LEFT JOIN orders o ON oi.order_id = o.id
          WHERE o.id IS NULL
        `,
      },
      {
        name: "Order items with valid products",
        query: `
          SELECT COUNT(*)::int AS total
          FROM order_items oi
          LEFT JOIN products p ON oi.product_id = p.id
          WHERE p.id IS NULL
        `,
      },
      {
        name: "Product images with valid products",
        query: `
          SELECT COUNT(*)::int AS total
          FROM product_images pi
          LEFT JOIN products p ON pi.product_id = p.id
          WHERE p.id IS NULL
        `,
      },
      {
        name: "Addresses with valid customers",
        query: `
          SELECT COUNT(*)::int AS total
          FROM addresses a
          LEFT JOIN users u ON a.user_id = u.id
          WHERE u.id IS NULL
        `,
      },
      {
        name: "Order history with valid orders",
        query: `
          SELECT COUNT(*)::int AS total
          FROM order_status_histories h
          LEFT JOIN orders o ON h.order_id = o.id
          WHERE o.id IS NULL
        `,
      },
      {
        name: "Order history with valid users",
        query: `
          SELECT COUNT(*)::int AS total
          FROM order_status_histories h
          LEFT JOIN users u ON h.changed_by = u.id
          WHERE h.changed_by IS NOT NULL AND u.id IS NULL
        `,
      },
    ];

    let allPassed = true;

    for (const check of checks) {
      const result = await pool.query(check.query);
      const missing = result.rows[0].total;

      const passed = missing === 0;

      if (!passed) allPassed = false;

      console.log(
        `${check.name}: ${missing} missing references | ${
          passed ? "PASS" : "FAIL"
        }`
      );
    }

    console.log(
      allPassed
        ? "\nSUCCESS: All relationship checks passed!"
        : "\nWARNING: Some relationships need attention."
    );
  } catch (error) {
    console.error("Relationship verification failed:", error);
  } finally {
    await pool.end();
  }
}

verifyRelationships();