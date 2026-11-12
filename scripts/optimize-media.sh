#!/usr/bin/env bash
# scripts/optimize-media.sh
#
# Media optimization utility for Yaale Boutique:
# 1. Product Images: Converts to WebP ~900px wide (quality 80)
# 2. Videos: Re-encodes with ffmpeg to H.264, max 720p wide, CRF ~28, -movflags +faststart, targeting < 3MB
# 3. Posters: Generates a JPEG poster frame (at 00:00:01) for each video
# 4. De-duplication: Skips duplicate files by SHA-256 checksum
# Writes all outputs to 'storage-optimized/' and NEVER overwrites original files.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

SOURCE_IMG_DIR="$ROOT_DIR/boutique-backend-node/public/storage/products"
SOURCE_VID_DIR="$ROOT_DIR/boutique-backend-node/public/storage/videos"
OUTPUT_DIR="$ROOT_DIR/storage-optimized"
OUT_IMG_DIR="$OUTPUT_DIR/products"
OUT_VID_DIR="$OUTPUT_DIR/videos"
OUT_POSTER_DIR="$OUTPUT_DIR/posters"

mkdir -p "$OUT_IMG_DIR" "$OUT_VID_DIR" "$OUT_POSTER_DIR"

echo "========================================================================"
echo "                   YAALE MEDIA OPTIMIZATION SCRIPT                      "
echo "========================================================================"
echo "Source images : $SOURCE_IMG_DIR"
echo "Source videos : $SOURCE_VID_DIR"
echo "Output dir    : $OUTPUT_DIR"
echo ""

# Associative array for tracking checksums to skip byte-identical duplicates
declare -A SEEN_CHECKSUMS

get_checksum() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

# -----------------------------------------------------------------------------
# 1. OPTIMIZE PRODUCT IMAGES
# -----------------------------------------------------------------------------
echo "--- Optimizing Product Images (WebP ~900px wide, quality 80) ---"

if [ -d "$SOURCE_IMG_DIR" ]; then
  for img in "$SOURCE_IMG_DIR"/*; do
    [ -f "$img" ] || continue
    filename="$(basename "$img")"
    ext="${filename##*.}"
    ext_lower="$(echo "$ext" | tr '[:upper:]' '[:lower:]')"

    case "$ext_lower" in
      jpg|jpeg|png|webp) ;;
      *) continue ;;
    esac

    csum=$(get_checksum "$img")
    if [ -n "${SEEN_CHECKSUMS[$csum]:-}" ]; then
      echo "  [SKIP DUP] $filename is byte-identical to ${SEEN_CHECKSUMS[$csum]}"
      continue
    fi
    SEEN_CHECKSUMS[$csum]="$filename"

    base_name="${filename%.*}"
    target="$OUT_IMG_DIR/${base_name}.webp"

    # Use ffmpeg, cwebp or sharp-cli to convert to webp 900px wide quality 80
    if command -v ffmpeg >/dev/null 2>&1; then
      ffmpeg -y -v error -i "$img" -vf "scale='min(900,iw)':-1" -c:v libwebp -quality 80 "$target"
      echo "  ✓ Converted $filename -> ${base_name}.webp"
    elif command -v cwebp >/dev/null 2>&1; then
      cwebp -quiet -q 80 -resize 900 0 "$img" -o "$target"
      echo "  ✓ Converted $filename -> ${base_name}.webp"
    else
      echo "  ! Neither ffmpeg nor cwebp found. Please install ffmpeg to process $filename"
    fi
  done
else
  echo "Image directory not found: $SOURCE_IMG_DIR"
fi

echo ""

# -----------------------------------------------------------------------------
# 2. OPTIMIZE EDITORIAL VIDEOS & EXTRACT POSTERS
# -----------------------------------------------------------------------------
echo "--- Optimizing Editorial Videos (H.264 max 720p, CRF 28, faststart) ---"

if [ -d "$SOURCE_VID_DIR" ]; then
  for vid in "$SOURCE_VID_DIR"/*; do
    [ -f "$vid" ] || continue
    filename="$(basename "$vid")"
    ext="${filename##*.}"
    ext_lower="$(echo "$ext" | tr '[:upper:]' '[:lower:]')"

    case "$ext_lower" in
      mp4|mov|webm|mkv) ;;
      *) continue ;;
    esac

    csum=$(get_checksum "$vid")
    if [ -n "${SEEN_CHECKSUMS[$csum]:-}" ]; then
      echo "  [SKIP DUP] $filename is byte-identical to ${SEEN_CHECKSUMS[$csum]}"
      continue
    fi
    SEEN_CHECKSUMS[$csum]="$filename"

    base_name="${filename%.*}"
    target_vid="$OUT_VID_DIR/${base_name}.mp4"
    target_poster="$OUT_POSTER_DIR/${base_name}_poster.jpg"

    if command -v ffmpeg >/dev/null 2>&1; then
      # Check if video has an audio stream
      has_audio=0
      if command -v ffprobe >/dev/null 2>&1; then
        if ffprobe -v error -select_streams a:0 -show_entries stream=codec_type -of default=nw=1:nk=1 "$vid" | grep -q audio; then
          has_audio=1
        fi
      fi

      audio_args="-an"
      if [ "$has_audio" -eq 1 ]; then
        audio_args="-c:a aac -b:a 96k"
      fi

      # Re-encode video: max 720p width, CRF ~28, +faststart
      ffmpeg -y -v error -i "$vid" \
        -vf "scale='min(720,iw)':-2" \
        -c:v libx264 -preset slow -crf 28 -movflags +faststart \
        $audio_args \
        "$target_vid"

      # Generate poster frame at 1s
      ffmpeg -y -v error -ss 00:00:01 -i "$vid" -vframes 1 -q:v 2 "$target_poster"

      echo "  ✓ Re-encoded $filename -> ${base_name}.mp4 + poster frame"
    else
      echo "  ! ffmpeg not found. Please install ffmpeg to process $filename"
    fi
  done
else
  echo "Video directory not found: $SOURCE_VID_DIR"
fi

echo ""
echo "Media optimization complete. Output stored in: $OUTPUT_DIR"

