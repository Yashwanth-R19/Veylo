const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const dbKind = (process.env.DATABASE_URL || "").startsWith("postgres") ? "PostgreSQL" : "unknown";
console.log(`[DB] Connected via Prisma (${dbKind})`);

module.exports = prisma;
