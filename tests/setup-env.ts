/**
 * Hermetic environment for the unit suite.
 *
 * `src/server/env.ts` requires an admin password and a session secret, and
 * `getEnv()` only fills the gaps from a `.env` file next to the cwd — which a
 * CI checkout does not have. Without this, any test file that reaches
 * `getEnv()` fails with `Invalid environment variables` on CI and passes on a
 * developer machine that happens to have `.env`.
 *
 * Runs before every test file, and real process env always wins.
 */
process.env.ADMIN_USER_PASSWORD ??= "unit-test-admin-password";
process.env.SESSION_SECRET ??= "unit_test_session_secret_at_least_32_chars";
