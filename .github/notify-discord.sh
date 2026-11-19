#!/usr/bin/env bash
# CI の結果を Discord に 1 通送る。値はすべて環境変数から受け取る（コミットの文に記号があっても壊れない）
# DISCORD_WEBHOOK_URL がなければ何もしない。DRY_RUN=1 なら送らずに JSON を出すだけ
set -euo pipefail

if [ -z "${DISCORD_WEBHOOK_URL:-}" ] && [ -z "${DRY_RUN:-}" ]; then
  echo "DISCORD_WEBHOOK_URL がないので、知らせずに終わります"
  exit 0
fi

# どの手順で失敗したか
failed=""
for pair in "INSTALL:依存の取得" "TYPECHECK:型の検査" "TEST:テスト" "BUILD:ビルド"; do
  key="${pair%%:*}"; name="${pair#*:}"
  if [ "${!key:-}" = "failure" ]; then failed="$name"; break; fi
done

if [ -z "$failed" ]; then
  head="✅ テスト通過"; color=4182154   # 緑 #3FD08A
else
  head="❌ 失敗：${failed}"; color=16735570 # 赤 #FF5D52
fi

title="$(printf '%s' "${TITLE:-}" | head -n 1 | cut -c1-200)"

payload="$(jq -n \
  --arg head "$head" --argjson color "$color" \
  --arg repo "${REPO:-}" --arg branch "${BRANCH:-}" \
  --arg title "$title" --arg author "${AUTHOR:-}" \
  --arg commit "${COMMIT_URL:-}" --arg run "${RUN_URL:-}" \
  '{
    username: "GitHub",
    embeds: [{
      title: ($head + "　" + $repo),
      url: $run,
      color: $color,
      description: ($title + "\n" + "by " + $author),
      fields: [
        { name: "ブランチ", value: $branch, inline: true },
        { name: "リンク", value: ("[コミット](" + $commit + ") ・ [CI の結果](" + $run + ")"), inline: true }
      ]
    }]
  }')"

if [ -n "${DRY_RUN:-}" ]; then
  printf '%s\n' "$payload"
  exit 0
fi

# 送れなくても CI の結果は変えない
curl -fsS -H 'Content-Type: application/json' -d "$payload" "$DISCORD_WEBHOOK_URL" >/dev/null || echo "Discord への送信に失敗しました"
