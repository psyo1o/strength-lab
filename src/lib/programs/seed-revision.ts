/** Bump when catalog weeks/badges/copy change so NAS DBs refresh program tables.
 * Refresh upserts in place and never DELETEs set_logs. Users, 1RMs, workout
 * history, and WOD results stay. FORCE_RESEED=1 may prune unused catalog rows
 * that have no logs — it is not a user-data wipe. */
export const SEED_REVISION = "20260914-product-copy-v1";
