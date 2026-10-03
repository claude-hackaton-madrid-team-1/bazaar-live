/**
 * The four merchants of the stall as stylised RPG figures, drawn in SVG and animated with Motion:
 * the SELLER (a broker in a wine coat and apron), the BUYER (a hooded collector with a satchel),
 * Abuela Carmen (a herbalist with a shawl and a lantern) and El Chato (a flat-capped rogue).
 * Every figure breathes when idle; the pose adds a gesture: talk, greet, haggle, reach, triumph or
 * grumble. All art is original; with reduced motion the figures hold their pose without moving.
 */
import { motion, useReducedMotion, type TargetAndTransition } from 'motion/react'

export type Role = 'seller' | 'buyer' | 'abuela' | 'chato'
export type Pose = 'idle' | 'greet' | 'haggle' | 'reach' | 'triumph' | 'grumble'

interface Look {
  readonly coat: string
  readonly coatDark: string
  readonly trim: string
  readonly skin: string
  readonly skinShade: string
  readonly hair: string
}

const LOOKS: Readonly<Record<Role, Look>> = {
  seller: { coat: '#a8323e', coatDark: '#6e1d2e', trim: '#f2b544', skin: '#f1c27d', skinShade: '#d9a45e', hair: '#2f2118' },
  buyer: { coat: '#1f7a7a', coatDark: '#134a55', trim: '#f2e3bd', skin: '#e0ac69', skinShade: '#c68d4d', hair: '#4a2c1c' },
  abuela: { coat: '#c8674a', coatDark: '#8e3f2e', trim: '#f6e6bd', skin: '#e8b98a', skinShade: '#cf9a6d', hair: '#d9d4dc' },
  chato: { coat: '#4a5560', coatDark: '#2b323b', trim: '#8c2f3d', skin: '#d9a66e', skinShade: '#bd8750', hair: '#2b2f3a' },
}

/** Arm angles in degrees at the shoulder (0 hangs down; negative lifts the hand up and out). */
const FRONT: Readonly<Record<Pose, number | number[]>> = {
  idle: [8, 10, 8],
  greet: [-150, -118, -150, -118, -140],
  haggle: [-30, -58, -30, -58, -30],
  reach: -72,
  triumph: [-160, -172, -160],
  grumble: 66,
}
const BACK: Readonly<Record<Pose, number | number[]>> = {
  idle: [-6, -8, -6],
  greet: -8,
  haggle: [-22, -46, -22],
  reach: -10,
  triumph: [160, 172, 160],
  grumble: -66,
}

const BODY: Readonly<Record<Pose, TargetAndTransition>> = {
  idle: {},
  greet: { rotate: [0, 2, 0] },
  haggle: { x: [0, 3, -3, 0], rotate: [0, 2.4, -2.4, 0] },
  reach: { x: 3, rotate: 2 },
  triumph: { y: [0, -14, 0, -10, 0] },
  grumble: { y: 4, x: [0, -3, 3, -3, 3, 0], rotate: [0, -3, 3, -3, 0] },
}

const MOUTH = {
  idle: 'M54 91Q70 97 86 91',
  smile: 'M52 88Q70 106 88 88Q70 94 52 88Z',
  frown: 'M54 96Q70 86 86 96',
  talkA: 'M56 90Q70 104 84 90Q70 94 56 90Z',
  talkB: 'M58 89Q70 96 82 89Q70 91 58 89Z',
} as const

function Mouth({ pose, talking, reduce }: { readonly pose: Pose; readonly talking: boolean; readonly reduce: boolean | null }) {
  const rest = pose === 'grumble' ? MOUTH.frown : pose === 'triumph' ? MOUTH.smile : MOUTH.idle
  const animate = talking && !reduce ? { d: [MOUTH.talkB, MOUTH.talkA, MOUTH.talkB, MOUTH.talkA, MOUTH.idle] } : { d: rest }
  return <motion.path fill="#6e1d2e" stroke="#3a1018" strokeWidth="2" strokeLinejoin="round" initial={{ d: MOUTH.idle }} animate={animate} transition={talking ? { duration: 0.55, repeat: Infinity } : { duration: 0.25 }} />
}

function Brows({ pose, look }: { readonly pose: Pose; readonly look: Look }) {
  const angry = pose === 'grumble'
  const raised = pose === 'haggle' || pose === 'greet'
  const y = raised ? 53 : 58
  return (
    <g stroke={look.hair === '#d9d4dc' ? '#9a949e' : look.hair} strokeWidth="3.4" strokeLinecap="round" fill="none">
      <path d={angry ? 'M44 60L58 64' : `M44 ${y + 2}Q51 ${y - 3} 58 ${y}`} />
      <path d={angry ? 'M96 60L82 64' : `M96 ${y + 2}Q89 ${y - 3} 82 ${y}`} />
    </g>
  )
}

