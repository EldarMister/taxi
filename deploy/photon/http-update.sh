#!/bin/bash
# Shared verbatim with Photon, whose standalone build context cannot COPY ../.
# Do not persist validators until the candidate graph/index has passed activation.
http_fetch_candidate() {
  local url="$1" output="$2" accepted="$3" candidate="$4" headers code etag modified
  local -a conditions=()
  headers="${candidate}.headers"
  if [ -f "${accepted}.url" ] && [ "$(cat "${accepted}.url")" = "$url" ]; then
    if [ -s "${accepted}.etag" ]; then conditions+=(-H "If-None-Match: $(cat "${accepted}.etag")"); fi
    if [ -s "${accepted}.modified" ]; then conditions+=(-H "If-Modified-Since: $(cat "${accepted}.modified")"); fi
  fi
  code="$(curl --fail --location --retry 3 --connect-timeout 15 --max-time 900 \
    --proto '=https' --proto-redir '=https' "${conditions[@]}" --dump-header "$headers" \
    --output "$output" --write-out '%{http_code}' "$url")" || return 1
  case "$code" in
    304) [ "${#conditions[@]}" -gt 0 ] || return 1; rm -f "$output" "$headers"; return 3 ;;
    200) [ -s "$output" ] || return 1 ;;
    *) rm -f "$output" "$headers"; return 1 ;;
  esac
  # Ignore proxy/redirect headers; validators belong to the final HTTP response.
  etag="$(awk 'BEGIN{IGNORECASE=1} /^HTTP\//{value=""} tolower($0) ~ /^etag:/{sub(/^[^:]*:[ \t]*/,""); sub(/\r$/,""); value=$0} END{print value}' "$headers")"
  modified="$(awk 'BEGIN{IGNORECASE=1} /^HTTP\//{value=""} tolower($0) ~ /^last-modified:/{sub(/^[^:]*:[ \t]*/,""); sub(/\r$/,""); value=$0} END{print value}' "$headers")"
  printf '%s' "$url" > "${candidate}.url"
  printf '%s' "$etag" > "${candidate}.etag"
  printf '%s' "$modified" > "${candidate}.modified"
  rm -f "$headers"
}

http_accept_candidate() {
  local candidate="$1" accepted="$2" field
  for field in url etag modified; do
    if [ -f "${candidate}.${field}" ]; then
      cp "${candidate}.${field}" "${accepted}.${field}.next" || return 1
      mv -f "${accepted}.${field}.next" "${accepted}.${field}" || return 1
    fi
  done
  date -u +%FT%TZ > "${accepted}.checked"
}

http_mark_checked() { date -u +%FT%TZ > "${1}.checked"; }
