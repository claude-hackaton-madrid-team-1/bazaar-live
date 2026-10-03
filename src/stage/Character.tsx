import { motion, useReducedMotion } from 'motion/react'

export type Pose = 'idle' | 'reach' | 'shake' | 'cheer' | 'shrug'

interface Look {
  readonly body: string
  readonly trim: string
  readonly skin: string
  readonly hair: string
}

const LOOKS: Readonly<Record<'buyer' | 'seller', Look>> = {
  seller: { body: '#e76f51', trim: '#fff6e6', skin: '#f1c27d', hair: '#3d405b' },
  buyer: { body: '#2a9d8f', trim: '#264653', skin: '#e0ac69', hair: '#5a3825' },
}

/** Front-arm angle per pose, for a character facing right (the buyer is mirrored). */
const ARM: Readonly<Record<Pose, number>> = { idle: 8, reach: -72, shake: -88, cheer: -160, shrug: -35 }
const BACK_ARM: Readonly<Record<Pose, number>> = { idle: -6, reach: -10, shake: -6, cheer: 160, shrug: 35 }

interface CharacterProps {
  readonly role: 'buyer' | 'seller'
  readonly talking: boolean
  readonly pose: Pose
}

/** One of the two leads, drawn in SVG; the buyer is the seller's mirror image with other clothes. */
export function Character({ role, talking, pose }: CharacterProps) {
  const reduce = useReducedMotion()
  const look = LOOKS[role]
  const spring = { type: 'spring', stiffness: 220, damping: 14 } as const
  const mouth = talking && !reduce ? { ry: [2, 7, 3, 8, 2] } : { ry: 2 }

  return (
    <div className={`character ${role}`}>
      <svg viewBox="0 0 120 200" role="img" aria-label={role === 'buyer' ? 'The buyer' : 'The seller'}>
        <g transform={role === 'buyer' ? 'translate(120 0) scale(-1 1)' : undefined}>
          <motion.g
            animate={reduce ? undefined : { y: talking ? [0, -3, 0] : [0, -1.5, 0] }}
            transition={{ duration: talking ? 0.5 : 3, repeat: Infinity, ease: 'easeInOut' }}
          >
            {/* back arm */}
            <motion.g style={{ originX: 0.5, originY: 0.05 }} animate={{ rotate: BACK_ARM[pose] }} transition={spring}>
              <rect x="27" y="112" width="13" height="50" rx="6.5" fill={look.body} opacity="0.85" />
              <circle cx="33.5" cy="164" r="7" fill={look.skin} />
            </motion.g>
            {/* body */}
            <path d="M34 108 Q60 98 86 108 L96 192 Q60 200 24 192 Z" fill={look.body} />
            {role === 'seller' ? (
              <path d="M44 120 L76 120 L80 186 Q60 192 40 186 Z" fill={look.trim} opacity="0.92" />
            ) : (
              <>
                <path d="M60 104 L60 192" stroke={look.trim} strokeWidth="3" />
                <rect x="74" y="140" width="22" height="28" rx="4" fill="#f4a261" stroke="#264653" strokeWidth="2" />
                <path d="M78 140 Q85 128 92 140" fill="none" stroke="#264653" strokeWidth="2.5" />
              </>
            )}
            {/* head */}
            <circle cx="60" cy="70" r="30" fill={look.skin} />
            {role === 'seller' ? (
              <>
                <path d="M30 62 Q32 34 60 34 Q90 34 90 62 Q74 52 30 62 Z" fill={look.hair} />
                <path d="M84 60 L102 64 Q92 56 84 54 Z" fill={look.hair} />
                <path d="M48 84 Q54 79 60 82 Q66 79 72 84 Q66 86 60 84 Q54 86 48 84 Z" fill="#3d2b1f" />
              </>
            ) : (
              <>
                <path d="M30 66 Q28 36 58 36 Q88 34 90 60 Q80 46 60 50 Q42 50 30 66 Z" fill={look.hair} />
                <rect x="40" y="44" width="40" height="8" rx="4" fill="#111" opacity="0.85" />
              </>
            )}
            {/* eyes blink */}
            <motion.g
              style={{ originY: 0.5 }}
              animate={reduce ? undefined : { scaleY: [1, 1, 0.1, 1] }}
              transition={{ duration: 4, times: [0, 0.9, 0.95, 1], repeat: Infinity }}
            >
              <circle cx="51" cy="68" r="3.4" fill="#1d1d1d" />
              <circle cx="71" cy="68" r="3.4" fill="#1d1d1d" />
            </motion.g>
            <circle cx="44" cy="80" r="5" fill="#ff7b7b" opacity="0.35" />
            <circle cx="78" cy="80" r="5" fill="#ff7b7b" opacity="0.35" />
            <motion.ellipse
              cx="60"
              cy={role === 'seller' ? 90 : 87}
              rx="6"
              fill="#7a2e2e"
              initial={{ ry: 2 }}
              animate={mouth}
              transition={talking ? { duration: 0.45, repeat: Infinity } : { duration: 0.2 }}
            />
            {/* front arm */}
            <motion.g style={{ originX: 0.5, originY: 0.05 }} animate={{ rotate: ARM[pose] }} transition={spring}>
              <rect x="80" y="112" width="13" height="52" rx="6.5" fill={look.body} />
              <circle cx="86.5" cy="166" r="7.5" fill={look.skin} />
            </motion.g>
          </motion.g>
        </g>
      </svg>
      <div className="nameplate">
        {role === 'buyer' ? 'BUYER' : 'SELLER'} <small>{role === 'buyer' ? 'taker' : 'maker'}</small>
      </div>
    </div>
  )
}
