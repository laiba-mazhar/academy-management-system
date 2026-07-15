// Categorical/sequential/status palette, tied to the maroon/cream/gold brand
// (see tailwind.config.js brand/cream/gold scales). Fixed order; never cycle
// or reassign per filter. Hues are kept far enough apart to stay
// distinguishable even though they're pulled toward the warm brand family.
export const CATEGORICAL = [
  '#932e3e', // maroon (brand-500)
  '#c99a3a', // gold (gold-500)
  '#2f6e6a', // deep teal
  '#c4622d', // burnt orange
  '#3c4a7a', // indigo
  '#57762b', // olive green
  '#8a4a6b', // plum
  '#45586b', // slate blue
]

export const SEQUENTIAL_BLUE = '#932e3e'

export const STATUS = {
  good: '#3f7d3a',
  warning: '#c99a3a',
  serious: '#c4622d',
  critical: '#a3283a',
}

export const CHART_INK = {
  primary: '#241713',
  secondary: '#5c4a42',
  muted: '#8f7d73',
  gridline: '#e8ddd0',
  baseline: '#d3c2ac',
}
