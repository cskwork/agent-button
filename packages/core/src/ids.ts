/** Sortable, collision-resistant local IDs: prefix_timestamp36_random. */
export function newId(prefix: string): string {
  const time = Date.now().toString(36);
  const rand = crypto.randomUUID().replaceAll("-", "").slice(0, 10);
  return `${prefix}_${time}_${rand}`;
}
