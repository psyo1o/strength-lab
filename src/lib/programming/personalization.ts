/** The paid, per-member layer is intentionally empty. Class WOD stays one shared plan. */
export type PersonalizationLayer = {
  enabled: false;
};

export function personalizationLayer(): PersonalizationLayer {
  return { enabled: false };
}

export function personalWodForMember(): null {
  return null;
}
