/**
 * The bazaar at dusk, in original SVG and CSS: a sky that goes from indigo to ember, a moon, two rows
 * of rooftops with lit windows, flanking stalls, strings of pennants and lanterns, heraldic banners,
 * torches, cobbles in perspective, and the stall itself (canopy, curtains, counter). Static layers
 * are drawn once; only transform and opacity move (drift, flicker, sway), so it stays at 60 fps, and
 * reduced motion turns all of it off (stage.css). Nothing here is traced from any game.
 */
import { memo } from 'react'
import { rng } from '../rng'
import { bunting, cobblePaths, scallopedBand, skyline, stars } from './geometry'

const W = 1600
const H = 1000
const PENNANT_TONES = ['#c1384a', '#f2b544', '#2c8c86', '#7c4fb0'] as const

const FAR = skyline(11, 640, 70, 160, W)
const MID = skyline(23, 716, 130, 270, W)
const STARS = stars(7, 54, W, 400)
const ROPES = [bunting(-20, 120, W + 20, 150, 46, 26), bunting(-20, 205, 560, 168, 30, 9), bunting(1040, 168, W + 20, 215, 30, 9)]
const COBBLES = cobblePaths(5, 796, H, W)
const EMBERS = Array.from({ length: 18 }, (_, i) => {
  const r = rng(101 + i)
  return { x: 4 + r() * 92, size: 0.35 + r() * 0.55, rise: 20 + r() * 26, drift: (r() - 0.5) * 8, dur: 8 + r() * 9, delay: -r() * 16 }
})
const AWNING = scallopedBand(320, 1280, 118, 22, 60)

