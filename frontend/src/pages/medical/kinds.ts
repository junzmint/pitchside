// The injury catalogue as the UI needs it: tier and body part per kind.
// Mirrors backend/game/injury_kinds.go (the full numbers arrive with the medical view).

export type BodyPart = 'head' | 'shoulder' | 'chest' | 'back' | 'hand' | 'groin' | 'thigh' | 'hamstring' | 'knee' | 'shin' | 'calf' | 'ankle' | 'foot' | 'achilles' | 'body'

export const KINDS: Record<string, { tier: number; part: BodyPart }> = {
  knock: { tier: 1, part: 'thigh' }, ankle_sprain: { tier: 1, part: 'ankle' }, calf: { tier: 1, part: 'calf' }, back: { tier: 1, part: 'back' },
  concussion: { tier: 1, part: 'head' }, finger: { tier: 1, part: 'hand' },
  hamstring: { tier: 2, part: 'hamstring' }, groin: { tier: 2, part: 'groin' }, mcl: { tier: 2, part: 'knee' }, shoulder: { tier: 2, part: 'shoulder' }, rib: { tier: 2, part: 'chest' },
  meniscus: { tier: 3, part: 'knee' }, metatarsal: { tier: 3, part: 'foot' }, ankle_lig: { tier: 3, part: 'ankle' }, pubalgia: { tier: 3, part: 'groin' },
  acl: { tier: 4, part: 'knee' }, achilles: { tier: 4, part: 'achilles' }, broken_leg: { tier: 4, part: 'shin' },
  flu: { tier: 1, part: 'body' }, rest: { tier: 0, part: 'body' }, ease: { tier: 0, part: 'body' }, rehab: { tier: 0, part: 'body' },
}

/** The kind's tier: 0 not an injury · 1 light · 2 medium · 3 serious · 4 career-threatening. */
export function tierOfKind(kind?: string | null): number {
  return kind && KINDS[kind] ? KINDS[kind].tier : 1
}

export function partOfKind(kind?: string | null): BodyPart {
  return (kind && KINDS[kind]?.part) || 'body'
}

/** Not an injury: the staff keep a fit player out on purpose (or he is ill). */
export function plannedKind(kind?: string | null) {
  return kind === 'rest' || kind === 'ease' || kind === 'rehab' || kind === 'flu'
}

/** The i18n key of an injury kind ('' while it has not been diagnosed yet). */
export const injKey = (kind?: string | null) => 'inj.' + (kind && KINDS[kind] ? kind : 'unknown')
