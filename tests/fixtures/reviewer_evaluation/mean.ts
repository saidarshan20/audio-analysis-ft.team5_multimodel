// Reviewer evaluation pilot only. Not imported by application code.
// Return the arithmetic mean; an empty sample collection must return 0.
export function mean(samples: readonly number[]): number {
  const total = samples.reduce((sum, sample) => sum + sample, 0);
  return samples.length === 0 ? 0 : total / samples.length;
}
