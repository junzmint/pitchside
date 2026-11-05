import { useEffect, useState } from 'react'
import type { Ctx } from '../../App'
import { kitApi, type KitsView } from '../../api_kits'
import { chooseKits, colorDist, kitsClash, type KitDef, type KitSet } from '../../match/engine'
import { KitSVG, KIT_PATTERNS } from '../../kit'
import { Badge, ConfirmButton, Hint, Icon, Loading, PageHead, Seg } from '../../ui'
import { errText, useI18n } from '../../i18n'

// The kit room: the club's three kits on their hangers, and a designer to make them your own —
// pattern, colours for shirt, trim, shorts and socks, classic designs to start from — with a look
// at what both sides will wear in the next match.

type Which = 'home' | 'away' | 'third'
const WHICH: Which[] = ['home', 'away', 'third']
type Part = 'shirt' | 'trim' | 'shorts' | 'socks'
const PARTS: Part[] = ['shirt', 'trim', 'shorts', 'socks']

const pick = <T,>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)]

/** A random but wearable kit: two colours that stand apart, shorts and socks from the same family. */
function randomKit(palette: string[]): KitDef {
  const weighted = ['plain', 'plain', 'stripes', 'stripes', 'hoops', 'halves', 'sash', 'chevron', 'sleeves', 'centre', 'band', 'quarters', 'pinstripes']
  const shirt = pick(palette)
  const others = palette.filter(c => colorDist(c, shirt) > 230)
  const trim = others.length ? pick(others) : '#ffffff'
  return { pattern: pick(weighted), shirt, trim, shorts: pick([shirt, trim, shirt]), socks: pick([shirt, trim]) }
}

