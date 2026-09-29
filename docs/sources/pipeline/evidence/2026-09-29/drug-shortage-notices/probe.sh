UA="data-foundry-scout/1.0 (data@mail.proviciency.com)"
for u in "$@"; do
 printf "%s -> " "$u"; curl -sS -L -m 40 -A "$UA" -o /dev/null -w "%{http_code} %{size_download} %{content_type}\n" "$u" 2>&1 | tail -1
done
