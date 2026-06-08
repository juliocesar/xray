# frozen_string_literal: true

# Vendored xray helper. `Xray.emit(event, data)` posts a labeled event
# to a local xray relay so you can drain a scenario from the inside.
#
# Dev-only and safe by construction: no-ops unless enabled, never blocks the caller
# (sends on a background thread with short timeouts), and swallows every error.
#
# Config: XRAY_URL, XRAY_SOURCE, XRAY_ENABLED, XRAY_TRACE.
require 'net/http'
require 'json'
require 'time'
require 'uri'

module Xray
  DEFAULT_URL = '{{XRAY_URL}}'
  TRUTHY = %w[1 true yes on].freeze

  class << self
    def emit(event, data = {})
      return unless enabled?

      payload = {
        event: event,
        source: source,
        data: data,
        trace: env('XRAY_TRACE'),
        ts: Time.now.utc.iso8601(3),
      }.compact
      Thread.new { post(payload) }
      nil
    rescue StandardError
      nil
    end

    private

    def enabled?
      flag = env('XRAY_ENABLED')
      return TRUTHY.include?(flag.downcase) unless flag.nil?

      !env('XRAY_URL').nil?
    end

    def url
      (env('XRAY_URL') || DEFAULT_URL).sub(%r{/+\z}, '')
    end

    def source
      env('XRAY_SOURCE') || 'ruby'
    end

    def env(name)
      value = ENV[name]
      value.nil? || value.empty? ? nil : value
    end

    def post(payload)
      uri = URI("#{url}/events")
      http = Net::HTTP.new(uri.host, uri.port)
      http.use_ssl = uri.scheme == 'https'
      http.open_timeout = 1
      http.read_timeout = 1
      request = Net::HTTP::Post.new(uri.request_uri, 'Content-Type' => 'application/json')
      request.body = JSON.generate(payload)
      http.request(request)
    rescue StandardError
      nil
    end
  end
end
