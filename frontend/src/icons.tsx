// Game icon set: lucide-react line icons plus a few hand-drawn football ones, all addressed by a
// semantic name so every page uses the same picture for the same idea.
import type { SVGProps } from 'react'
import {
  BriefcaseMedical, Activity, ArrowDownRight, ArrowLeftRight, ArrowUpRight, Award, Banknote, BadgeCheck, Bandage, Briefcase, Building2, CalendarDays,
  ChartColumn, Check, ChevronLeft, ChevronRight, CircleDollarSign, ClipboardList, Clock, Coins, Compass, Crosshair, Crown, Dumbbell,
  Eye, FastForward, FileSignature, Flag, Flame, FolderOpen, Footprints, Gem, Gift, GraduationCap, Hand, HandCoins, Handshake, HeartPulse, History,
  Hourglass, House, Info, Infinity as InfinityIcon, KeyRound, Landmark, LayoutGrid, Link2, List, LogIn, LogOut, Mail, Medal, Megaphone,
  MessageSquare, PiggyBank, Play, Plus, Receipt, Repeat, Route, Scale, ScrollText, Search, Shield, ShieldHalf, Shirt, ShoppingCart,
  SlidersHorizontal, Sparkles, Star, Stethoscope, Swords, Tag, Target, Telescope, Ticket, Trash2, TrendingDown, TrendingUp, TriangleAlert,
  Trophy, Tv, User, UserMinus, UserPlus, Users, Wallet, Wind, Wrench, X, Zap, Lock, Hospital, Percent, Sigma,
  Settings as Gear, Volume2, VolumeX, Gamepad2, Vibrate, Video, Languages, Gauge, Timer, Keyboard, ZoomIn, ZoomOut, MonitorPlay, type LucideIcon,
  Sun, CloudRain, Snowflake, ThermometerSun, CircleHelp, Lightbulb, Rocket, PartyPopper, SkipForward, RotateCcw, MousePointerClick, Sprout, PanelLeft, Hammer,
  Mic, Newspaper, MessagesSquare, Palette, Shuffle
} from 'lucide-react'

type P = SVGProps<SVGSVGElement> & { size?: number; strokeWidth?: number }
const base = (size = 24, strokeWidth = 2): SVGProps<SVGSVGElement> => ({
  width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth, strokeLinecap: 'round', strokeLinejoin: 'round',
})

/** A classic football: centre pentagon with seams running to the rim. */
function Ball({ size, strokeWidth, ...rest }: P) {
  return (
    <svg {...base(size, strokeWidth)} {...rest}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 7.5l4.3 3.1-1.6 5h-5.4l-1.6-5z" fill="currentColor" fillOpacity="0.9" />
      <path d="M12 7.5V2.2M16.3 10.6l5-1.6M14.7 15.6l3.1 4.3M9.3 15.6l-3.1 4.3M7.7 10.6l-5-1.6" />
    </svg>
  )
}
/** Tactics board: a pitch with three markers. */
function Board({ size, strokeWidth, ...rest }: P) {
  return (
    <svg {...base(size, strokeWidth)} {...rest}>
      <rect x="3" y="2.5" width="18" height="19" rx="2" />
      <path d="M3 12h18" /><circle cx="12" cy="12" r="2.6" />
      <path d="M9 2.5v3h6v-3M9 21.5v-3h6v3" />
    </svg>
  )
}
/** Referee whistle, for the coaching staff. */
function Whistle({ size, strokeWidth, ...rest }: P) {
  return (
    <svg {...base(size, strokeWidth)} {...rest}>
      <path d="M2.5 9.5h11l6.5-3v4.5a6.5 6.5 0 1 1-13 2.5" />
      <circle cx="13" cy="13.5" r="2" /><path d="M5 9.5V6.5h4" />
    </svg>
  )
}
/** Goal frame with a net, for clean sheets and goals. */
function GoalNet({ size, strokeWidth, ...rest }: P) {
  return (
    <svg {...base(size, strokeWidth)} {...rest}>
      <path d="M2 20V6h20v14" /><path d="M6 6v14M10 6v14M14 6v14M18 6v14M2 10.5h20M2 15h20" strokeOpacity="0.45" />
    </svg>
  )
}
/** A boot, for assists / dribbling. */
function Boot({ size, strokeWidth, ...rest }: P) {
  return (
    <svg {...base(size, strokeWidth)} {...rest}>
      <path d="M7 3h5v7l7.2 2.4A2.6 2.6 0 0 1 21 14.9V17H3.5a1.5 1.5 0 0 1-1.5-1.5V14c2.5 0 5-1.6 5-4.5z" />
      <path d="M3 20.5h2M8 20.5h2M13 20.5h2M18 20.5h2M12 6h-2M12 9h-2" />
    </svg>
  )
}
/** Stadium bowl. */
function Stadium({ size, strokeWidth, ...rest }: P) {
  return (
    <svg {...base(size, strokeWidth)} {...rest}>
      <ellipse cx="12" cy="9" rx="10" ry="4" /><path d="M2 9v6c0 2.2 4.5 4 10 4s10-1.8 10-4V9" />
      <ellipse cx="12" cy="9" rx="5" ry="1.6" /><path d="M5 4.5V2M19 4.5V2M12 3V1" />
    </svg>
  )
}

