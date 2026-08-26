import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { pgPool } from "./pg-pool";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient; prismaRev?: number };
const PRISMA_REV = 23;

function createClient() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const adapter = new PrismaPg(pgPool(url, { max: 5 }));
  // Never return these secrets unless a query explicitly opts back in with
  // `omit: { passwordHash: false }`. Guards against accidental leaks via any
  // route that returns a User (directly or through an `include`).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new PrismaClient({ adapter, omit: { user: { passwordHash: true, webhookSecret: true } } } as any);
}

const cached = globalForPrisma.prisma;
const stale = globalForPrisma.prismaRev !== PRISMA_REV
  || (Boolean(cached) && typeof (cached as { integrationLog?: unknown }).integrationLog === "undefined");
export const prisma: PrismaClient = !cached || stale ? createClient() : cached;

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaRev = PRISMA_REV;
}
