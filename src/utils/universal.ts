/**
 * Array utility functions
 */

/**
 * Randomly selects n items from an array using Fisher-Yates shuffle
 */
export function randomSelect<T>(array: T[], n: number): T[] {
  if (n >= array.length) {
    return [...array];
  }

  const shuffled = [...array];
  const selected: T[] = [];

  for (let i = 0; i < n; i++) {
    const randomIndex = Math.floor(Math.random() * (shuffled.length - i)) + i;
    [shuffled[i], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[i]];
    selected.push(shuffled[i]);
  }

  return selected;
}