function Eyes({ pose, reduce }: { readonly pose: Pose; readonly reduce: boolean | null }) {
  if (pose === 'triumph') {
    return (
      <g stroke="#1d1d1d" strokeWidth="3.2" fill="none" strokeLinecap="round">
        <path d="M46 70q6 -8 12 0" />
        <path d="M82 70q6 -8 12 0" />
      </g>
    )
  }
  return (
    <motion.g style={{ originY: 0.5 }} animate={reduce ? undefined : { scaleY: [1, 1, 0.1, 1] }} transition={{ duration: 4.2, times: [0, 0.9, 0.95, 1], repeat: Infinity }}>
      <ellipse cx="52" cy="70" rx="3.6" ry={pose === 'grumble' ? 2.6 : 4} fill="#1d1d1d" />
      <ellipse cx="88" cy="70" rx="3.6" ry={pose === 'grumble' ? 2.6 : 4} fill="#1d1d1d" />
      <circle cx="53.4" cy="68.6" r="1.1" fill="#fff" />
      <circle cx="89.4" cy="68.6" r="1.1" fill="#fff" />
    </motion.g>
  )
}

/** Hat, hood, bun or cap, and the features that make each one themselves. */
function Face({ role, look }: { readonly role: Role; readonly look: Look }) {
  if (role === 'seller') {
    return (
      <>
        <path d="M30 56Q70 34 110 56Q70 48 30 56Z" fill={look.hair} />
        <path d="M44 100Q70 92 96 100Q88 112 70 108Q52 112 44 100Z" fill={look.hair} />
        <path d="M18 54Q70 40 122 54Q112 62 70 58Q28 62 18 54Z" fill="#3a2418" stroke="#241309" strokeWidth="2" />
        <path d="M40 54Q40 22 70 20Q100 22 100 54Q70 46 40 54Z" fill="#4a2f1e" stroke="#241309" strokeWidth="2" />
        <path d="M40 52Q70 44 100 52" fill="none" stroke={look.trim} strokeWidth="4" />
        <path d="M96 40Q122 22 126 4Q108 14 94 34Z" fill="#2c8c86" stroke="#134a55" strokeWidth="1.5" />
      </>
    )
  }
  if (role === 'buyer') {
    return (
      <>
        <path d="M22 100Q16 40 70 30Q124 40 118 100Q112 70 70 62Q28 70 22 100Z" fill={look.coatDark} />
        <path d="M30 92Q28 48 70 38Q112 48 110 92Q104 66 70 60Q36 66 30 92Z" fill={look.coat} stroke={look.coatDark} strokeWidth="2" />
        <path d="M34 54Q70 40 106 54" fill="none" stroke="#7a4a28" strokeWidth="6" />
        <circle cx="52" cy="50" r="9" fill="#e0a93a" stroke="#7a4a28" strokeWidth="3" />
        <circle cx="52" cy="50" r="4" fill="#8bd3e0" opacity="0.8" />
        <circle cx="88" cy="50" r="9" fill="#e0a93a" stroke="#7a4a28" strokeWidth="3" />
        <circle cx="88" cy="50" r="4" fill="#8bd3e0" opacity="0.8" />
        <path d="M36 98Q70 114 104 98L100 112Q70 124 40 112Z" fill={look.trim} />
      </>
    )
  }
  if (role === 'abuela') {
    return (
      <>
        <path d="M38 62Q40 36 70 36Q100 36 102 62Q86 50 70 52Q54 50 38 62Z" fill={look.hair} />
        <circle cx="70" cy="30" r="15" fill={look.hair} stroke="#b9b2bd" strokeWidth="2" />
        <path d="M60 28q10 -8 20 0M62 34q8 -5 16 0" fill="none" stroke="#b9b2bd" strokeWidth="1.5" />
        <g fill="rgba(255,255,255,.18)" stroke="#6b4a2a" strokeWidth="2.2">
          <circle cx="52" cy="70" r="10" />
          <circle cx="88" cy="70" r="10" />
          <path d="M62 70h16" fill="none" />
        </g>
        <path d="M44 82q4 3 8 0M88 82q4 3 8 0M62 56q8 -3 16 0" fill="none" stroke={look.skinShade} strokeWidth="1.6" />
      </>
    )
  }
  return (
    <>
      <path d="M28 52Q70 44 112 52L118 60Q70 56 22 60Z" fill="#2b2f3a" />
      <path d="M36 54Q36 28 70 26Q104 28 104 54Q70 46 36 54Z" fill="#353a47" stroke="#1d2029" strokeWidth="2" />
      <path d="M100 54h24l-6 8h-18z" fill="#1d2029" />
      <path d="M62 52l-2 -10M70 52l1 -12" stroke="#4a5060" strokeWidth="1.5" />
      <path d="M92 76l-6 14" stroke="#9a5a4a" strokeWidth="2.4" strokeLinecap="round" />
      <g fill={look.skinShade} opacity="0.7">
        {Array.from({ length: 16 }, (_, k) => (
          <circle key={k} cx={48 + (k % 8) * 6} cy={94 + Math.floor(k / 8) * 6 - (k % 3)} r="1" />
        ))}
      </g>
      <path d="M78 92l24 2" stroke="#d9c08b" strokeWidth="2" strokeLinecap="round" />
    </>
  )
}

