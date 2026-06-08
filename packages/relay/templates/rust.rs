//! Vendored xray helper. `xray(event, data)` posts a labeled event to
//! a local xray relay so you can drain a scenario from the inside.
//!
//! Dev-only and safe by construction: no-ops unless enabled, never blocks the
//! caller (sends on a thread with a write timeout), and swallows every error.
//!
//! Dependency-free: writes a minimal HTTP/1.1 POST over a raw TCP socket, so it
//! targets the plain-http loopback relay (no HTTPS). `data` is a pre-serialized
//! JSON string (pass `"null"` or `""` for none).
//!
//! Config: XRAY_URL, XRAY_SOURCE, XRAY_ENABLED, XRAY_TRACE.

use std::env;
use std::io::Write;
use std::net::TcpStream;
use std::thread;
use std::time::Duration;

const DEFAULT_URL: &str = "{{XRAY_URL}}";

fn enabled() -> bool {
    match env::var("XRAY_ENABLED") {
        Ok(flag) if !flag.is_empty() => {
            matches!(flag.to_lowercase().as_str(), "1" | "true" | "yes" | "on")
        }
        _ => env::var("XRAY_URL").map(|u| !u.is_empty()).unwrap_or(false),
    }
}

fn url() -> String {
    env::var("XRAY_URL")
        .ok()
        .filter(|u| !u.is_empty())
        .unwrap_or_else(|| DEFAULT_URL.to_string())
}

fn source() -> String {
    env::var("XRAY_SOURCE")
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "rust".to_string())
}

/// Fire a labeled event at the relay. No-ops when disabled; never panics.
pub fn xray(event: &str, data: &str) {
    if !enabled() {
        return;
    }
    let event = event.to_string();
    let data = if data.is_empty() { "null".to_string() } else { data.to_string() };
    let source = source();
    let url = url();
    let trace = env::var("XRAY_TRACE").unwrap_or_default();
    thread::spawn(move || {
        let _ = send(&url, &event, &source, &data, &trace);
    });
}

fn send(url: &str, event: &str, source: &str, data: &str, trace: &str) -> std::io::Result<()> {
    let rest = url.trim_end_matches('/').strip_prefix("http://").unwrap_or(url);
    let (host, port) = match rest.split_once(':') {
        Some((h, p)) => (h.to_string(), p.parse::<u16>().unwrap_or(7200)),
        None => (rest.to_string(), 7200),
    };
    let trace_field = if trace.is_empty() {
        String::new()
    } else {
        format!(",\"trace\":{}", json_str(trace))
    };
    let body = format!(
        "{{\"event\":{},\"source\":{},\"data\":{}{}}}",
        json_str(event),
        json_str(source),
        data,
        trace_field
    );
    let mut stream = TcpStream::connect((host.as_str(), port))?;
    stream.set_write_timeout(Some(Duration::from_secs(1)))?;
    let request = format!(
        "POST /events HTTP/1.1\r\nHost: {host}:{port}\r\nContent-Type: text/plain\r\n\
Content-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    stream.write_all(request.as_bytes())?;
    Ok(())
}

fn json_str(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    for c in value.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}
