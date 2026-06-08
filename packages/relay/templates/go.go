// Package xray is a vendored helper. xray.Emit(event, data) posts a
// labeled event to a local xray relay so you can drain a scenario from the inside.
//
// Dev-only and safe by construction: no-ops unless enabled, never blocks the
// caller (sends in a goroutine with a short timeout), and swallows every error.
//
// Place this file in a package named "xray" (e.g. internal/xray/xray.go).
// Config: XRAY_URL, XRAY_SOURCE, XRAY_ENABLED, XRAY_TRACE.
package xray

import (
	"bytes"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"time"
)

const defaultURL = "{{XRAY_URL}}"

var truthy = map[string]bool{"1": true, "true": true, "yes": true, "on": true}

func enabled() bool {
	if flag, ok := os.LookupEnv("XRAY_ENABLED"); ok && flag != "" {
		return truthy[strings.ToLower(flag)]
	}
	return os.Getenv("XRAY_URL") != ""
}

func url() string {
	if u := os.Getenv("XRAY_URL"); u != "" {
		return strings.TrimRight(u, "/")
	}
	return strings.TrimRight(defaultURL, "/")
}

func source() string {
	if s := os.Getenv("XRAY_SOURCE"); s != "" {
		return s
	}
	return "go"
}

// Emit fires a labeled event at the relay. Safe to call from anywhere.
func Emit(event string, data any) {
	if !enabled() {
		return
	}
	payload := map[string]any{
		"event":  event,
		"source": source(),
		"ts":     time.Now().UTC().Format(time.RFC3339Nano),
	}
	if data != nil {
		payload["data"] = data
	}
	if trace := os.Getenv("XRAY_TRACE"); trace != "" {
		payload["trace"] = trace
	}
	go func() {
		defer func() { _ = recover() }()
		body, err := json.Marshal(payload)
		if err != nil {
			return
		}
		client := &http.Client{Timeout: time.Second}
		resp, err := client.Post(url()+"/events", "application/json", bytes.NewReader(body))
		if err == nil {
			_ = resp.Body.Close()
		}
	}()
}
