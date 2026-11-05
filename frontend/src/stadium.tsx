import { useId } from 'react'
import { useI18n } from './i18n'

// The club's ground at night, drawn as SVG from the facility levels (1–5):
//   stadium  → a bigger bowl, more rows, a second tier (3), a roof (4), LED ring and a big screen (5),
//              floodlights from two poles (1) to four light towers with beams (5)
//   training → a training pitch, then cones, a gym and an indoor dome
//   academy  → a school building that grows floors, with the club flag
//   medical  → a clinic with a green cross that grows a wing
// Usage: <StadiumArt stadium={club.stadium} training={club.trainLvl} academy={club.academy} medical={club.medical} color={club.color} color2={club.color2} />

function luma(hex: string) {
  const n = parseInt((hex || '#000').replace('#', ''), 16)
  return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114
}
const clampL = (v: number | undefined) => Math.max(0, Math.min(5, Math.round(v ?? 1)))

function bandPath(cx: number, y1: number, y2: number, rx: number, ry: number) {
  return `M${cx - rx} ${y1}A${rx} ${ry} 0 0 0 ${cx + rx} ${y1}L${cx + rx} ${y2}A${rx} ${ry} 0 0 1 ${cx - rx} ${y2}Z`
}
function ringPath(cx: number, cy: number, ro: number, rso: number, ri: number, rsi: number) {
  return `M${cx - ro} ${cy}A${ro} ${rso} 0 1 0 ${cx + ro} ${cy}A${ro} ${rso} 0 1 0 ${cx - ro} ${cy}ZM${cx - ri} ${cy}A${ri} ${rsi} 0 1 0 ${cx + ri} ${cy}A${ri} ${rsi} 0 1 0 ${cx - ri} ${cy}Z`
}

