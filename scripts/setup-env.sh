#!/usr/bin/env bash
# Creates .env from .env.example with fresh secrets. Usage: scripts/setup-env.sh [--local]
#   --local  also fills Supabase keys from the running local Supabase CLI stack.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] && { echo ".env already exists; leaving it untouched."; exit 0; }
cp .env.example .env

set_var() { # set_var KEY VALUE
  if grep -q "^$1=" .env; then sed -i.bak "s|^$1=.*|$1=$2|" .env && rm -f .env.bak; else echo "$1=$2" >> .env; fi
}

set_var TOKEN_ENCRYPTION_KEY "$(openssl rand -hex 32)"
set_var REDIS_PASSWORD "$(openssl rand -hex 16)"

if [ "${1:-}" = "--local" ]; then
  status="$(npx --yes supabase@latest status -o env)"
  get() { echo "$status" | grep "^$1=" | head -1 | cut -d= -f2- | tr -d '"'; }
  set_var SUPABASE_ANON_KEY "$(get ANON_KEY)"
  set_var SUPABASE_SERVICE_ROLE_KEY "$(get SERVICE_ROLE_KEY)"
  echo "Filled Supabase keys from the local stack."
else
  set_var SUPABASE_INTERNAL_URL ""
  echo "Edit .env: set SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY and DATABASE_URL for your cloud project."
fi
echo "Created .env"
