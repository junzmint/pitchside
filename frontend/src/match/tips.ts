// Who the in-match substitution tip may offer to take off (pages/MatchPage.tsx): kept apart from the page so the
// rule can run headless against the engine.
import type { Engine, MP, Side } from './engine'

/** The men on a side a person plays that a tip may offer to take off, most urgent first: the hurt, then (once
 *  `rested`: a while since the last tip) outfield men under `tired` stamina, the most tired first. A starter you
 *  locked in (Player.locked) only comes up when he is hurt. `seen`: men a tip has already been shown for. */
export function subTipDue(e: Engine, s: Side, seen: { hurt: Set<number>; tired: Set<number> }, rested: boolean, tired: number): MP[] {
  return e.teams[s].filter(p => (p.injured ? !seen.hurt.has(p.data.id) : rested && !p.isGK && !p.data.locked && p.stamina < tired && !seen.tired.has(p.data.id)))
    .sort((a, b) => Number(b.injured) - Number(a.injured) || a.stamina - b.stamina)
}