export default function KitRoom({ ctx }: { ctx: Ctx }) {
  const { t } = useI18n()
  const [v, setV] = useState<KitsView | null>(null)
  const [draft, setDraft] = useState<KitSet | null>(null)
  const [sel, setSel] = useState<Which>('home')
  const [part, setPart] = useState<Part>('shirt')
  const [clubColors, setClubColors] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    kitApi.get(ctx.id).then(x => { setV(x); setDraft(x.kits) }).catch(e => ctx.toast(errText(t, e), true))
  }, [ctx.id])
  if (!v || !draft) return <Loading />

  const kit = draft[sel]
  const dirty = JSON.stringify(draft) !== JSON.stringify(v.kits)
  const setKit = (k: Partial<KitDef>) => setDraft({ ...draft, [sel]: { ...kit, ...k } })
  const setColour = (c: string) => setKit({ [part]: c.toLowerCase() } as Partial<KitDef>)

  async function save() {
    setBusy(true)
    try {
      const x = await kitApi.save(ctx.id, draft!, clubColors)
      setV(x); setDraft(x.kits)
      ctx.toast(t('kit.saved'))
      if (clubColors) await ctx.reload()
    } catch (e) { ctx.toast(errText(t, e), true) } finally { setBusy(false) }
  }
  async function resetAll() {
    setBusy(true)
    try {
      const x = await kitApi.reset(ctx.id)
      setV(x); setDraft(x.kits)
      ctx.toast(t('kit.resetDone'))
    } catch (e) { ctx.toast(errText(t, e), true) } finally { setBusy(false) }
  }

  // the next match: what each side wears when both leave it to the kit man
  const next = v.next
  let worn: { mine: KitDef; mineWhich: string; theirs: KitDef; theirWhich: string } | null = null
  if (next) {
    const home = next.home ? 0 : 1
    const r = chooseKits([draft, next.kits], home as 0 | 1, ['auto', 'auto'])
    worn = { mine: r[0].kit, mineWhich: r[0].which, theirs: r[1].kit, theirWhich: r[1].which }
  }
  // a change kit that looks like the home kit is no use when there is a clash
  const weak = (['away', 'third'] as Which[]).filter(w => kitsClash(draft[w], draft.home))

  return (
    <>
      <PageHead icon="kit" eyebrow={t('kit.eyebrow')} title={t('tab.kits')}>
        <div className="row">
          <Badge short={v.short} color={v.color} color2={v.color2} />
          <span className={'chip' + (v.custom ? ' special' : '')}><Icon name={v.custom ? 'palette' : 'kit'} size={14} /> {v.custom ? t('kit.custom') : t('kit.default')}</span>
          {dirty && <span className="chip warn"><Icon name="warn" size={13} /> {t('kit.unsaved')}</span>}
        </div>
      </PageHead>
      <Hint text={t('kit.help')} />

      <section className="panel kitrack" aria-label={t('tab.kits')}>
        {WHICH.map(w => (
          <button key={w} className={'kitstand' + (w === sel ? ' on' : '')} aria-pressed={w === sel} onClick={() => setSel(w)}>
            <span className="hanger" aria-hidden="true" />
            <KitSVG kit={draft[w]} size={168} number={w === 'home' ? 10 : w === 'away' ? 7 : 9} title={t('kit.' + w)} />
            <b>{t('kit.' + w)}</b>
            {weak.includes(w) && <span className="flag warn" data-tip={t('kit.weakTip')}><Icon name="warn" size={12} /> {t('kit.weak')}</span>}
          </button>
        ))}
      </section>

      <section className="panel kitdesigner">
        <div className="kd-preview">
          <div className="kd-spot"><KitSVG kit={kit} size={250} number={10} /></div>
          <b className="kd-name">{t('kit.' + sel)}</b>
          <div className="row kd-quick">
            <button className="small" onClick={() => setKit({ shirt: kit.trim, trim: kit.shirt })}><Icon name="rotate" size={14} /> {t('kit.swap')}</button>
            <button className="small" onClick={() => setDraft({ ...draft, [sel]: randomKit(v.palette) })}><Icon name="shuffle" size={14} /> {t('kit.random')}</button>
            <button className="small" onClick={() => setDraft({ ...draft, [sel]: v.default[sel] })}><Icon name="replay" size={14} /> {t('kit.resetOne')}</button>
          </div>
        </div>
        <div className="kd-controls">
          <h4><Icon name="kit" size={15} /> {t('kit.pattern')}</h4>
          <div className="patgrid">
            {KIT_PATTERNS.map(p => (
              <button key={p} className={'patbtn' + (kit.pattern === p ? ' on' : '')} aria-pressed={kit.pattern === p} onClick={() => setKit({ pattern: p })}>
                <KitSVG kit={{ ...kit, pattern: p }} size={64} />
                <span>{t('kit.pat.' + p)}</span>
              </button>
            ))}
          </div>
          <h4><Icon name="palette" size={15} /> {t('kit.colours')}</h4>
          <Seg value={part} onChange={setPart} label={t('kit.colours')}
            options={PARTS.map(p => [p, <span key={p} className="partlbl"><i style={{ background: kit[p] }} />{t('kit.part.' + p)}</span>] as [Part, React.ReactNode])} />
          <div className="swatches" role="listbox" aria-label={t('kit.part.' + part)}>
            {v.palette.map(c => (
              <button key={c} className={'swatch' + (kit[part].toLowerCase() === c ? ' on' : '')} style={{ background: c }} aria-label={c} aria-selected={kit[part].toLowerCase() === c}
                role="option" onClick={() => setColour(c)} />
            ))}
            <label className="swatch other" data-tip={t('kit.otherColour')}>
              <input type="color" value={kit[part]} onChange={e => setColour(e.target.value)} aria-label={t('kit.otherColour')} />
              <Icon name="plus" size={14} />
            </label>
          </div>
          <h4><Icon name="star" size={15} /> {t('kit.presets')}</h4>
          <div className="presetrow">
            {v.presets.map(p => (
              <button key={p.key} className="presetbtn" onClick={() => setDraft({ ...draft, [sel]: p.kit })} data-tip={t('kit.preset.' + p.key)}>
                <KitSVG kit={p.kit} size={58} />
                <span>{t('kit.preset.' + p.key)}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {next && worn && (
        <section className="panel kitmatch">
          <h4><Icon name="match" size={15} /> {t('kit.next', { opp: next.name })}</h4>
          <div className="km-row">
            <div className="km-side"><KitSVG kit={worn.mine} size={110} number={10} /><b>{v.name}</b><span className="muted">{t('kit.' + worn.mineWhich)}</span></div>
            <span className="km-vs">VS</span>
            <div className="km-side"><KitSVG kit={worn.theirs} size={110} number={10} /><b>{next.name}</b><span className="muted">{t('kit.' + worn.theirWhich)}</span></div>
          </div>
          {(worn.mineWhich !== 'home' || worn.theirWhich !== 'home') && <p className="muted" style={{ margin: 0 }}>{t('kit.clashNote')}</p>}
        </section>
      )}

      <section className="panel kitsave">
        <label className="row checkrow"><input type="checkbox" checked={clubColors} onChange={e => setClubColors(e.target.checked)} /> {t('kit.clubColors')}</label>
        <div className="row">
          <button className="primary" disabled={busy || (!dirty && !clubColors)} onClick={save}><Icon name="check" size={16} /> {t('kit.save')}</button>
          <button disabled={busy || !dirty} onClick={() => setDraft(v.kits)}><Icon name="close" size={14} /> {t('kit.discard')}</button>
          {v.custom && <ConfirmButton className="small" label={<><Icon name="replay" size={14} /> {t('kit.resetAll')}</>} confirm={t('confirm')} onConfirm={resetAll} />}
        </div>
      </section>
    </>
  )
}
