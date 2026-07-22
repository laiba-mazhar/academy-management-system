// Printing print-area content in place (via window.print() + CSS visibility
// tricks) is unreliable in Chromium once there's enough *hidden* sibling
// content on the page — it can still reserve blank pages for content that's
// invisible but tall, even with `overflow: hidden` collapsing its ancestor.
// Printing from a throwaway iframe containing only the target element (and a
// clone of the app's stylesheets) sidesteps that entirely: there's nothing
// else in that document to mispaginate around.
export function printElement(element: HTMLElement | null) {
  if (!element) return

  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
  document.body.appendChild(iframe)

  const doc = iframe.contentDocument
  const win = iframe.contentWindow
  if (!doc || !win) {
    iframe.remove()
    return
  }

  const headHtml = [...document.querySelectorAll('link[rel="stylesheet"], style')].map((el) => el.outerHTML).join('')

  doc.open()
  doc.write(`<!DOCTYPE html><html><head>${headHtml}</head><body>${element.outerHTML}</body></html>`)
  doc.close()

  function cleanup() {
    setTimeout(() => iframe.remove(), 500)
  }

  function go() {
    win!.focus()
    win!.print()
    cleanup()
  }

  const linkEls = [...doc.querySelectorAll('link[rel="stylesheet"]')] as HTMLLinkElement[]
  const pending = linkEls.filter((l) => !l.sheet)
  if (pending.length === 0) {
    // Dev mode inlines styles as <style> tags (no network fetch to wait on);
    // still defer a tick so the iframe has finished laying out.
    setTimeout(go, 50)
    return
  }
  let remaining = pending.length
  function onSettle() {
    remaining--
    if (remaining === 0) go()
  }
  for (const link of pending) {
    link.addEventListener('load', onSettle, { once: true })
    link.addEventListener('error', onSettle, { once: true })
  }
}
