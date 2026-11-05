import { Icon, Title } from '../../ui'
import { useI18n } from '../../i18n'
import { WifiIcon } from './bits'

/** The title screen's entry to the play modes: quick match, Wi-Fi two-player and the training ground. */
export function PlayCard() {
  const { t } = useI18n()
  return (
    <section className="panel stack pl-card">
      <div className="row spread">
        <Title icon="play">{t('pl.card.title')}</Title>
        <span className="muted pl-cardlead">{t('pl.card.lead')}</span>
      </div>
      <div className="pl-cardgrid">
        <a className="pl-mode q" href="#play/quick">
          <span className="pl-modeico"><Icon name="match" size={30} /></span>
          <b>{t('pl.tab.quick')}</b><small>{t('pl.card.quick')}</small>
        </a>
        <a className="pl-mode w" href="#play/lan">
          <span className="pl-modeico"><WifiIcon size={30} /></span>
          <b>{t('pl.tab.lan')}</b><small>{t('pl.card.lan')}</small>
        </a>
        <a className="pl-mode t" href="#play/training">
          <span className="pl-modeico"><Icon name="training" size={30} /></span>
          <b>{t('pl.tab.training')}</b><small>{t('pl.card.training')}</small>
        </a>
      </div>
    </section>
  )
}