/** One lantern: rope, cap, glass, a flickering glow (a radial gradient, not a filter) and a tassel. */
function Lantern({ x, y, i, size = 1 }: { readonly x: number; readonly y: number; readonly i: number; readonly size?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${size})`} className="sway" style={{ animationDelay: `${(i % 5) * -0.7}s` }}>
      <line x1="0" y1="-60" x2="0" y2="0" stroke="#2a1830" strokeWidth="2" />
      <circle cx="0" cy="26" r="62" fill="url(#glow)" className="flicker" style={{ animationDelay: `${(i % 7) * -0.4}s` }} />
      <path d="M-11 0h22l-3 -9h-16z" fill="#3b2540" />
      <path d="M-13 0h26q4 14 0 30q-13 7 -26 0q-4 -16 0 -30z" fill="url(#lantern-glass)" stroke="#3b2540" strokeWidth="2" />
      <path d="M-13 15h26M0 0v34" stroke="#3b2540" strokeWidth="1.4" opacity="0.7" />
      <path d="M-9 30h18l-3 6h-12z" fill="#3b2540" />
      <path d="M0 36v9" stroke="#f2b544" strokeWidth="2" />
      <circle cx="0" cy="47" r="2.6" fill="#f2b544" />
    </g>
  )
}

/** A heraldic banner on a pole: swallow-tailed cloth, gold border, an original sigil. */
function Banner({ x, hue, sigil }: { readonly x: number; readonly hue: 'wine' | 'teal'; readonly sigil: 'sun' | 'key' }) {
  const cloth = hue === 'wine' ? 'url(#cloth-wine)' : 'url(#cloth-teal)'
  return (
    <g transform={`translate(${x} 70)`}>
      <rect x="-3" y="-10" width="6" height="640" rx="3" fill="#3a2418" />
      <circle cx="0" cy="-12" r="9" fill="#f2b544" />
      <rect x="-62" y="-4" width="124" height="8" rx="4" fill="#5b3a22" />
      <g className="sway banner-sway">
        <path d="M-52 4h104v300l-52 -46l-52 46z" fill={cloth} stroke="#f2b544" strokeWidth="4" strokeLinejoin="round" />
        <path d="M-42 14h84v268l-42 -38l-42 38z" fill="none" stroke="#f2b544" strokeWidth="1.6" opacity="0.6" />
        {sigil === 'sun' ? (
          <g transform="translate(0 110)" fill="#f2b544">
            <circle r="22" />
            {Array.from({ length: 12 }, (_, k) => (
              <path key={k} d="M-3 -29h6l-3 -14z" transform={`rotate(${k * 30})`} />
            ))}
            <circle r="11" fill="#7a2230" />
          </g>
        ) : (
          <g transform="translate(0 110)" fill="none" stroke="#f2b544" strokeWidth="6" strokeLinecap="round">
            <circle cy="-18" r="14" />
            <path d="M0 -4v48M0 30h14M0 42h10" />
          </g>
        )}
        <path d="M-52 304l52 -46l52 46" fill="none" stroke="#f2b544" strokeWidth="3" opacity="0.8" />
      </g>
    </g>
  )
}

/** A torch on a post: a brazier, three nested flames, and a big warm glow. */
function Torch({ x, i }: { readonly x: number; readonly i: number }) {
  return (
    <g transform={`translate(${x} -300)`}>
      <circle cx="0" cy="610" r="190" fill="url(#glow)" className="flicker" style={{ animationDelay: `${i * -0.9}s` }} />
      <rect x="-5" y="660" width="10" height="230" rx="3" fill="#2f1d12" />
      <path d="M-30 640h60l-10 30h-40z" fill="#3b2540" stroke="#f2b544" strokeWidth="2" />
      <g className="flame" style={{ animationDelay: `${i * -0.5}s` }}>
        <path d="M0 640c-26 -16 -22 -46 -2 -66c-2 22 16 24 20 44c10 -12 6 -30 -2 -44c26 14 36 52 -16 66z" fill="#ff7a1a" />
        <path d="M0 640c-14 -10 -12 -28 -1 -40c0 14 10 14 12 26c6 -8 4 -18 -1 -26c16 8 22 32 -10 40z" fill="#ffc04d" />
        <path d="M0 640c-6 -5 -5 -13 0 -19c0 7 4 7 5 12c3 -4 2 -8 0 -12c7 4 9 14 -5 19z" fill="#fff3c9" />
      </g>
    </g>
  )
}

/** A stall far down the street: a scalloped canopy over a table of wares, in silhouette. */
function FarStall({ x, y, w, tone }: { readonly x: number; readonly y: number; readonly w: number; readonly tone: string }) {
  const scallops = Math.max(3, Math.round(w / 34))
  const step = w / scallops
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x="6" y="-70" width="6" height="110" fill="#1d1128" />
      <rect x={w - 12} y="-70" width="6" height="110" fill="#1d1128" />
      <path d={`M-6 -70h${w + 12}l-8 -26h-${w - 4}z`} fill={tone} />
      <path d={`M-6 -70${Array.from({ length: scallops }, () => `q${step / 2} 18 ${step} 0`).join('')}`} fill={tone} opacity="0.9" />
      <rect x="0" y="4" width={w} height="36" fill="#1d1128" />
      <rect x="0" y="0" width={w} height="6" fill="#2b1a3a" />
      {Array.from({ length: Math.floor(w / 26) }, (_, k) => (
        <circle key={k} cx={14 + k * 26} cy="-6" r={6 + (k % 3) * 2} fill={['#a8323e', '#e0a93a', '#2c8c86'][k % 3]} opacity="0.55" />
      ))}
      <circle cx={w / 2} cy="-52" r="26" fill="url(#glow)" opacity="0.55" />
    </g>
  )
}

const BackdropFar = memo(function BackdropFar() {
  return (
    <div className="scene far" aria-hidden="true">
      <svg className="layer l-sky" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#0f0a24" />
            <stop offset="0.38" stopColor="#2b1450" />
            <stop offset="0.6" stopColor="#7a2c63" />
            <stop offset="0.74" stopColor="#d4584a" />
            <stop offset="0.84" stopColor="#f59a4b" />
            <stop offset="1" stopColor="#ffd27d" />
          </linearGradient>
          <radialGradient id="moon-glow">
            <stop offset="0" stopColor="#fff1d0" stopOpacity="0.55" />
            <stop offset="1" stopColor="#fff1d0" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="sun-glow" cx="0.5" cy="1" r="0.8">
            <stop offset="0" stopColor="#ffe3a0" stopOpacity="0.9" />
            <stop offset="1" stopColor="#ffb066" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="glow">
            <stop offset="0" stopColor="#ffd37a" stopOpacity="0.85" />
            <stop offset="0.35" stopColor="#ff9d3d" stopOpacity="0.35" />
            <stop offset="1" stopColor="#ff7a1a" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="lantern-glass" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff1b8" />
            <stop offset="0.6" stopColor="#ffb347" />
            <stop offset="1" stopColor="#e2701c" />
          </linearGradient>
          <linearGradient id="cloth-wine" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#a8323e" />
            <stop offset="1" stopColor="#5e1830" />
          </linearGradient>
          <linearGradient id="cloth-teal" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#2c8c86" />
            <stop offset="1" stopColor="#134a55" />
          </linearGradient>
          <linearGradient id="far-roofs" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#6c3a72" />
            <stop offset="1" stopColor="#3b2152" />
          </linearGradient>
          <linearGradient id="mid-roofs" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#3a2050" />
            <stop offset="1" stopColor="#1f1230" />
          </linearGradient>
        </defs>
        <rect width={W} height={H} fill="url(#sky)" />
        <rect y="440" width={W} height="260" fill="url(#sun-glow)" />
        <g fill="#fff6dc">
          {STARS.filter((s) => !s.twinkle).map((s, i) => (
            <circle key={i} cx={s.x} cy={s.y} r={s.r} opacity={0.35 + (i % 4) * 0.12} />
          ))}
        </g>
        <g fill="#fff6dc" className="twinkle">
          {STARS.filter((s) => s.twinkle).map((s, i) => (
            <circle key={i} cx={s.x} cy={s.y} r={s.r + 0.6} style={{ animationDelay: `${s.delay}s` }} />
          ))}
        </g>
        <circle cx="1210" cy="210" r="120" fill="url(#moon-glow)" />
        <circle cx="1210" cy="210" r="46" fill="#fff0cf" />
        <circle cx="1196" cy="198" r="9" fill="#ead7b2" />
        <circle cx="1226" cy="224" r="6" fill="#ead7b2" />
        <circle cx="1222" cy="190" r="4" fill="#ead7b2" />
      </svg>

      <div className="par p-far">
        <svg className="layer drift slow" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice">
          <path d={FAR.body} fill="url(#far-roofs)" />
          <path d={FAR.lit} fill="#ffc46b" opacity="0.7" />
          <path d={FAR.twinkle} fill="#ffe3a0" className="twinkle" />
        </svg>
      </div>

      <div className="par p-mid">
        <svg className="layer drift" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice">
          <path d={MID.body} fill="url(#mid-roofs)" />
          <path d="M1170 716V470l22 -70l22 70v246z" fill="#27163a" />
          <path d="M1160 470h64l-10 -12h-44z" fill="#321c48" />
          <path d="M1192 400v-40M1186 372h12" stroke="#27163a" strokeWidth="4" />
          <path d="M120 716V262H330V716H270V540A53 53 0 0 0 164 540V716Z" fill="#2c1a40" stroke="#3f2559" strokeWidth="3" />
          <path d="M112 262H338V244H112Z" fill="#3a2253" />
          <path d="M140 300h36v22h-36zM274 300h36v22h-36z" fill="#ffb347" opacity="0.55" />
          <path d="M164 540a53 53 0 0 1 106 0" fill="none" stroke="#4a2c68" strokeWidth="6" />
          <path d={MID.lit} fill="#ffb347" opacity="0.8" />
          <path d={MID.twinkle} fill="#ffe3a0" className="twinkle" />
        </svg>
      </div>

      <div className="par p-stalls">
        <svg className="layer" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice">
          <FarStall x={20} y={778} w={150} tone="#a8323e" />
          <FarStall x={186} y={794} w={130} tone="#2c8c86" />
          <FarStall x={1290} y={794} w={130} tone="#d6942e" />
          <FarStall x={1434} y={778} w={150} tone="#7c4fb0" />
          <FarStall x={470} y={796} w={150} tone="#d6942e" />
          <FarStall x={650} y={806} w={130} tone="#a8323e" />
          <FarStall x={812} y={800} w={140} tone="#2c8c86" />
          <FarStall x={990} y={808} w={130} tone="#7c4fb0" />
        </svg>
      </div>

      <div className="par p-hang">
        <svg className="layer" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice">
          {ROPES.map((rope, r) => (
            <g key={r}>
              <path d={rope.rope} fill="none" stroke="#2a1830" strokeWidth="2.4" />
              {rope.pennants.map((p, i) => (
                <path key={i} d="M-9 0h18l-9 26z" transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) rotate(${p.angle.toFixed(1)})`} fill={PENNANT_TONES[p.tone]} stroke="#2a1830" strokeWidth="1" className="flutter" style={{ animationDelay: `${(i % 6) * -0.5}s` }} />
              ))}
            </g>
          ))}
          <Lantern x={120} y={250} i={1} size={1.15} />
          <Lantern x={330} y={206} i={2} />
          <Lantern x={1270} y={206} i={3} />
          <Lantern x={1480} y={250} i={4} size={1.15} />
          <Lantern x={800} y={162} i={5} size={0.9} />
          <Banner x={52} hue="wine" sigil="sun" />
          <Banner x={1548} hue="teal" sigil="key" />
        </svg>
      </div>

      <div className="fog fog-back" />

      <svg className="layer l-ground" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#3a2447" />
            <stop offset="1" stopColor="#170d22" />
          </linearGradient>
          <linearGradient id="awning-a" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#c23a46" />
            <stop offset="1" stopColor="#8d2431" />
          </linearGradient>
          <linearGradient id="awning-b" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#f6e6bd" />
            <stop offset="1" stopColor="#d9c08b" />
          </linearGradient>
        </defs>
        <rect y="796" width={W} height="204" fill="url(#ground)" />
        <path d={COBBLES[0]} fill="#2b1a36" />
        <path d={COBBLES[1]} fill="#463049" />
        <path d={COBBLES[2]} fill="#6a4a58" opacity="0.85" />
        <rect y="796" width={W} height="40" fill="#3a2447" opacity="0.5" />

        <g>
          <rect x="344" y="96" width="30" height="770" rx="6" fill="#3a2418" />
          <rect x="1226" y="96" width="30" height="770" rx="6" fill="#3a2418" />
          <path d="M344 96h30v20h-30zM1226 96h30v20h-30z" fill="#f2b544" opacity="0.8" />
          <path d="M344 116H436Q420 280 452 520Q392 566 344 548Z" fill="url(#cloth-wine)" stroke="#f2b544" strokeWidth="2.5" opacity="0.96" />
          <path d="M1256 116H1164Q1180 280 1148 520Q1208 566 1256 548Z" fill="url(#cloth-teal)" stroke="#f2b544" strokeWidth="2.5" opacity="0.96" />
          <path d="M370 130Q380 300 396 520M396 126Q404 300 424 506M1230 130Q1220 300 1204 520M1204 126Q1196 300 1176 506" fill="none" stroke="#000" strokeWidth="2" opacity="0.18" />
          <path d="M440 118V240M1160 118V240" stroke="#f2b544" strokeWidth="3" strokeDasharray="7 4" />
          <g stroke="#7d9a52" strokeWidth="3" fill="none" opacity="0.9">
            <path d="M470 124v40M490 124v54M510 124v34" />
            <path d="M474 164q-14 22 0 44M494 178q-14 20 0 40M514 158q12 20 -2 36" strokeWidth="5" stroke="#5e8a46" />
          </g>
          <g fill="#f2b544" stroke="#b8862b" strokeWidth="1.5">
            {Array.from({ length: 5 }, (_, k) => (
              <g key={k} transform={`translate(${1060 + k * 20} 126)`}>
                <line x1="0" y1="0" x2="0" y2="14" stroke="#2a1830" strokeWidth="1.5" />
                <circle cy="22" r="6" fill="none" strokeWidth="3" />
                <path d="M0 28v24M0 44h7M0 52h5" fill="none" strokeWidth="3" strokeLinecap="round" />
              </g>
            ))}
          </g>
        </g>

        <clipPath id="awning-clip">
          <path d={AWNING} />
        </clipPath>
        <g clipPath="url(#awning-clip)">
          <rect x="320" y="0" width="960" height="150" fill="url(#awning-b)" />
          {Array.from({ length: 8 }, (_, k) => (
            <rect key={k} x={320 + k * 120} y="0" width="60" height="150" fill="url(#awning-a)" />
          ))}
        </g>
        <path d="M320 0h960v8H320z" fill="#f2b544" />
        <path d="M320 112h960" stroke="#f2b544" strokeWidth="4" opacity="0.85" />

        <Torch x={352} i={0} />
        <Torch x={1248} i={1} />
      </svg>
    </div>
  )
})

