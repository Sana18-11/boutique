import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const prisma = new PrismaClient({
  adapter,
});

async function testDatabase() {
  try {
    await prisma.$connect();

    console.log("Yaale database connected successfully!");

    const result = await prisma.$queryRaw`
      SELECT current_database(), current_user
    `;

    console.log("Database details:", result);
  } catch (error) {
    console.error("Database connection failed:", error);
  } finally {
    await prisma.$disconnect();
  }
}

testDatabase();

