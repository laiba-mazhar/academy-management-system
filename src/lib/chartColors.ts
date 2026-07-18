// Categorical/sequential/status palette, tied to the maroon/cream/gold brand
// (see tailwind.config.js brand/cream/gold scales) but lightened to a soft
// pastel register for the dashboard charts. Fixed order; never cycle or
// reassign per filter. Hues are kept far enough apart to stay distinguishable
// even at this lighter saturation.
export const CATEGORICAL = [
  '#d9909a', // pastel maroon (brand-200/300 family)
  '#e3c17a', // pastel gold
  '#8fc3bd', // pastel teal
  '#e3a97c', // pastel burnt orange
  '#9aa3c9', // pastel indigo
  '#a8c48a', // pastel olive
  '#c497b0', // pastel plum
  '#9db0c2', // pastel slate blue
]

export const SEQUENTIAL_BLUE = '#d9909a'

export const STATUS = {
  good: '#8bbf7a',
  warning: '#e3c17a',
  serious: '#e3a97c',
  critical: '#d9909a',
}

export const CHART_INK = {
  primary: '#241713',
  secondary: '#5c4a42',
  muted: '#8f7d73',
  gridline: '#e8ddd0',
  baseline: '#d3c2ac',
}

// Recharts' <Tooltip> renders a plain div with inline styles, so it can't see
// Tailwind's dark: classes — these reference CSS variables (defined in
// index.css, redefined under .dark) so the tooltip still follows the theme.
// Spread onto every <Tooltip> alongside its own `formatter`.
export const TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: 'var(--tooltip-bg)',
    border: '1px solid var(--tooltip-border)',
    borderRadius: 8,
    fontSize: 13,
  },
  labelStyle: { color: 'var(--tooltip-text)', fontWeight: 600 },
  itemStyle: { color: 'var(--tooltip-text)' },
}

// Pass to <Tooltip cursor={TOOLTIP_CURSOR} /> inside a BarChart so the
// hover-highlight rectangle behind the bars also follows the theme instead of
// Recharts' default flat gray. Unlike TOOLTIP_STYLE above, this `fill` is
// spread onto an SVG <rect> as a plain attribute (not a `style` prop) —
// evergreen browsers resolve var() there too, but it's a different mechanism.
export const TOOLTIP_CURSOR = { fill: 'var(--tooltip-cursor)' }
