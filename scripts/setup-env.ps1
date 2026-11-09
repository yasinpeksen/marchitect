# Creates .env from .env.example with fresh secrets. Usage: scripts\setup-env.ps1 [-Local]
param([switch]$Local)
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

if (Test-Path .env) { Write-Output ".env already exists; leaving it untouched."; exit 0 }
Copy-Item .env.example .env

function New-Hex([int]$bytes) {
  $b = New-Object byte[] $bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  -join ($b | ForEach-Object { $_.ToString('x2') })
}
function Set-Var([string]$key, [string]$value) {
  $lines = Get-Content .env
  if ($lines -match "^$key=") { $lines = $lines -replace "^$key=.*", "$key=$value" } else { $lines += "$key=$value" }
  Set-Content .env $lines -Encoding utf8
}

Set-Var TOKEN_ENCRYPTION_KEY (New-Hex 32)
Set-Var REDIS_PASSWORD (New-Hex 16)

if ($Local) {
  $status = npx --yes supabase@latest status -o env
  function Get-Status($k) { ($status | Where-Object { $_ -like "$k=*" } | Select-Object -First 1).Substring($k.Length + 1).Trim('"') }
  Set-Var SUPABASE_ANON_KEY (Get-Status 'ANON_KEY')
  Set-Var SUPABASE_SERVICE_ROLE_KEY (Get-Status 'SERVICE_ROLE_KEY')
  Write-Output "Filled Supabase keys from the local stack."
} else {
  Set-Var SUPABASE_INTERNAL_URL ''
  Write-Output "Edit .env: set SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY and DATABASE_URL for your cloud project."
}
Write-Output "Created .env"