const MAP = {
  // menu sections and pages
  home: House, inbox: Mail, play: Ball, team: Shirt, kit: Shirt, palette: Palette, shuffle: Shuffle, market: ArrowLeftRight, club: Landmark, explore: Compass,
  overview: House, match: Ball, tactics: Board, squad: Users, staff: Whistle, competitions: Trophy, stats: ChartColumn, finance: Wallet, history: ScrollText,
  // HUD and general stats
  rank: Medal, points: Star, chemistry: Link2, tp: Gem, budget: Wallet, wages: Banknote, calendar: CalendarDays, clock: Clock, hourglass: Hourglass,
  form: Activity, strength: Zap, attack: Swords, midfield: Route, defense: Shield, goal: GoalNet, assist: Boot, rating: Star, apps: Shirt, cleanSheet: GoalNet,
  // attributes
  pace: Wind, shooting: Crosshair, passing: Route, dribbling: Footprints, defending: ShieldHalf, physical: Dumbbell, goalkeeping: Hand,
  // staff roles
  head: Crown, fitness: HeartPulse, physio: Stethoscope, scout: Telescope, doctor: BriefcaseMedical,
  // money lines
  tickets: Ticket, tv: Tv, ads: Megaphone, merch: Shirt, sponsor: Handshake, prize: Trophy, quest: Target, transferIn: ArrowDownRight, transferOut: ArrowUpRight,
  loan: Landmark, shares: Percent, upkeep: Wrench, facility: Building2, coins: Coins, card: Gift, bonus: Sparkles, fine: Scale, dividend: PiggyBank, receipt: Receipt, money: CircleDollarSign, handCoins: HandCoins, total: Sigma,
  // facilities
  stadium: Stadium, training: Dumbbell, academy: GraduationCap, medical: Hospital,
  // actions and states
  playNow: Play, sim: FastForward, buy: ShoppingCart, sell: Tag, release: UserMinus, hire: UserPlus, fire: UserMinus, sign: FileSignature, contract: FileSignature,
  search: Search, filter: SlidersHorizontal, info: Info, warn: TriangleAlert, check: Check, close: X, trash: Trash2, plus: Plus, lock: Lock, eye: Eye,
  next: ChevronRight, prev: ChevronLeft, up: TrendingUp, down: TrendingDown, injury: Bandage, unrest: Hand, star: Star, crown: Crown, flame: Flame,
  legend: Award, icon: Sparkles, board: ClipboardList, chat: MessageSquare, rotate: Repeat, briefcase: Briefcase, user: User, users: Users, logout: LogOut,
  league: Shield, cup: Trophy, continental: Star,
  settings: Gear, volume: Volume2, mute: VolumeX, gamepad: Gamepad2, vibrate: Vibrate, camera: Video, language: Languages, difficulty: Gauge, timer: Timer,
  keyboard: Keyboard, zoomIn: ZoomIn, zoomOut: ZoomOut, broadcast: MonitorPlay,
  // weather, match day and help
  sun: Sun, rain: CloudRain, snow: Snowflake, heat: ThermometerSun, derby: Swords, watch: Tv, help: CircleHelp, tip: Lightbulb, rocket: Rocket,
  party: PartyPopper, skip: SkipForward, replay: RotateCcw, tap: MousePointerClick, youth: Sprout, menu: PanelLeft, build: Hammer, stadiumArt: Stadium,
  mic: Mic, news: Newspaper, talk: MessagesSquare,
  flag: Flag, login: LogIn, key: KeyRound, saves: FolderOpen, grid: LayoutGrid, list: List, building: Building2, verified: BadgeCheck, history2: History, infinity: InfinityIcon,
} satisfies Record<string, LucideIcon | ((p: P) => JSX.Element)>

export type IconName = keyof typeof MAP

/** One icon by name. Decorative by default (aria-hidden); pass a `title` to make it speak. */
export function Icon({ name, size = 18, className, title, strokeWidth = 2 }: { name: IconName; size?: number; className?: string; title?: string; strokeWidth?: number }) {
  const C = (MAP[name] ?? Info) as (p: P) => JSX.Element
  return (
    <span className={'ico' + (className ? ' ' + className : '')} aria-hidden={title ? undefined : true} role={title ? 'img' : undefined} aria-label={title}>
      <C size={size} strokeWidth={strokeWidth} />
    </span>
  )
}

/** Finance ledger kind → icon. */
export const FIN_ICON: Record<string, IconName> = {
  shares_sold: 'shares', tickets: 'tickets', tv: 'tv', ads: 'ads', merch: 'merch', sponsor: 'sponsor', sponsor_bonus: 'bonus', hot_bonus: 'flame',
  sponsor_target: 'quest', board_reward: 'board', takeover: 'briefcase', card: 'card', signing_bonus: 'sign', friendly_fee: 'handCoins', prize: 'prize',
  quest: 'quest', transfer_out: 'transferOut', forced_sale: 'transferOut', loan: 'loan', wages: 'wages', staff: 'staff', dividend: 'dividend',
  shares_bought: 'shares', upkeep: 'upkeep', board_fine: 'fine', sponsor_exit: 'sponsor', takeover_exit: 'briefcase', loan_payment: 'loan', loan_repay: 'loan',
  facility: 'facility', tp_buy: 'tp', transfer_in: 'transferIn', staff_hire: 'hire', agent_fee: 'briefcase', swap_cash: 'market',
  derby_gate: 'flame', loan_fee_out: 'handCoins', loan_fee_in: 'rotate', loan_breach: 'fine', achievement: 'crown', golden: 'star', scouting: 'search', medical: 'medical',
}
