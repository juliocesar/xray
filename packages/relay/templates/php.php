<?php

// Vendored xray helper. xray($event, $data) posts a labeled event to
// a local xray relay so you can drain a scenario from the inside.
//
// Dev-only and safe by construction: no-ops unless enabled, short timeout, and
// swallows every error. Uses the curl extension when present, else a stream
// context. Config: XRAY_URL, XRAY_SOURCE, XRAY_ENABLED, XRAY_TRACE.

if (!function_exists('xray')) {
    function xray(string $event, $data = null): void
    {
        try {
            $flag = getenv('XRAY_ENABLED');
            if ($flag !== false && $flag !== '') {
                if (!in_array(strtolower($flag), ['1', 'true', 'yes', 'on'], true)) {
                    return;
                }
            } elseif (getenv('XRAY_URL') === false || getenv('XRAY_URL') === '') {
                return;
            }

            $base = getenv('XRAY_URL');
            $base = ($base === false || $base === '') ? '{{XRAY_URL}}' : $base;
            $url = rtrim($base, '/') . '/events';

            $source = getenv('XRAY_SOURCE');
            $payload = [
                'event' => $event,
                'source' => ($source === false || $source === '') ? 'php' : $source,
                'ts' => gmdate('Y-m-d\TH:i:s\Z'),
            ];
            if ($data !== null) {
                $payload['data'] = $data;
            }
            $trace = getenv('XRAY_TRACE');
            if ($trace !== false && $trace !== '') {
                $payload['trace'] = $trace;
            }
            $body = json_encode($payload);

            if (function_exists('curl_init')) {
                $ch = curl_init($url);
                curl_setopt_array($ch, [
                    CURLOPT_POST => true,
                    CURLOPT_POSTFIELDS => $body,
                    CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
                    CURLOPT_CONNECTTIMEOUT => 1,
                    CURLOPT_TIMEOUT => 1,
                    CURLOPT_RETURNTRANSFER => true,
                ]);
                curl_exec($ch);
                curl_close($ch);
            } else {
                $context = stream_context_create(['http' => [
                    'method' => 'POST',
                    'header' => "Content-Type: application/json\r\n",
                    'content' => $body,
                    'timeout' => 1,
                ]]);
                @file_get_contents($url, false, $context);
            }
        } catch (\Throwable $e) {
            // An instrumentation call must never affect the host program.
        }
    }
}
