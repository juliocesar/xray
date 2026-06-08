"""Vendored xray helper.

``xray(event, data)`` posts a labeled event to a local xray relay so you can drain
a scenario from the inside.

Dev-only and safe by construction: no-ops unless enabled, never blocks the caller
(sends on a daemon thread with a short timeout), and swallows every error.

Config: XRAY_URL, XRAY_SOURCE, XRAY_ENABLED, XRAY_TRACE.
"""

import json
import os
import threading
import urllib.request
from datetime import datetime, timezone

_DEFAULT_URL = "{{XRAY_URL}}"
_TRUTHY = {"1", "true", "yes", "on"}


def _enabled():
    flag = os.environ.get("XRAY_ENABLED")
    if flag:
        return flag.lower() in _TRUTHY
    return bool(os.environ.get("XRAY_URL"))


def _url():
    return (os.environ.get("XRAY_URL") or _DEFAULT_URL).rstrip("/")


def _source():
    return os.environ.get("XRAY_SOURCE") or "python"


def _post(payload):
    try:
        request = urllib.request.Request(
            _url() + "/events",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        urllib.request.urlopen(request, timeout=1).close()
    except Exception:
        pass


def xray(event, data=None, trace=None):
    """Fire a labeled event at the relay. No-ops when disabled; never raises."""
    try:
        if not _enabled():
            return
        payload = {
            "event": event,
            "source": _source(),
            "ts": datetime.now(timezone.utc).isoformat(),
        }
        if data is not None:
            payload["data"] = data
        trace = trace or os.environ.get("XRAY_TRACE")
        if trace:
            payload["trace"] = trace
        threading.Thread(target=_post, args=(payload,), daemon=True).start()
    except Exception:
        pass