export function StadiumArt({ stadium, training, academy, medical, color = '#2f6fd1', color2 = '#ffffff', className }: {
  stadium: number; training?: number; academy?: number; medical?: number; color?: string; color2?: string; className?: string
}) {
  const { t } = useI18n()
  const uid = 'sa' + useId().replace(/[^a-zA-Z0-9]/g, '')
  const L = Math.max(1, clampL(stadium)), T = clampL(training), A = clampL(academy), M = clampL(medical)
  const glow = luma(color) < 45 ? (luma(color2) >= 45 ? color2 : '#9aa7b4') : color
  const c2 = Math.abs(luma(color2) - luma(color)) < 30 ? '#ffffff' : color2
  const cx = 320, baseY = 224
  const rx = 150 + L * 13, ry = rx * 0.31
  const H = 16 + L * 7
  const rimY = baseY - H
  const prx = rx * 0.6, pry = ry * 0.5, py = rimY + ry * 0.05
  // pitch corners (a trapezoid in perspective)
  const tl: [number, number] = [cx - prx * 0.7, py - pry * 0.6], tr: [number, number] = [cx + prx * 0.7, py - pry * 0.6]
  const br: [number, number] = [cx + prx * 0.82, py + pry * 0.62], bl: [number, number] = [cx - prx * 0.82, py + pry * 0.62]
  const lerp = (a: [number, number], b: [number, number], k: number): [number, number] => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]
  const P = (p: [number, number]) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`
  const stripes = Array.from({ length: 10 }, (_, i) => [lerp(tl, tr, i / 10), lerp(tl, tr, (i + 1) / 10), lerp(bl, br, (i + 1) / 10), lerp(bl, br, i / 10)])
  const rows = Array.from({ length: 1 + L }, (_, i) => 0.66 + (i + 1) * (0.32 / (L + 1)))
  const roof = L >= 4
  const roofY = rimY - 10 - (L - 4) * 5
  // floodlights: far corners always, near corners from level 2, towers from level 3
  const towerH = L >= 5 ? 92 : L >= 3 ? 70 : 46
  const far: [number, number][] = [[cx - rx * 0.86, rimY - ry * 0.42], [cx + rx * 0.86, rimY - ry * 0.42]]
  const near: [number, number][] = L >= 2 ? [[cx - rx * 0.95, baseY + 6], [cx + rx * 0.95, baseY + 6]] : []
  const flashes = L >= 3 ? [[0.3, 0.2], [0.72, 0.3], [0.5, 0.86], [0.18, 0.7], [0.86, 0.66], [0.62, 0.12]] : []
  const label = t('sa.label', { s: L, t: T, a: A, m: M })
  const pole = (x: number, y: number, front: boolean, key: string) => {
    const top = y - towerH * (front ? 1.05 : 1)
    return (
      <g key={key} className="sa-pole">
        {L >= 3 ? (
          <g stroke="#3d4b5a" strokeWidth={1.4} fill="none">
            <path d={`M${x - 5} ${y}L${x - 1.5} ${top + 6}M${x + 5} ${y}L${x + 1.5} ${top + 6}`} />
            <path d={Array.from({ length: 6 }, (_, i) => { const yy = y - (i + 1) * ((y - top) / 7); const w = 5 - (i + 1) * 0.5; return `M${x - w} ${yy}L${x + w} ${yy - 6}` }).join('')} strokeWidth={0.8} />
          </g>
        ) : <path d={`M${x} ${y}V${top + 4}`} stroke="#3d4b5a" strokeWidth={2.2} />}
        <rect x={x - (L >= 3 ? 9 : 6)} y={top - 4} width={L >= 3 ? 18 : 12} height={L >= 3 ? 9 : 6} rx={1.5} fill="#fff8d8" />
        <circle cx={x} cy={top} r={L >= 3 ? 26 : 16} fill={`url(#${uid}lamp)`} className="sa-lamp" />
        {L >= 5 && <path d={`M${x - 8} ${top + 4}L${cx + (x < cx ? -40 : 40)} ${py + 6}L${cx + (x < cx ? 30 : -30)} ${py - 10}L${x + 8} ${top + 4}Z`} fill={`url(#${uid}beam)`} className="sa-beam" />}
      </g>
    )
  }
  return (
    <svg className={'stadium-art' + (className ? ' ' + className : '')} viewBox="0 0 640 300" role="img" aria-label={label}>
      <title>{label}</title>
      <defs>
        <linearGradient id={uid + 'sky'} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#050b14" /><stop offset="0.7" stopColor="#0e1d2e" /><stop offset="1" stopColor="#13283a" /></linearGradient>
        <radialGradient id={uid + 'halo'} cx="0.5" cy="0.72" r="0.55"><stop offset="0" stopColor={glow} stopOpacity={0.14 + L * 0.05} /><stop offset="1" stopColor={glow} stopOpacity="0" /></radialGradient>
        <radialGradient id={uid + 'lamp'}><stop offset="0" stopColor="#fffbe6" stopOpacity="0.95" /><stop offset="0.3" stopColor="#fff2b0" stopOpacity="0.35" /><stop offset="1" stopColor="#fff2b0" stopOpacity="0" /></radialGradient>
        <linearGradient id={uid + 'beam'} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff6c8" stopOpacity="0.32" /><stop offset="1" stopColor="#fff6c8" stopOpacity="0" /></linearGradient>
        <linearGradient id={uid + 'wall'} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#334354" /><stop offset="1" stopColor="#121a23" /></linearGradient>
        <linearGradient id={uid + 'grass'} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2f8f4a" /><stop offset="1" stopColor="#1f6a36" /></linearGradient>
        <radialGradient id={uid + 'pitchlight'} cx="0.5" cy="0.5" r="0.6"><stop offset="0" stopColor="#ffffff" stopOpacity={0.08 + L * 0.035} /><stop offset="1" stopColor="#ffffff" stopOpacity="0" /></radialGradient>
        <pattern id={uid + 'crowd'} width="7" height="5" patternUnits="userSpaceOnUse">
          <rect width="7" height="5" fill="#16202b" />
          <circle cx="1.6" cy="1.5" r="1.15" fill={color} />
          <circle cx="5.2" cy="3.4" r="1.15" fill={c2} />
          <circle cx="3.6" cy="4.2" r="0.8" fill="#d9e2ea" opacity="0.55" />
        </pattern>
        <clipPath id={uid + 'seats'}><ellipse cx={cx} cy={rimY} rx={rx} ry={ry} /></clipPath>
      </defs>

      {/* night sky, club-coloured halo and stars */}
      {/* sky and ground run far past the frame, so a wide or tall box never shows an edge */}
      <rect x="-1200" y="-600" width="3040" height="900" fill="#050b14" />
      <rect x="-1200" y="0" width="3040" height="300" fill={`url(#${uid}sky)`} />
      <rect width="640" height="300" fill={`url(#${uid}halo)`} />
      <g fill="#cfe3ff" opacity="0.6">{[[40, 30], [96, 62], [170, 22], [250, 48], [402, 26], [470, 58], [560, 30], [610, 74], [520, 96], [30, 110], [-60, 40], [-140, 90], [-240, 30], [700, 44], [790, 100], [880, 36], [-330, 70], [960, 80]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r={i % 3 ? 0.9 : 1.4} className={i % 2 ? 'sa-star' : undefined} />)}</g>

      {/* far floodlights stand behind the stands */}
      {far.map(([x, y], i) => pole(x, y, false, 'f' + i))}

      {/* ground */}
      <rect x="-1200" y={baseY - 6} width="3040" height="700" fill="#0c1a12" />
      <path d={`M-1200 ${baseY + 10}H1840`} stroke="rgba(255,255,255,0.05)" />

      {/* training ground (left) */}
      {T > 0 && (
        <g className="sa-train">
          <polygon points={`22,${baseY + 34} 120,${baseY + 34} 140,${baseY + 6} 46,${baseY + 6}`} fill="#1f6a36" stroke="rgba(255,255,255,0.5)" strokeWidth="1" />
          <path d={`M81 ${baseY + 6}L71 ${baseY + 34}`} stroke="rgba(255,255,255,0.45)" />
          <path d={`M42 ${baseY + 14}h8M128 ${baseY + 14}h8`} stroke="#fff" strokeWidth="2" />
          {T >= 2 && [[60, 20], [80, 26], [100, 18], [110, 28]].map(([x, y], i) => <path key={i} d={`M${x} ${baseY + y}l3 -6l3 6z`} fill="#ff8a2e" />)}
          {T >= 3 && <g><rect x="18" y={baseY - 22} width="44" height="24" fill="#2a3a4a" stroke="#45596d" /><rect x="24" y={baseY - 16} width="32" height="5" fill="#ffd77a" opacity="0.85" /><path d={`M16 ${baseY - 22}h48l-6 -7h-36z`} fill="#3b4f63" /></g>}
          {T >= 5 && <path d={`M84 ${baseY + 2}A34 24 0 0 1 152 ${baseY + 2}Z`} fill="rgba(170,210,255,0.22)" stroke="rgba(190,225,255,0.6)" />}
          {T >= 4 && <rect x="66" y={baseY - 14} width="30" height="16" fill="#26394b" stroke="#45596d" />}
        </g>
      )}

      {/* academy (right) */}
      {A > 0 && (() => {
        const floors = Math.min(3, Math.ceil(A / 2) + (A >= 5 ? 1 : 0))
        const h = 16 + floors * 14
        const x = 520, w = A >= 4 ? 74 : 54
        return (
          <g className="sa-academy">
            <rect x={x} y={baseY + 4 - h} width={w} height={h} fill="#22313f" stroke="#3f5468" />
            {Array.from({ length: floors }, (_, f) => Array.from({ length: Math.floor(w / 13) }, (_, k) => (
              <rect key={f + '-' + k} x={x + 5 + k * 13} y={baseY + 4 - h + 7 + f * 14} width="7" height="6" fill={(f + k) % 3 ? '#ffd77a' : '#40566b'} opacity="0.9" />
            )))}
            <path d={`M${x + w - 8} ${baseY + 4 - h}v-22`} stroke="#8aa0b4" strokeWidth="1.4" />
            <path d={`M${x + w - 8} ${baseY - h - 18}h14l-4 5l4 5h-14z`} fill={color} stroke={c2} strokeWidth="0.8" className="sa-flag" />
          </g>
        )
      })()}

      {/* medical centre (far right) */}
      {M > 0 && (
        <g className="sa-medical">
          <rect x={600} y={baseY - 18} width={M >= 3 ? 40 : 30} height="22" fill="#e6edf3" stroke="#9fb0bf" />
          {M >= 4 && <rect x={604} y={baseY - 30} width="26" height="12" fill="#d5dee6" stroke="#9fb0bf" />}
          <path d={`M611 ${baseY - 12}h4v-4h4v4h4v4h-4v4h-4v-4h-4z`} fill="#22b36b" />
        </g>
      )}

      {/* the stadium: shadow, outer wall, stands full of fans, the pitch */}
      <ellipse cx={cx} cy={baseY + 4} rx={rx * 1.04} ry={ry * 0.9} fill="rgba(0,0,0,0.45)" />
      <path d={bandPath(cx, rimY, baseY, rx, ry)} fill={`url(#${uid}wall)`} />
      <path d={bandPath(cx, rimY, baseY, rx, ry)} fill="none" stroke="rgba(160,200,240,0.12)" />
      {Array.from({ length: 13 }, (_, i) => { const a = Math.PI * (i + 0.5) / 13; const x = cx - Math.cos(a) * rx; const y = rimY + Math.sin(a) * ry; return <path key={i} d={`M${x} ${y}V${y + H}`} stroke="rgba(0,0,0,0.35)" strokeWidth="2" /> })}
      {L >= 3 && <path d={bandPath(cx, rimY + H * 0.42, rimY + H * 0.42 + 4, rx, ry)} fill="#0a1118" opacity="0.8" />}
      {L >= 3 && Array.from({ length: 16 }, (_, i) => { const a = Math.PI * (i + 0.5) / 16; const x = cx - Math.cos(a) * rx * 0.995; const y = rimY + H * 0.2 + Math.sin(a) * ry; return <rect key={i} x={x - 4} y={y} width="8" height={H * 0.14} fill="#ffd77a" opacity="0.75" /> })}
      <path d={`M${cx - rx} ${rimY}A${rx} ${ry} 0 0 0 ${cx + rx} ${rimY}`} fill="none" stroke={L >= 5 ? color : 'rgba(200,220,240,0.3)'} strokeWidth={L >= 5 ? 3 : 1.5} className={L >= 5 ? 'sa-led' : undefined} />
      <ellipse cx={cx} cy={rimY} rx={rx} ry={ry} fill={`url(#${uid}crowd)`} opacity={0.75 + L * 0.05} />
      <g clipPath={`url(#${uid}seats)`} fill="none" stroke="rgba(0,0,0,0.45)" strokeWidth="1.2">
        {rows.map((k, i) => <ellipse key={i} cx={cx} cy={rimY + (1 - k) * ry * 0.18} rx={rx * k} ry={ry * k} />)}
        {L >= 3 && <ellipse cx={cx} cy={rimY + ry * 0.03} rx={rx * 0.82} ry={ry * 0.82} stroke="#0a1118" strokeWidth="3.2" />}
      </g>
      {flashes.map(([u, v], i) => {
        const a = Math.PI * 2 * u, k = 0.74 + v * 0.22
        return <circle key={i} cx={cx + Math.cos(a) * rx * k} cy={rimY + Math.sin(a) * ry * k} r="1.6" fill="#fff" className="sa-flash" style={{ animationDelay: `${(i * 0.83) % 4}s` }} />
      })}
      <ellipse cx={cx} cy={py} rx={prx} ry={pry} fill="#123d22" />
      <g>
        {stripes.map((s, i) => <polygon key={i} points={s.map(P).join(' ')} fill={i % 2 ? '#2a8645' : '#2f9a4f'} />)}
        <polygon points={[tl, tr, br, bl].map(P).join(' ')} fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="1.1" />
        <path d={`M${P(lerp(tl, tr, 0.5))}L${P(lerp(bl, br, 0.5))}`} stroke="rgba(255,255,255,0.7)" strokeWidth="1" />
        <ellipse cx={cx} cy={py + 0.5} rx={prx * 0.14} ry={pry * 0.26} fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="1" />
        <polygon points={[lerp(tl, bl, 0.24), lerp(lerp(tl, tr, 0.12), lerp(bl, br, 0.12), 0.24), lerp(lerp(tl, tr, 0.12), lerp(bl, br, 0.12), 0.76), lerp(tl, bl, 0.76)].map(P).join(' ')} fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="0.9" />
        <polygon points={[lerp(tr, br, 0.24), lerp(lerp(tl, tr, 0.88), lerp(bl, br, 0.88), 0.24), lerp(lerp(tl, tr, 0.88), lerp(bl, br, 0.88), 0.76), lerp(tr, br, 0.76)].map(P).join(' ')} fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="0.9" />
        <ellipse cx={cx} cy={py} rx={prx} ry={pry} fill={`url(#${uid}pitchlight)`} />
      </g>
      {L >= 2 && <ellipse cx={cx} cy={py} rx={prx * 1.02} ry={pry * 1.04} fill="none" stroke={color} strokeWidth="2.4" strokeDasharray="10 4" opacity="0.85" />}

      {/* roof (level 4+), LED ring and flags (level 5), big screen */}
      {roof && (
        <g className="sa-roof">
          {Array.from({ length: 9 }, (_, i) => { const a = Math.PI * (i + 0.5) / 9; const x = cx - Math.cos(a) * rx * 1.02; const y = roofY + Math.sin(a) * ry * 1.02; return <path key={i} d={`M${x} ${y}L${x} ${y + (rimY - roofY) + Math.sin(a) * 2}`} stroke="#5d7085" strokeWidth="1.2" /> })}
          <path d={ringPath(cx, roofY, rx * 1.05, ry * 1.05, rx * 0.8, ry * 0.8)} fill="rgba(190,215,240,0.2)" fillRule="evenodd" stroke="rgba(200,225,250,0.55)" strokeWidth="1.2" />
          <ellipse cx={cx} cy={roofY} rx={rx * 0.8} ry={ry * 0.8} fill="none" stroke="#fff6c8" strokeWidth={L >= 5 ? 2.4 : 1.6} strokeDasharray="3 5" className="sa-rooflights" />
          {L >= 5 && <ellipse cx={cx} cy={roofY} rx={rx * 1.05} ry={ry * 1.05} fill="none" stroke={color} strokeWidth="2.6" className="sa-led" />}
          {L >= 5 && [-0.55, -0.2, 0.2, 0.55].map((u, i) => { const x = cx + u * rx; const y = roofY - Math.sqrt(Math.max(0, 1 - u * u)) * ry * 1.05; return <g key={i}><path d={`M${x} ${y}v-14`} stroke="#9fb3c6" strokeWidth="1" /><path d={`M${x} ${y - 14}h11l-3 3.5l3 3.5h-11z`} fill={i % 2 ? c2 : color} className="sa-flag" /></g> })}
        </g>
      )}
      {L >= 5 && <g className="sa-screen"><rect x={cx - 34} y={roofY - ry * 1.05 - 26} width="68" height="24" rx="2" fill="#0a1118" stroke="#5d7085" /><rect x={cx - 31} y={roofY - ry * 1.05 - 23} width="62" height="18" fill={glow} opacity="0.55" /><path d={`M${cx - 20} ${roofY - ry * 1.05 - 14}h40`} stroke="#fff" strokeWidth="2" opacity="0.8" /></g>}

      {/* near floodlights stand in front */}
      {near.map(([x, y], i) => pole(x, y, true, 'n' + i))}
    </svg>
  )
}
