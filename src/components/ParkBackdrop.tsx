// Original artwork for this project: an autumn park in late-afternoon light.
// Decorative only; kept soft so the board stays the clearest thing on the page.

const TREES = [
  { x: 90, y: 470, s: 1.25, c: ['#c8792e', '#d9a23a', '#a9532a'] },
  { x: 260, y: 500, s: 0.9, c: ['#d9a23a', '#e4bb54', '#b8762c'] },
  { x: 420, y: 455, s: 1.1, c: ['#8f8a3c', '#b49a3e', '#c8792e'] },
  { x: 800, y: 460, s: 1.05, c: ['#a9532a', '#c8792e', '#d9a23a'] },
  { x: 960, y: 505, s: 0.85, c: ['#e4bb54', '#d9a23a', '#c8792e'] },
  { x: 1110, y: 465, s: 1.3, c: ['#c8792e', '#9c4a26', '#d9a23a'] },
];

const FALLEN = [
  [120, 690, 20, '#c8792e'],
  [340, 720, -35, '#d9a23a'],
  [520, 700, 60, '#a9532a'],
  [700, 735, 10, '#e4bb54'],
  [880, 705, -50, '#c8792e'],
  [1050, 740, 30, '#b8762c'],
  [230, 760, 75, '#d9a23a'],
  [960, 770, -15, '#a9532a'],
] as const;

const LEAF_PATH = 'M0 -9 C6 -6 7 2 0 9 C-7 2 -6 -6 0 -9 Z';

export default function ParkBackdrop() {
  return (
    <div className="backdrop" aria-hidden="true">
      <svg className="backdrop-scene" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMax slice">
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#c9d3cf" />
            <stop offset="0.55" stopColor="#efd9b0" />
            <stop offset="1" stopColor="#f2c98f" />
          </linearGradient>
          <radialGradient id="sun" cx="0.78" cy="0.42" r="0.45">
            <stop offset="0" stopColor="#fff2cf" stopOpacity="0.9" />
            <stop offset="1" stopColor="#fff2cf" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="grass" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#8d9a5c" />
            <stop offset="1" stopColor="#6b7a45" />
          </linearGradient>
        </defs>

        <rect width="1200" height="800" fill="url(#sky)" />
        <rect width="1200" height="800" fill="url(#sun)" />

        <path d="M0 470 C200 420 380 450 600 430 C820 410 1000 440 1200 420 V800 H0 Z" fill="#a7ab78" opacity="0.7" />
        <path d="M0 540 C240 500 420 530 640 515 C860 500 1020 520 1200 505 V800 H0 Z" fill="url(#grass)" />
        <path d="M520 800 C560 700 620 620 700 540 L760 540 C720 620 700 700 720 800 Z" fill="#d8c29a" opacity="0.75" />

        {TREES.map((t, i) => (
          <g key={i} transform={`translate(${t.x} ${t.y}) scale(${t.s})`}>
            <path d="M-7 70 L-4 -10 L4 -10 L7 70 Z" fill="#5b3a24" />
            <path d="M-2 10 L-26 -22 M2 0 L24 -30" stroke="#5b3a24" strokeWidth="4" strokeLinecap="round" />
            <circle cx="-28" cy="-40" r="38" fill={t.c[0]} />
            <circle cx="26" cy="-48" r="42" fill={t.c[1]} />
            <circle cx="0" cy="-82" r="44" fill={t.c[2]} />
            <circle cx="-8" cy="-30" r="30" fill={t.c[1]} opacity="0.85" />
          </g>
        ))}

        {FALLEN.map(([x, y, r, c], i) => (
          <path key={i} d={LEAF_PATH} transform={`translate(${x} ${y}) rotate(${r})`} fill={c} opacity="0.9" />
        ))}
      </svg>

      <div className="falling-leaves">
        {[0, 1, 2, 3, 4].map((i) => (
          <svg key={i} className={`falling-leaf falling-leaf-${i}`} viewBox="-10 -10 20 20">
            <path d={LEAF_PATH} fill={['#c8792e', '#d9a23a', '#a9532a', '#e4bb54', '#b8762c'][i]} />
          </svg>
        ))}
      </div>
    </div>
  );
}
