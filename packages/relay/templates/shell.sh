# Vendored xray helper. Source this file, then:
#   xray <event> [json-data]      e.g.  xray deploy.started '{"sha":"abc"}'
#
# Posts a labeled event to a local xray relay so you can drain a scenario from the
# inside. Dev-only and safe by construction: no-ops unless enabled, never blocks
# (async curl, backgrounded), and is fully silenced.
#
# Config: XRAY_URL, XRAY_SOURCE, XRAY_ENABLED, XRAY_TRACE.
xray() {
  case "${XRAY_ENABLED:-}" in
    1 | true | yes | on | TRUE | YES | ON) ;;
    "") [ -n "${XRAY_URL:-}" ] || return 0 ;;
    *) return 0 ;;
  esac

  _xray_url="${XRAY_URL:-{{XRAY_URL}}}"
  _xray_url="${_xray_url%/}"
  _xray_event="$1"
  _xray_data="${2:-null}"
  _xray_source="${XRAY_SOURCE:-shell}"
  _xray_ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  _xray_trace=""
  [ -n "${XRAY_TRACE:-}" ] && _xray_trace=",\"trace\":\"${XRAY_TRACE}\""

  _xray_body="{\"event\":\"${_xray_event}\",\"source\":\"${_xray_source}\",\"data\":${_xray_data},\"ts\":\"${_xray_ts}\"${_xray_trace}}"

  curl -s --max-time 1 -X POST "${_xray_url}/events" \
    -H 'Content-Type: application/json' -d "${_xray_body}" >/dev/null 2>&1 &
}
