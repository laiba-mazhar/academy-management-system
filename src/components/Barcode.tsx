// Code 39 barcode, drawn as plain SVG.
//
// Code 39 (rather than a 2D format) because every cheap USB/Bluetooth barcode
// scanner reads it out of the box in keyboard-wedge mode, and it needs no
// checksum or encoding library — each character is a fixed 9-element pattern of
// alternating bars and spaces, 3 of which are wide. Drawing it ourselves keeps
// the app dependency-free and gives crisp vector output when a card is printed.

// 'w' = wide element, 'n' = narrow. Elements alternate bar, space, bar, ...
// starting with a bar (5 bars + 4 spaces per character).
const PATTERNS: Record<string, string> = {
  '0': 'nnnwwnwnn',
  '1': 'wnnwnnnnw',
  '2': 'nnwwnnnnw',
  '3': 'wnwwnnnnn',
  '4': 'nnnwwnnnw',
  '5': 'wnnwwnnnn',
  '6': 'nnwwwnnnn',
  '7': 'nnnwnnwnw',
  '8': 'wnnwnnwnn',
  '9': 'nnwwnnwnn',
  A: 'wnnnnwnnw',
  B: 'nnwnnwnnw',
  C: 'wnwnnwnnn',
  D: 'nnnnwwnnw',
  E: 'wnnnwwnnn',
  F: 'nnwnwwnnn',
  G: 'nnnnnwwnw',
  H: 'wnnnnwwnn',
  I: 'nnwnnwwnn',
  J: 'nnnnwwwnn',
  K: 'wnnnnnnww',
  L: 'nnwnnnnww',
  M: 'wnwnnnnwn',
  N: 'nnnnwnnww',
  O: 'wnnnwnnwn',
  P: 'nnwnwnnwn',
  Q: 'nnnnnnwww',
  R: 'wnnnnnwwn',
  S: 'nnwnnnwwn',
  T: 'nnnnwnwwn',
  U: 'wwnnnnnnw',
  V: 'nwwnnnnnw',
  W: 'wwwnnnnnn',
  X: 'nwnnwnnnw',
  Y: 'wwnnwnnnn',
  Z: 'nwwnwnnnn',
  '-': 'nwnnnnwnw',
  '.': 'wwnnnnwnn',
  ' ': 'nwwnnnwnn',
  $: 'nwnwnwnnn',
  '/': 'nwnwnnnwn',
  '+': 'nwnnnwnwn',
  '%': 'nnnwnwnwn',
  '*': 'nwnnwnwnn', // start/stop delimiter, never part of the payload
}

const NARROW = 1
const WIDE = 3
const QUIET_ZONE = 10 // narrow units of blank margin each side, per the spec

function sanitizeBarcodeValue(value: string): string {
  return value
    .toUpperCase()
    .split('')
    .filter((ch) => ch !== '*' && PATTERNS[ch] !== undefined)
    .join('')
}

interface Bar {
  x: number
  width: number
}

// Returns the black bars (in narrow-width units) plus the total width, so the
// caller can drive an SVG viewBox and let the browser scale it to any size
// without ever losing the 3:1 wide-to-narrow ratio the scanner looks for.
function buildBars(value: string): { bars: Bar[]; totalUnits: number } {
  const chars = `*${value}*`.split('')
  const bars: Bar[] = []
  let x = QUIET_ZONE

  for (let c = 0; c < chars.length; c++) {
    const pattern = PATTERNS[chars[c]]
    for (let i = 0; i < pattern.length; i++) {
      const width = pattern[i] === 'w' ? WIDE : NARROW
      if (i % 2 === 0) bars.push({ x, width }) // even index = bar, odd = space
      x += width
    }
    if (c < chars.length - 1) x += NARROW // inter-character gap
  }

  return { bars, totalUnits: x + QUIET_ZONE }
}

export function Barcode({
  value,
  height = 44,
  showText = true,
  className = '',
}: {
  value: string
  height?: number
  showText?: boolean
  className?: string
}) {
  const clean = sanitizeBarcodeValue(value)
  if (!clean) return null

  const { bars, totalUnits } = buildBars(clean)

  return (
    <div className={className}>
      {/* preserveAspectRatio="none" is safe here: every bar scales by the same
          horizontal factor, so the wide/narrow ratio the scanner decodes is
          preserved no matter how wide the card ends up. */}
      <svg
        viewBox={`0 0 ${totalUnits} 100`}
        preserveAspectRatio="none"
        width="100%"
        height={height}
        role="img"
        aria-label={`Barcode ${clean}`}
        style={{ display: 'block' }}
      >
        <rect x="0" y="0" width={totalUnits} height="100" fill="#ffffff" />
        {bars.map((bar, i) => (
          <rect key={i} x={bar.x} y="0" width={bar.width} height="100" fill="#000000" />
        ))}
      </svg>
      {showText && (
        <p className="mt-1 text-center font-mono text-[11px] font-semibold tracking-[0.25em] text-black">{clean}</p>
      )}
    </div>
  )
}
