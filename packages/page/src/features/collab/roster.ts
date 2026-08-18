export interface RosterRenderMember {
  profileId: string;
}

/**
 * Build the compact render roster with live members taking precedence over
 * departed entries (055). The guard remains at the rendering boundary because
 * a reconnect race can briefly expose duplicate profiles in session state.
 */
export function uniqueRosterForRender<T extends RosterRenderMember>(
  live: readonly T[],
  departed: readonly T[] = [],
): Array<{ m: T; leaving: boolean }> {
  const rendered: Array<{ m: T; leaving: boolean }> = [];
  const seen = new Set<string>();
  for (const m of live) {
    if (seen.has(m.profileId)) continue;
    seen.add(m.profileId);
    rendered.push({ m, leaving: false });
  }
  for (const m of departed) {
    if (seen.has(m.profileId)) continue;
    seen.add(m.profileId);
    rendered.push({ m, leaving: true });
  }
  return rendered;
}
