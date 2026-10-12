// One guard for every integration suite, executed BEFORE constructing Prisma.
import { assertTestDatabase } from '../../scripts/lib/database-target.mjs';
export function requireTestDatabase(url = process.env.DATABASE_URL) {
  return assertTestDatabase(url, process.env);
}
