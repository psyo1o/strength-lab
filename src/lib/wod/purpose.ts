const SALES = /구매|결제|코칭|유료|멤버십/;

/** Object particle for the last Hangul syllable. 로잉은 받침이 있어 "을", 버피는 "를". */
function objectParticle(text: string): "을" | "를" {
  const last = [...text.trim()].pop() ?? "";
  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return "를";
  return (code - 0xac00) % 28 === 0 ? "를" : "을";
}

/** Split on sentence enders. A line without one counts as a single sentence. */
export function wodPurposeSentences(text: string): string[] {
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const sentences: string[] = [];
  for (const line of lines) {
    const parts = line
      .split(/(?<=[.!?。])\s*/)
      .map((part) => part.trim())
      .filter(Boolean);
    sentences.push(...(parts.length ? parts : [line]));
  }
  return sentences;
}

/** One or two Korean sentences. No coaching sales. Rx loads stay out of API purpose text. */
export function isWodPurpose(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 280) return false;
  if (SALES.test(trimmed)) return false;
  if (!/[\uac00-\ud7a3]/.test(trimmed)) return false;
  const sentences = wodPurposeSentences(trimmed);
  return sentences.length >= 1 && sentences.length <= 2;
}

/**
 * Purpose written with the metcon, at the moment the piece is built.
 * One or two Korean sentences. Not a later label pasted onto a finished WOD.
 */
export function classMetconPurpose(input: {
  names: string[];
  benchmark: boolean;
  longPiece: boolean;
  format: string;
  stimulus: string | null;
}): string {
  const names = input.names.map((name) => name.trim()).filter(Boolean).slice(0, 3);
  const what = names.length ? names.join("·") : "이 동작";
  if (input.benchmark) {
    return `${what}로 같은 기준을 다시 재는 측정이에요. 지난 기록과 나란히 봐 컨디션 변화를 확인해요.`;
  }
  const object = `${what}${objectParticle(what)}`;
  if (input.longPiece) {
    return `${object} 긴 시간 동안 이어 가는 컨디셔닝이에요. 페이스를 유지하는 힘을 봐요.`;
  }
  if (input.stimulus === "technical") {
    return `${what} 기술을 무너지지 않게 유지하는 연습이에요. 속도보다 자세를 먼저 봐요.`;
  }
  if (input.stimulus === "heavy") {
    return `${object} 적은 횟수로 무겁게 다루는 파워 조각이에요. 자세가 무너지면 횟수를 줄여요.`;
  }
  if (input.format === "emom") {
    return `${object} 매분 소화하는 페이스 연습이에요. 분 안의 여유를 보며 호흡을 맞춰요.`;
  }
  if (input.format === "intervals") {
    return `${object} 일과 쉼으로 나눠 이어 가는 조각이에요. 쉬는 동안 자세를 다시 맞춰요.`;
  }
  if (input.format === "for_time") {
    return `${object} 시간 안에 끝내는 반복이에요. 중간에 자세가 흐트러지면 속도를 낮춰요.`;
  }
  return `${object} 정해진 시간 동안 반복하는 컨디셔닝이에요. 동작 전환을 부드럽게 유지해요.`;
}
