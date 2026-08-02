import { useEffect, useRef, useState } from 'react'
import { BrowserCodeReader, BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser'
import { BarcodeFormat, DecodeHintType } from '@zxing/library'

// Webcam scanning for the attendance desk, for staff who have no barcode gun
// yet. It feeds the exact same card number a USB scanner would type, so the
// attendance flow behind it is unchanged.
//
// Only the two formats a student card can carry are enabled. Narrowing the
// list keeps the decoder from spending frames on EAN/UPC/PDF417 variants it
// will never see, which measurably helps on a low-end webcam.
//
// ASSUME_CODE_39_CHECK_DIGIT is deliberately left off: our cards carry a bare
// Code 39 payload with no mod-43 check digit, and turning that hint on would
// make every student card fail to decode.
const HINTS = new Map<DecodeHintType, unknown>([
  [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_39, BarcodeFormat.QR_CODE]],
  [DecodeHintType.TRY_HARDER, true],
])

// A camera decodes the same card many times a second. Ignore a repeat of the
// same code inside this window so one card held up to the lens produces one
// sign-in, not a burst of them. The window is measured from the *last* sighting
// rather than the first, so a card left lying in front of the lens stays
// suppressed instead of re-firing every few seconds; it reopens once the card
// has actually been out of frame this long.
const REPEAT_WINDOW_MS = 4000

function cameraErrorMessage(err: unknown): string {
  const name = (err as { name?: string })?.name ?? ''
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return 'Camera permission was denied. Allow camera access for this site in your browser, then start the camera again.'
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'No camera was found on this device.'
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'The camera is already in use by another program. Close it (video call, another tab) and try again.'
  }
  return (err as Error)?.message ?? 'The camera could not be started.'
}

// Mounted only while the camera is wanted: unmounting is what releases the
// stream (see the effect cleanup), so the webcam light never stays on after
// the operator stops scanning.
export function BarcodeCamera({
  onDetected,
  onStop,
}: {
  onDetected: (code: string) => void
  onStop: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const lastHitRef = useRef<{ code: string; at: number }>({ code: '', at: 0 })
  // Held in a ref so a re-render of the parent never restarts the camera —
  // tearing the stream down mid-queue would drop scans.
  const onDetectedRef = useRef(onDetected)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState('')
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    onDetectedRef.current = onDetected
  })

  useEffect(() => {
    // getUserMedia only exists in a secure context. A kiosk opened over plain
    // http on a LAN address hits this, and the raw failure is unhelpful.
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        'This browser will not open a camera over an insecure connection. Use the https:// address of the app (or localhost on this machine).'
      )
      return
    }

    let cancelled = false
    const reader = new BrowserMultiFormatReader(HINTS, {
      delayBetweenScanAttempts: 100,
      delayBetweenScanSuccess: 400,
    })

    setStarting(true)
    setError(null)

    reader
      .decodeFromConstraints(
        {
          video: {
            ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'environment' }),
            // A 1D barcode needs real pixels across the bars to decode. The
            // browser default (often 640x480) struggles with a printed card at
            // arm's length; asking for 720p makes it usable.
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        },
        videoRef.current ?? undefined,
        (result, _err, controls) => {
          if (cancelled) {
            controls.stop()
            return
          }
          if (!result) return // no barcode in this frame — normal, keep scanning

          const text = result.getText().trim().toUpperCase()
          const now = Date.now()
          const isRepeat = text === lastHitRef.current.code && now - lastHitRef.current.at < REPEAT_WINDOW_MS
          lastHitRef.current = { code: text, at: now }
          if (isRepeat) return
          onDetectedRef.current(text)
        }
      )
      .then((controls) => {
        if (cancelled) {
          controls.stop()
          return
        }
        controlsRef.current = controls
        setStarting(false)
        // Device labels are blank until permission is granted, so the picker is
        // only worth building once the stream is actually live.
        BrowserCodeReader.listVideoInputDevices()
          .then((found) => !cancelled && setDevices(found))
          .catch(() => undefined)
      })
      .catch((err) => {
        if (cancelled) return
        setStarting(false)
        setError(cameraErrorMessage(err))
      })

    return () => {
      cancelled = true
      controlsRef.current?.stop()
      controlsRef.current = null
    }
  }, [deviceId])

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5 dark:border-slate-700/60">
        <p className="inline-flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${
              starting ? 'bg-amber-400 motion-safe:animate-pulse' : 'bg-green-500'
            }`}
          />
          {starting ? 'Starting camera…' : 'Camera ready — hold the card up to the lens'}
        </p>
        <div className="flex items-center gap-2">
          {devices.length > 1 && (
            <select
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              aria-label="Camera"
              className="max-w-[190px] rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-600 transition-colors hover:border-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:border-slate-600 dark:bg-slate-900 dark:text-cream-50"
            >
              <option value="">Default camera</option>
              {devices.map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Camera ${i + 1}`}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={onStop}
            className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            Stop camera
          </button>
        </div>
      </div>

      {error ? (
        <p className="px-4 py-6 text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : (
        <div className="relative bg-slate-900">
          <video
            ref={videoRef}
            muted
            playsInline
            className="mx-auto block max-h-[320px] w-full object-contain"
          />
          {/* Aiming guide — a printed card decodes far more reliably when it
              fills the frame rather than sitting somewhere in it. */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-1/2 w-4/5 rounded-lg border-2 border-white/70 shadow-[0_0_0_9999px_rgba(15,23,42,0.35)]" />
          </div>
        </div>
      )}
    </div>
  )
}
