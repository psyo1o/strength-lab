/** One rewrite brief. The sentences name the failed rule and the allowed correction. */
export function validationFeedback(errors: readonly string[]): string[] {
  const required = requiredActions(errors);
  return ["FAILED:", ...errors.map((error) => `- ${error}`), "REQUIRED:", ...required.map((line) => `- ${line}`)];
}

function requiredActions(errors: readonly string[]): string[] {
  const lines: string[] = [];
  const text = errors.join("\n");
  if (/rest day but contains benchmark/.test(text)) lines.push("Move benchmark to nearest valid training day.");
  if (/long conditioning|long-day flag/.test(text)) lines.push("Create one long conditioning day.");
  if (/heavy squat the day after|heavy pull the day after|long piece sits on|long conditioning follows/.test(text)) {
    lines.push("Separate heavy lower sessions.");
  }
  if (/benchmark week needs|benchmark day is only allowed/.test(text)) lines.push("Place the benchmark on one training day.");
  if (/weekday strength layout repeats/.test(text)) {
    lines.push("Change the strength placement so it is not the same as the previous two weeks.");
  }
  if (/deload week has heavy conditioning/.test(text)) lines.push("Keep deload conditioning at moderate or below.");
  if (!lines.length && errors.length) lines.push("Correct only the listed structure fields. Do not write movements or sets.");
  return lines;
}
