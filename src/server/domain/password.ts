import { createHash } from "node:crypto";

/**
 * Password digest used for both login lookups and user creation/password
 * changes. Kept as plain sha256 hex so existing rows stay valid (D2);
 * `changePassword` must funnel through this function too.
 *
 * Known debt (B2): an unsalted sha256 is not a password hash — a database leak
 * exposes every password to offline dictionary/rainbow-table attacks. It cannot
 * be fixed by swapping the algorithm in place, because the stored digest *is*
 * the lookup key (`login` compares `User.password` against this function's
 * output): existing rows would stop matching.
 *
 * Upgrade path, when the login flow is allowed to change shape:
 *   1. add `passwordAlgo`/`passwordSalt` columns (default `"sha256"`, null),
 *   2. write new/changed passwords with `scrypt` (or argon2id) +
 *      `randomBytes(16)` salt and `passwordAlgo = "scrypt"`,
 *   3. on a successful sha256 login, re-hash the plaintext that was just
 *      verified and upgrade the row transparently,
 *   4. delete this function once no row carries `passwordAlgo = "sha256"`.
 * Comparing a hash *value* in the WHERE clause (rather than fetching by
 * username and verifying in code) is what has to go first.
 */
export function getPasswordHash(password: string): string {
  return createHash("sha256").update(password).digest("hex");
}
