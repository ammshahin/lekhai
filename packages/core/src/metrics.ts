/**
 * Word error rate between a reference and a hypothesis transcript.
 * Used by `eval/` to compare STT providers. Case- and punctuation-insensitive;
 * works for Bengali script (splits on whitespace, strips the dari).
 */
export function wordErrorRate(reference: string, hypothesis: string): number {
  const ref = normalizeForWer(reference);
  const hyp = normalizeForWer(hypothesis);
  if (ref.length === 0) return hyp.length === 0 ? 0 : 1;
  return editDistance(ref, hyp) / ref.length;
}

export function normalizeForWer(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFC")
    .replace(/[।॥.,!?;:"“”'‘’()\[\]{}\-–—…]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function editDistance(a: string[], b: string[]): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min((prev[j] ?? 0) + 1, (curr[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    prev = curr;
  }
  return prev[b.length] ?? 0;
}