/** What each role wears over the torso. */
function Garb({ role, look }: { readonly role: Role; readonly look: Look }) {
  if (role === 'seller') {
    return (
      <>
        <path d="M54 108L70 150L86 108" fill={look.coatDark} />
        <path d="M44 124h52l6 90Q70 222 38 214z" fill="#f1e2bd" stroke="#b9a070" strokeWidth="2" />
        <rect x="52" y="160" width="36" height="24" rx="5" fill="#e3d09f" stroke="#b9a070" strokeWidth="2" />
        <path d="M52 108L48 190M88 108L92 190" stroke={look.trim} strokeWidth="3.4" />
        {[132, 146, 160].map((y) => (
          <circle key={y} cx="70" cy={y} r="3" fill={look.trim} />
        ))}
        <g transform="translate(100 168)">
          <path d="M-8 -6Q0 -14 8 -6Q12 8 0 10Q-12 8 -8 -6Z" fill="#7a4a28" stroke="#3a2418" strokeWidth="1.5" />
          <circle cy="-2" r="3.2" fill="url(#coin)" />
        </g>
      </>
    )
  }
  if (role === 'buyer') {
    return (
      <>
        <path d="M30 112Q70 96 110 112L116 154Q70 170 24 154Z" fill={look.coatDark} opacity="0.6" />
        <path d="M70 104V214" stroke={look.coatDark} strokeWidth="4" />
        <path d="M40 110L98 212" stroke="#7a4a28" strokeWidth="9" strokeLinecap="round" />
        <path d="M40 110L98 212" stroke="#b07a46" strokeWidth="2" strokeDasharray="6 5" />
        <g transform="translate(96 168)">
          <rect x="-4" y="0" width="28" height="30" rx="5" fill="#8a5a3b" stroke="#3a2418" strokeWidth="2" />
          <path d="M-4 8h28" stroke="#3a2418" strokeWidth="2" />
          <circle cx="10" cy="14" r="3.4" fill="#f2b544" />
        </g>
      </>
    )
  }
  if (role === 'abuela') {
    return (
      <>
        <path d="M50 110L70 152L90 110Z" fill="#4a3a5c" />
        <path d="M30 112Q70 140 110 112L120 190Q70 216 20 190Z" fill={look.coat} stroke={look.coatDark} strokeWidth="2.4" />
        <path d="M24 176Q70 202 116 176" fill="none" stroke={look.trim} strokeWidth="3.4" strokeDasharray="2 6" strokeLinecap="round" />
        <path d="M44 126q26 22 52 0" fill="none" stroke={look.coatDark} strokeWidth="2" opacity="0.7" />
      </>
    )
  }
  return (
    <>
      <path d="M52 108L70 146L88 108" fill="#8c2f3d" />
      <path d="M34 106L52 100L58 126L48 214L30 210Z M106 106L88 100L82 126L92 214L110 210Z" fill={look.coatDark} />
      <path d="M52 108L48 214M88 108L92 214" stroke="#1d2029" strokeWidth="3" />
      <path d="M52 112Q70 130 88 112" fill="none" stroke="#8c2f3d" strokeWidth="9" strokeLinecap="round" />
      {[138, 158, 178].map((y) => (
        <circle key={y} cx="70" cy={y} r="3" fill="#8c8f99" />
      ))}
    </>
  )
}

interface MerchantProps {
  readonly role: Role
  readonly pose?: Pose
  readonly talking?: boolean
  /** The figure faces left (the buyer mirrors the seller). */
  readonly flip?: boolean
  readonly className?: string
  readonly label: string
}

