/**
 * xray browser client (Tier 0) — served by the relay at /xray.js with its own
 * origin baked into __XRAY_URL__. Zero install: drop in a <script> tag and call
 * window.xray(event, data).
 *
 * Transport: navigator.sendBeacon with a text/plain body — a CORS "simple
 * request", so there is no preflight, and it survives page unload. Falls back to
 * fetch(keepalive). source/trace travel in the body, never in custom headers
 * (custom headers would force a preflight). Never throws; no-ops when disabled.
 *
 * Config (all optional):
 *   window.__XRAY_URL__      override relay URL    (or data-xray-url on the tag)
 *   window.__XRAY_SOURCE__   label for this page   (or data-xray-source; default "web")
 *   window.__XRAY_TRACE__    correlation id to stitch one action across processes
 *   window.__XRAY_ENABLED__  set to false to hard-disable
 */
;(function () {
  'use strict'
  var BAKED_URL = '{{XRAY_URL}}'
  var script = typeof document !== 'undefined' ? document.currentScript : null

  function attr(name) {
    return script && script.getAttribute ? script.getAttribute(name) : null
  }
  function win(name) {
    return typeof window !== 'undefined' ? window[name] : undefined
  }

  var URL_BASE = String(win('__XRAY_URL__') || attr('data-xray-url') || BAKED_URL).replace(
    /\/+$/,
    '',
  )
  var SOURCE = String(win('__XRAY_SOURCE__') || attr('data-xray-source') || 'web')

  function xray(event, data) {
    try {
      if (win('__XRAY_ENABLED__') === false) return
      var body = JSON.stringify({
        event: event,
        source: SOURCE,
        data: data,
        trace: win('__XRAY_TRACE__'),
        ts: new Date().toISOString(),
      })
      var endpoint = URL_BASE + '/events'
      if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
        if (navigator.sendBeacon(endpoint, new Blob([body], { type: 'text/plain' }))) return
      }
      if (typeof fetch === 'function') {
        fetch(endpoint, {
          method: 'POST',
          body: body,
          headers: { 'Content-Type': 'text/plain' },
          keepalive: true,
          mode: 'cors',
        }).catch(function () {})
      }
    } catch (e) {
      // An instrumentation call must never break the page.
    }
  }

  if (typeof window !== 'undefined') window.xray = xray
})()
