const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
console.log("[DB] Connected via Prisma (SQLite)");

module.exports = prisma;