/** The foreground: the counter in front of the characters, with its props. */
const Counter = memo(function Counter() {
  return (
    <svg className="counter" viewBox="0 0 1600 176" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="counter-top" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#a8703f" />
          <stop offset="1" stopColor="#7a4a28" />
        </linearGradient>
        <linearGradient id="counter-front" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5a3520" />
          <stop offset="1" stopColor="#2e1a10" />
        </linearGradient>
        <radialGradient id="coin" cx="0.35" cy="0.3">
          <stop offset="0" stopColor="#fff0a8" />
          <stop offset="0.6" stopColor="#f2b544" />
          <stop offset="1" stopColor="#b8862b" />
        </radialGradient>
      </defs>
      <rect x="0" y="0" width="1600" height="32" fill="url(#counter-top)" />
      <rect x="0" y="0" width="1600" height="5" fill="#d9a066" opacity="0.8" />
      <rect x="0" y="32" width="1600" height="144" fill="url(#counter-front)" />
      <rect x="0" y="32" width="1600" height="6" fill="#f2b544" opacity="0.7" />
      {Array.from({ length: 12 }, (_, k) => (
        <g key={k} transform={`translate(${70 + k * 132} 106)`} fill="none" stroke="#f2b544" strokeWidth="2.4" opacity="0.7">
          <path d="M-46 28v-44q46 -40 92 0v44z" />
          <path d="M0 -20l12 14l-12 14l-12 -14z" fill="#f2b544" opacity="0.35" />
          <path d="M-22 22h44" />
        </g>
      ))}
      {Array.from({ length: 40 }, (_, k) => (
        <circle key={k} cx={20 + k * 40} cy="46" r="3.2" fill="#f2b544" opacity="0.85" />
      ))}
      <g transform="translate(470 0)">
        <rect x="0" y="-58" width="84" height="58" fill="#8a5a3b" stroke="#1d0f12" strokeWidth="3" />
        <path d="M0 -39h84M0 -19h84M28 -58v58M56 -58v58" stroke="#3d2415" strokeWidth="3" />
        <path d="M0 -58l84 58M84 -58l-84 58" stroke="#5a3520" strokeWidth="2" opacity="0.6" />
        <rect x="14" y="-92" width="58" height="34" fill="#a87347" stroke="#1d0f12" strokeWidth="3" />
        <path d="M14 -75h58M43 -92v34" stroke="#3d2415" strokeWidth="3" />
      </g>
      <g transform="translate(1066 0)">
        <rect x="0" y="-48" width="76" height="48" fill="#8a5a3b" stroke="#1d0f12" strokeWidth="3" />
        <path d="M0 -32h76M0 -16h76M25 -48v48M50 -48v48" stroke="#3d2415" strokeWidth="3" />
        <ellipse cx="38" cy="-48" rx="30" ry="8" fill="url(#coin)" stroke="#8a5f1a" strokeWidth="1.5" />
        <ellipse cx="38" cy="-55" rx="26" ry="7" fill="url(#coin)" stroke="#8a5f1a" strokeWidth="1.5" />
        <ellipse cx="38" cy="-62" rx="22" ry="6" fill="url(#coin)" stroke="#8a5f1a" strokeWidth="1.5" />
      </g>
      <g transform="translate(150 6)">
        {[0, 1, 2, 3, 4].map((k) => (
          <ellipse key={k} cx="0" cy={-k * 7} rx="19" ry="6" fill="url(#coin)" stroke="#8a5f1a" strokeWidth="1.2" />
        ))}
        <ellipse cx="34" cy="-4" rx="19" ry="6" fill="url(#coin)" stroke="#8a5f1a" strokeWidth="1.2" />
        <ellipse cx="34" cy="-11" rx="19" ry="6" fill="url(#coin)" stroke="#8a5f1a" strokeWidth="1.2" />
      </g>
      <g transform="translate(1420 4)">
        <path d="M-26 0h52" stroke="#3a2418" strokeWidth="4" strokeLinecap="round" />
        <path d="M0 0v-46M-30 -46h60" stroke="#b8862b" strokeWidth="4" strokeLinecap="round" />
        <path d="M-30 -46l-14 26h28zM30 -46l-14 26h28z" fill="#e0a93a" stroke="#8a5f1a" strokeWidth="1.5" />
        <circle cy="-50" r="4" fill="#f2b544" />
      </g>
    </svg>
  )
})

/** Fog, light shafts and the vignette over everything painted so far; the characters sit under it. */
const Foreground = memo(function Foreground() {
  return (
    <div className="scene fore" aria-hidden="true">
      <div className="embers">
        {EMBERS.map((e, i) => (
          <i key={i} style={{ left: `${e.x}%`, width: `${e.size}cqw`, height: `${e.size}cqw`, animationDuration: `${e.dur}s`, animationDelay: `${e.delay}s`, ['--rise' as string]: `${-e.rise}cqw`, ['--drift' as string]: `${e.drift}cqw` }} />
        ))}
      </div>
      <div className="fog fog-front" />
      <div className="fog fog-low" />
      <div className="shafts" />
      <div className="pool pool-l flicker" />
      <div className="pool pool-r flicker" style={{ animationDelay: '-0.9s' }} />
      <div className="vignette" />
    </div>
  )
})

export { BackdropFar, Counter, Foreground }
