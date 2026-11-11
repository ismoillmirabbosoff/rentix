#!/usr/bin/env bash
# App repo (rentix-backend / rentix-user / rentix-admin) CI'si chaqiradi:
# monorepodagi submodule ko'rsatkichini o'sha reponing main'iga suradi va
# push qiladi. Push monorepo'ning Deploy workflow'ini ishga tushiradi —
# deploy yo'li bitta bo'lib qoladi.
#
#   ./ci-bump.sh rentix-backend [commit-sha]
set -euo pipefail

# Ishlab turgan deploy papkasiga tegmaslik uchun alohida klon ishlatiladi
DEPLOY_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${BUMP_WORKDIR:-$(dirname "$DEPLOY_ROOT")/.rentix-ci-bump}"
if [ ! -d "$WORK/.git" ]; then
  git clone --quiet "$(git -C "$DEPLOY_ROOT" remote get-url origin)" "$WORK"
fi
cd "$WORK"

repo="${1:?submodule nomi kerak}"
sha="${2:-}"
case "$repo" in rentix-backend|rentix-user|rentix-admin) ;; *) echo "noma'lum repo: $repo" >&2; exit 1 ;; esac

exec 9>/tmp/rentix-ci-bump.lock
flock -w 300 9

git fetch --quiet origin main
git checkout --quiet --force main
git reset --quiet --hard origin/main
git submodule update --init --quiet "$repo"

git -C "$repo" fetch --quiet origin main
target="${sha:-$(git -C "$repo" rev-parse origin/main)}"
git -C "$repo" checkout --quiet --force "$target"

git add "$repo"
if git diff --cached --quiet; then
  echo "$repo allaqachon $target da — o'zgarish yo'q"
  exit 0
fi
msg="$(git -C "$repo" log -1 --format=%s)"
git -c user.name="rentix-ci" -c user.email="ci@rentix.uz" \
  commit --quiet -m "Bump ${repo#rentix-}: $msg"
git push --quiet origin main
echo "push qilindi: $(git log -1 --format='%h %s')"
