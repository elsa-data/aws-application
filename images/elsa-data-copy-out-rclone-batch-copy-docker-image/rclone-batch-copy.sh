dest=$1

shift

echo "Destination = $dest"

for src in "$@"; do
  echo "Source arg = $src"
  /usr/local/bin/rclone copy --stats-log-level NOTICE --checksum --dry-run "$src" "$dest"
done