export function Merchant({ role, pose = 'idle', talking = false, flip = false, className, label }: MerchantProps) {
  const reduce = useReducedMotion()
  const look = LOOKS[role]
  const spring = { type: 'spring', stiffness: 200, damping: 13 } as const
  const arm = (angle: number | number[], loop: boolean): { animate: TargetAndTransition; transition: object } =>
    reduce
      ? { animate: { rotate: Array.isArray(angle) ? (angle[0] ?? 0) : angle }, transition: { duration: 0 } }
      : Array.isArray(angle)
        ? { animate: { rotate: angle }, transition: { duration: pose === 'idle' ? 3.6 : 1.1, repeat: loop ? Infinity : 0, ease: 'easeInOut' } }
        : { animate: { rotate: angle }, transition: spring }
  const loops = pose === 'haggle' || pose === 'triumph' || pose === 'idle'
  const front = arm(talking && pose === 'idle' ? [-18, -34, -22, -38, -18] : FRONT[pose], loops || talking)
  const back = arm(BACK[pose], loops)
  const bodyMotion = reduce ? undefined : BODY[pose]
  const mirrored = flip ? 'translate(140 0) scale(-1 1)' : undefined

  return (
    <div className={`merchant ${role} ${className ?? ''}`} data-pose={pose} data-talking={talking || undefined}>
      <svg viewBox="0 0 140 232" role="img" aria-label={label}>
        <g transform={mirrored}>
          <ellipse cx="70" cy="224" rx="52" ry="7" fill="rgba(0,0,0,.35)" />
          <motion.g animate={bodyMotion} transition={{ duration: pose === 'triumph' ? 1.1 : 0.9, repeat: pose === 'haggle' || pose === 'triumph' || pose === 'grumble' ? 2 : 0, ease: 'easeInOut' }} style={{ originX: 0.5, originY: 1 }}>
            <motion.g
              style={{ originX: 0.5, originY: 1 }}
              animate={reduce ? undefined : { scaleY: [1, 1.016, 1], y: [0, -1.2, 0] }}
              transition={{ duration: talking ? 0.7 : 3.6, repeat: Infinity, ease: 'easeInOut' }}
            >
              {role === 'abuela' && (
                <g transform="translate(14 60)">
                  <path d="M0 0v156" stroke="#5b3a22" strokeWidth="5" strokeLinecap="round" />
                  <path d="M0 0q0 -14 12 -14" fill="none" stroke="#5b3a22" strokeWidth="5" strokeLinecap="round" />
                  <circle cx="14" cy="6" r="30" fill="url(#glow)" className="flicker" />
                  <path d="M6 -2h16l-2 -7h-12z" fill="#3b2540" />
                  <path d="M6 -2h16q2 10 0 18q-8 4 -16 0q-2 -8 0 -18z" fill="url(#lantern-glass)" stroke="#3b2540" strokeWidth="1.6" />
                </g>
              )}
              <motion.g style={{ originX: 0.5, originY: 0.05 }} {...back}>
                <rect x="26" y="112" width="14" height="52" rx="7" fill={look.coat} opacity="0.88" />
                <circle cx="33" cy="166" r="7.4" fill={look.skin} />
              </motion.g>
              <path d="M32 110Q70 98 108 110L120 214Q70 226 20 214Z" fill={look.coat} stroke={look.coatDark} strokeWidth="2.4" />
              <Garb role={role} look={look} />
              <path d="M54 96Q70 112 86 96V106Q70 120 54 106Z" fill={look.skin} />
              <motion.g
                style={{ originX: 0.5, originY: 0.97 }}
                animate={reduce ? undefined : pose === 'grumble' ? { rotate: [0, -5, 5, -5, 5, 0] } : talking ? { rotate: [0, -2, 2, -1, 0], y: [0, -1.5, 0] } : { rotate: [0, 0.8, 0] }}
                transition={{ duration: pose === 'grumble' ? 0.9 : talking ? 0.6 : 5, repeat: pose === 'grumble' ? 1 : Infinity, ease: 'easeInOut' }}
              >
                <ellipse cx="70" cy="74" rx="30" ry="32" fill={look.skin} />
                <ellipse cx="46" cy="84" rx="5" ry="3.4" fill="#ff7b7b" opacity="0.32" />
                <ellipse cx="94" cy="84" rx="5" ry="3.4" fill="#ff7b7b" opacity="0.32" />
                <path d="M68 76Q72 84 66 86" fill="none" stroke={look.skinShade} strokeWidth="2.2" strokeLinecap="round" />
                <Eyes pose={pose} reduce={reduce} />
                <Brows pose={pose} look={look} />
                <Mouth pose={pose} talking={talking} reduce={reduce} />
                <Face role={role} look={look} />
              </motion.g>
              <motion.g style={{ originX: 0.5, originY: 0.05 }} {...front}>
                <rect x="100" y="112" width="14" height="54" rx="7" fill={look.coat} />
                <circle cx="107" cy="168" r="7.8" fill={look.skin} />
              </motion.g>
            </motion.g>
          </motion.g>
        </g>
      </svg>
    </div>
  )
}
