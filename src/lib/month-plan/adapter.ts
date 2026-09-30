import { fillMetconFromRules } from "./pieces";
import type { MetconPiece, MetconRequest } from "./types";

export type MetconAdapter = {
  id: "rules" | "model";
  fill(req: MetconRequest): MetconPiece;
};

export const rulesMetconAdapter: MetconAdapter = {
  id: "rules",
  fill: fillMetconFromRules,
};

export function serverModelKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const key = env.MONTH_PLAN_MODEL_KEY?.trim();
  return key ? key : null;
}

/**
 * Later slice: replace the body with a server-side model call.
 * This slice never opens a network connection. No key means the rules filler.
 */
export function fillMetconFromModel(req: MetconRequest, key: string): MetconPiece {
  if (!key) return fillMetconFromRules(req);
  return fillMetconFromRules(req);
}

export function modelMetconAdapter(env: NodeJS.ProcessEnv = process.env): MetconAdapter {
  return {
    id: "model",
    fill(req) {
      const key = serverModelKey(env);
      if (!key) return fillMetconFromRules(req);
      return fillMetconFromModel(req, key);
    },
  };
}

export function defaultMetconAdapter(env: NodeJS.ProcessEnv = process.env): MetconAdapter {
  return serverModelKey(env) ? modelMetconAdapter(env) : rulesMetconAdapter;
}
