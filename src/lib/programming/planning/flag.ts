/** Planning core. Off in production. Independent of COACHING_PIPELINE. */
export function longitudinalPlanningEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.LONGITUDINAL_PLANNING === "1";
}
