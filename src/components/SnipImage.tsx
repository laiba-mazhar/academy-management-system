import type { Crop, SourceBookPage } from '@/types/database'

// Shows one snipped region of a scanned page, at a given rendered width.
//
// The crop is applied by positioning the whole page as a background rather than
// by cutting the image up: the stored page stays a single file, one snip can be
// re-cropped without re-uploading, and several snips of the same page share one
// download.
export function SnipImage({
  page,
  crop,
  url,
  width,
  className = '',
}: {
  page: Pick<SourceBookPage, 'width' | 'height'>
  crop: Crop
  url: string | undefined
  /** Rendered width of the visible region, in CSS pixels or any CSS length. */
  width: number
  className?: string
}) {
  // The page's aspect decides how tall the crop is once its width is fixed.
  const pageAspect = page.height / page.width
  const height = (width * crop.h * pageAspect) / crop.w
  const fullWidth = width / crop.w

  if (!url) {
    return (
      <div
        className={`flex items-center justify-center rounded border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-500 ${className}`}
        style={{ width, height }}
      >
        Loading page…
      </div>
    )
  }

  return (
    <div
      role="img"
      aria-label="Question snipped from a book page"
      className={className}
      style={{
        width,
        height,
        backgroundImage: `url("${url}")`,
        backgroundSize: `${fullWidth}px ${fullWidth * pageAspect}px`,
        backgroundPosition: `-${fullWidth * crop.x}px -${fullWidth * pageAspect * crop.y}px`,
        backgroundRepeat: 'no-repeat',
      }}
    />
  )
}
