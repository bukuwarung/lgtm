#!/bin/sh
# What you send this Codex conversation from lgtm (your review, a comment to address) waits in a file of lgtm's,
# ~/.config/lgtm/outbox/<conversation>.md, messages separated by ---. When the conversation starts or you send it a
# message, this reads it, deletes it (so nothing is handled twice) and hands it to the conversation as context.
input=$(cat)
field() { printf '%s' "$input" | tr '\n' ' ' | sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([A-Za-z0-9_-]*\)\".*/\1/p"; }
id=$(field session_id)
event=$(field hook_event_name)
[ -n "$id" ] || exit 0
file="${XDG_CONFIG_HOME:-$HOME/.config}/lgtm/outbox/$id.md"
[ -s "$file" ] || exit 0
text=$(cat "$file")
rm -f "$file"
context=$(printf 'From lgtm, sent to this conversation (messages separated by ---). Act on each: a review lists the verdict and its comments; a single comment is one to address.\n\n%s' "$text" |
  awk 'BEGIN { ORS = "" } { gsub(/\\/, "\\\\"); gsub(/"/, "\\\""); gsub(/\t/, "\\t"); gsub(/\r/, ""); if (NR > 1) print "\\n"; print }')
printf '{"hookSpecificOutput":{"hookEventName":"%s","additionalContext":"%s"}}\n' "${event:-UserPromptSubmit}" "$context"
