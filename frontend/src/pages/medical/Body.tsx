import { useId } from 'react'
import type { BodyPart } from './kinds'

// A front-view body silhouette with the injured part glowing in the colour of its tier.
// Injuries at the back of the body (hamstring, calf, Achilles, back) are hatched.

type Shape = { k: 'c'; x: number; y: number; r: number } | { k: 'r'; x: number; y: number; w: number; h: number; rx: number } | { k: 'e'; x: number; y: number; rx: number; ry: number }

// "l" / "r" are the image's left and right (the side is picked per player so a squad's injuries don't all sit on one leg)
const SHAPES: Record<string, Shape[]> = {
  head: [{ k: 'c', x: 30, y: 12, r: 8.5 }],
  neck: [{ k: 'r', x: 26.5, y: 19.5, w: 7, h: 6, rx: 2 }],
  torso: [{ k: 'r', x: 18, y: 25, w: 24, h: 34, rx: 7 }],
  chest: [{ k: 'r', x: 20.5, y: 27.5, w: 19, h: 14, rx: 5 }],
  shoulderl: [{ k: 'c', x: 17.5, y: 29.5, r: 5 }], shoulderr: [{ k: 'c', x: 42.5, y: 29.5, r: 5 }],
  arml: [{ k: 'r', x: 9.5, y: 29, w: 7, h: 21, rx: 3.5 }, { k: 'r', x: 7.5, y: 47, w: 6.5, h: 17, rx: 3 }],
  armr: [{ k: 'r', x: 43.5, y: 29, w: 7, h: 21, rx: 3.5 }, { k: 'r', x: 46, y: 47, w: 6.5, h: 17, rx: 3 }],
  handl: [{ k: 'c', x: 10.6, y: 67.5, r: 3.8 }], handr: [{ k: 'c', x: 49.4, y: 67.5, r: 3.8 }],
  groin: [{ k: 'r', x: 19, y: 56, w: 22, h: 12, rx: 4 }],
  thighl: [{ k: 'r', x: 19.5, y: 64, w: 9.5, h: 30, rx: 4.5 }], thighr: [{ k: 'r', x: 31, y: 64, w: 9.5, h: 30, rx: 4.5 }],
  kneel: [{ k: 'c', x: 24.2, y: 97, r: 4.8 }], kneer: [{ k: 'c', x: 35.8, y: 97, r: 4.8 }],
  shinl: [{ k: 'r', x: 20.5, y: 100, w: 7.5, h: 29, rx: 3.5 }], shinr: [{ k: 'r', x: 32, y: 100, w: 7.5, h: 29, rx: 3.5 }],
  anklel: [{ k: 'c', x: 24.2, y: 131, r: 3.3 }], ankler: [{ k: 'c', x: 35.8, y: 131, r: 3.3 }],
  footl: [{ k: 'e', x: 22.5, y: 137.5, rx: 5.5, ry: 3.2 }], footr: [{ k: 'e', x: 37.5, y: 137.5, rx: 5.5, ry: 3.2 }],
}
const BASE = ['head', 'neck', 'torso', 'shoulderl', 'shoulderr', 'arml', 'armr', 'handl', 'handr', 'groin',
  'thighl', 'thighr', 'kneel', 'kneer', 'shinl', 'shinr', 'anklel', 'ankler', 'footl', 'footr']

const SIDED: Partial<Record<BodyPart, string>> = { shoulder: 'shoulder', hand: 'hand', thigh: 'thigh', hamstring: 'thigh', knee: 'knee', shin: 'shin', calf: 'shin', ankle: 'ankle', achilles: 'ankle', foot: 'foot' }
const SINGLE: Partial<Record<BodyPart, string>> = { head: 'head', chest: 'chest', back: 'torso', groin: 'groin' }
const AT_BACK: BodyPart[] = ['back', 'hamstring', 'calf', 'achilles']

function draw(s: Shape, key: string, fill?: string) {
  if (s.k === 'c') return <circle key={key} cx={s.x} cy={s.y} r={s.r} fill={fill} />
  if (s.k === 'e') return <ellipse key={key} cx={s.x} cy={s.y} rx={s.rx} ry={s.ry} fill={fill} />
  return <rect key={key} x={s.x} y={s.y} width={s.w} height={s.h} rx={s.rx} fill={fill} />
}

const shapesOf = (keys: string[], fill?: string) => keys.flatMap(k => SHAPES[k].map((s, i) => draw(s, k + i, fill)))

/** tier 0 (a planned rest) glows cyan; 1–4 run from yellow to purple. */
export function Body({ part, tier, seed = 0, size = 96 }: { part?: BodyPart | null; tier: number; seed?: number; size?: number }) {
  const id = 'h' + useId().replace(/[^a-zA-Z0-9]/g, '')
  const side = seed % 2 === 1 ? 'r' : 'l'
  let hurt: string[] = []
  if (part && SIDED[part]) hurt = [SIDED[part] + side]
  else if (part && SINGLE[part]) hurt = [SINGLE[part]!]
  else if (part) hurt = BASE
  const back = !!part && AT_BACK.includes(part)
  return (
    <svg className={'md-body t' + tier} viewBox="0 0 60 144" width={Math.round(size * 60 / 144)} height={size} aria-hidden="true">
      <defs>
        <pattern id={id} width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="3" height="3" className="md-hatchbg" /><line x1="0.8" y1="0" x2="0.8" y2="3" className="md-hatch" />
        </pattern>
      </defs>
      <g className="md-base">{shapesOf(BASE)}</g>
      {hurt.length > 0 && <g className={'md-hurt' + (hurt === BASE ? ' whole' : '')}>{shapesOf(hurt, back ? `url(#${id})` : undefined)}</g>}
    </svg>
  )
}
