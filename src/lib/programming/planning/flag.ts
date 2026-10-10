/** Off unless the value is exactly "1". Independent of COACHING_PIPELINE. Paths are listed in docs/generation-paths.md; update that file in the same commit. */
export function longitudinalPlanningEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.LONGITUDINAL_PLANNING === "1";
}
