import { useState } from 'react'
import type { Ctx } from '../App'
import { api, money } from '../api'
import { ConfirmButton, PosTag, Icon, tierOf } from '../ui'
import { errText, useI18n } from '../i18n'
import { revealSigning, useFlipIn } from '../reveal'

// The rare icon pick: at most once a season the shop offers three icons, at a premium, for a few matchdays.
// The three cards flip over the first time the pick is shown; signing one plays the "icon signed" reveal.
export function IconPickPanel({ ctx }: { ctx: Ctx }) {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const { career, club } = ctx.st
  const ip = career.iconPick
  const open = ip && ip.season === career.season && !ip.done && (ip.options?.length ?? 0) > 0 && career.day >= ip.day && career.day <= ip.until
  const flip = useFlipIn(`pitchside.iconflip.${ctx.id}.${ip?.season ?? 0}.${ip?.day ?? 0}`, !!open && !career.ended)
  if (!open || career.ended) return null
  async function pick(id: number) {
    setBusy(true)
    try {
      const p = await api.pickIcon(ctx.id, id)
      ctx.toast(p ? t('icon.signed', { name: p.name }) : t('icon.passed'))
      if (p) revealSigning(p, 'icon')
      await ctx.reload()
    } catch (e) { ctx.toast(errText(t, e), true) } finally { setBusy(false) }
  }
  return (
    <section className="panel iconpick">
      <div className="row spread">
        <h3 className="ttl" style={{ margin: 0 }}><Icon name="icon" size={16} />{t('icon.title')}</h3>
        <span className="chip"><Icon name="hourglass" size={12} /> {t('dem.left', { n: Math.max(0, ip!.until - career.day) })}</span>
      </div>
      <p className="hint" style={{ margin: '4px 0 10px' }}><Icon name="info" size={14} className="i" /><span>{t('icon.help')}</span></p>
      <div className={'grid g3 cards' + (flip ? ' flipin' : '')} style={{ gap: 10 }}>
        {ip!.options!.map(o => (
          <div key={o.templateId} className={'iconcard t-' + tierOf(o.overall) + (o.home ? ' home' : '')}>
            <div className="icon-head">
              <span className={'bigovr small t-' + tierOf(o.overall)}><b className="num">{o.overall}</b></span>
              <div><b className="icon-name">{o.name}</b><span className="muted" style={{ fontSize: 12 }}><PosTag p={o.position} /> {o.version}</span></div>
            </div>
            {o.home && <span className="homechip"><Icon name="home" size={13} /> {t('icon.home')}</span>}
            <b className="num icon-price"><Icon name="budget" size={15} /> {money(o.price)}</b>
            <ConfirmButton className="primary small" label={<><Icon name="sign" size={14} /> {t('icon.sign')}</>} confirm={t('mk.pay', { v: money(o.price) })}
              disabled={busy || o.price > club.budget} onConfirm={() => pick(o.templateId)} />
            {o.price > club.budget && <small className="muted">{t('err.no_budget')}</small>}
          </div>
        ))}
      </div>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
        <ConfirmButton className="small" label={t('icon.pass')} confirm={t('icon.passConfirm')} onConfirm={() => pick(0)} />
      </div>
    </section>
  )
}
