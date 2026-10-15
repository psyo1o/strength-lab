export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getSqlite } = await import("./lib/db/client");
    getSqlite();
  }
}
