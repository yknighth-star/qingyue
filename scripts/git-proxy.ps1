# One-shot Git via local HTTP proxy (does NOT write git config or permanent env).
# Default: 127.0.0.1:7897 — override with -Proxy or $env:QINGYUE_GIT_PROXY.
#
# Examples:
#   powershell -File scripts/git-proxy.ps1 push
#   powershell -File scripts/git-proxy.ps1 pull
#   powershell -File scripts/git-proxy.ps1 -Proxy http://127.0.0.1:7890 fetch --all
#   npm run push:proxy

[CmdletBinding()]
param(
  [string]$Proxy = $(if ($env:QINGYUE_GIT_PROXY) { $env:QINGYUE_GIT_PROXY } else { 'http://127.0.0.1:7897' }),
  [Parameter(Position = 0, ValueFromRemainingArguments = $true)]
  [string[]]$GitArgs
)

if (-not $GitArgs -or $GitArgs.Count -eq 0) {
  Write-Host "Usage: scripts/git-proxy.ps1 <git-subcommand> [args...]"
  Write-Host "  Default proxy: http://127.0.0.1:7897"
  Write-Host "  Override: -Proxy http://127.0.0.1:PORT   or env QINGYUE_GIT_PROXY"
  exit 1
}

Write-Host "git $($GitArgs -join ' ')  via $Proxy"
& git -c "http.proxy=$Proxy" -c "https.proxy=$Proxy" @GitArgs
exit $LASTEXITCODE
