#!/usr/bin/env bash
# Downloads the free sherpa-onnx keyword-spotting model, generates a
# keywords file for one or more trigger phrases (default "please clip
# that"), and writes the resulting KWS_* paths into .env - everything
# /voiceclip needs.
#
# With --with-asr, also downloads a small offline Whisper ASR model and
# writes the ASR_*/WAKE_WORD_PHRASES vars for the optional, parallel
# transcription-based trigger check - either engine detecting the phrase
# triggers a clip. Whisper (rather than a streaming ASR model) is used here
# because testing against real "please clip that" recordings showed
# streaming models missing or garbling short, quiet trigger phrases far more
# often than Whisper's offline, whole-utterance decoding does.
# See docs/GUIDE.md §6 for the manual walkthrough this automates.
#
# Usage:
#   scripts/setup-voiceclip.sh [options]
#
# Options:
#   --phrase "please clip that,clip that"   Comma-separated trigger phrase(s) to detect
#                            (default: "please clip that")
#   --score 2.0             Boosting score - higher catches more, more false positives
#                            (applied to every phrase in --phrase)
#   --threshold 0.35        Triggering threshold - lower catches more, more false positives
#                            (applied to every phrase in --phrase)
#   --out-dir data/kws-model  Where the model + generated keywords file are stored
#   --env-file .env          .env file to write KWS_* into (created if missing)
#   --fp32                   Use full-precision model files instead of int8 (larger, slower)
#   --print-only             Print the KWS_*/ASR_* lines instead of writing them to --env-file
#   --with-asr               Also set up the optional transcription-based trigger check (~113MB model)
#   --wake-word-phrases "please clip that,clip that"
#                            Comma-separated phrases the transcription check matches (default: --phrase's value)
#   --asr-out-dir data/asr-model  Where the ASR model is stored (only with --with-asr)
#   -h, --help                Show this help
set -euo pipefail

MODEL_NAME="sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01"
MODEL_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/${MODEL_NAME}.tar.bz2"

ASR_MODEL_NAME="sherpa-onnx-whisper-tiny.en"
ASR_MODEL_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${ASR_MODEL_NAME}.tar.bz2"

PHRASE="please clip that,please clip it,clip that,clip it,click that,flip that,click it,flip it,laugh"
SCORE="2.0"
THRESHOLD="0.35"
OUT_DIR="data/kws-model"
ENV_FILE=".env"
PRECISION="int8"
PRINT_ONLY=0
WITH_ASR=0
ASR_OUT_DIR="data/asr-model"
WAKE_WORD_PHRASES=""

usage() {
  sed -n '2,/^set -euo pipefail/p' "$0" | sed '$d; s/^# \{0,1\}//'
}

while [ $# -gt 0 ]; do
  case "$1" in
    --phrase) PHRASE="$2"; shift 2 ;;
    --score) SCORE="$2"; shift 2 ;;
    --threshold) THRESHOLD="$2"; shift 2 ;;
    --out-dir) OUT_DIR="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --fp32) PRECISION="fp32"; shift ;;
    --print-only) PRINT_ONLY=1; shift ;;
    --with-asr) WITH_ASR=1; shift ;;
    --wake-word-phrases) WAKE_WORD_PHRASES="$2"; shift 2 ;;
    --asr-out-dir) ASR_OUT_DIR="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

[ -n "$WAKE_WORD_PHRASES" ] || WAKE_WORD_PHRASES="$PHRASE"

log() { echo "[setup-voiceclip] $*" >&2; }
die() { echo "[setup-voiceclip] error: $*" >&2; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || die "'$1' is required but not found on PATH."; }

need tar
need python3
command -v curl >/dev/null 2>&1 || command -v wget >/dev/null 2>&1 || die "curl or wget is required."

download() {
  local url="$1" out="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -sSL -o "$out" "$url"
  else
    wget -q -O "$out" "$url"
  fi
}

absolute_path() {
  # Portable equivalent of `realpath` (not guaranteed present everywhere).
  python3 -c "import os,sys; print(os.path.abspath(sys.argv[1]))" "$1"
}

mkdir -p "$OUT_DIR"
OUT_DIR="$(absolute_path "$OUT_DIR")"
MODEL_DIR="$OUT_DIR/$MODEL_NAME"

# --- 1. Download + extract the model (skip if already present) ---
if [ -f "$MODEL_DIR/tokens.txt" ]; then
  log "Model already present at $MODEL_DIR, skipping download."
else
  log "Downloading $MODEL_NAME (~18MB, no login required)..."
  TARBALL="$OUT_DIR/${MODEL_NAME}.tar.bz2"
  download "$MODEL_URL" "$TARBALL"
  log "Extracting..."
  tar xjf "$TARBALL" -C "$OUT_DIR"
  rm -f "$TARBALL"
fi

if [ "$PRECISION" = "int8" ]; then
  ENCODER_PATH="$MODEL_DIR/encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx"
  DECODER_PATH="$MODEL_DIR/decoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx"
  JOINER_PATH="$MODEL_DIR/joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx"
else
  ENCODER_PATH="$MODEL_DIR/encoder-epoch-12-avg-2-chunk-16-left-64.onnx"
  DECODER_PATH="$MODEL_DIR/decoder-epoch-12-avg-2-chunk-16-left-64.onnx"
  JOINER_PATH="$MODEL_DIR/joiner-epoch-12-avg-2-chunk-16-left-64.onnx"
fi
TOKENS_PATH="$MODEL_DIR/tokens.txt"
BPE_MODEL_PATH="$MODEL_DIR/bpe.model"

for f in "$ENCODER_PATH" "$DECODER_PATH" "$JOINER_PATH" "$TOKENS_PATH" "$BPE_MODEL_PATH"; do
  [ -f "$f" ] || die "Expected model file not found: $f (the release layout may have changed - see docs/GUIDE.md §6)"
done

# --- 2. Make sure sherpa-onnx-cli (the Python text2token tool) is available ---
if ! command -v sherpa-onnx-cli >/dev/null 2>&1; then
  log "sherpa-onnx-cli not found, installing the 'sherpa-onnx' Python package..."
  need pip3
  # sherpa-onnx-cli depends on 'click' but some sherpa-onnx releases don't
  # declare it, so install it explicitly too.
  pip3 install --quiet sherpa-onnx click || die "Failed to install the sherpa-onnx Python package."
fi
command -v sherpa-onnx-cli >/dev/null 2>&1 || die "sherpa-onnx-cli still not on PATH after install (check your Python user-base bin dir is in PATH)."
python3 -c "import click" 2>/dev/null || { log "Installing missing 'click' dependency..."; pip3 install --quiet click || die "Failed to install 'click'."; }

# --- 3. Generate the keywords file for the trigger phrase(s) ---
# A sherpa-onnx keywords file supports one phrase per line, each with its own
# @label; splitting --phrase on commas lets multiple wordings all trigger a
# clip, the same way WAKE_WORD_PHRASES already does for the transcription
# check below.
IFS=',' read -ra PHRASE_LIST <<< "$PHRASE"
PHRASES=()
for raw_phrase in "${PHRASE_LIST[@]}"; do
  trimmed="$(printf '%s' "$raw_phrase" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
  [ -n "$trimmed" ] && PHRASES+=("$trimmed")
done
[ "${#PHRASES[@]}" -gt 0 ] || die "No trigger phrases given (--phrase was empty)."

RAW_KEYWORDS_PATH="$OUT_DIR/keywords_raw.txt"
KEYWORDS_PATH="$OUT_DIR/keywords.txt"
: > "$RAW_KEYWORDS_PATH"

LABELS=()
for phrase in "${PHRASES[@]}"; do
  label="$(printf '%s' "$phrase" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9' '_' | sed 's/_\+/_/g; s/^_//; s/_$//')"
  [ -n "$label" ] || die "Could not derive a keyword label from phrase '$phrase'."
  LABELS+=("$label")
  phrase_upper="$(printf '%s' "$phrase" | tr '[:lower:]' '[:upper:]')"
  echo "${phrase_upper} :${SCORE} #${THRESHOLD} @${label}" >> "$RAW_KEYWORDS_PATH"
done

log "Generating keywords file for ${#PHRASES[@]} phrase(s) (score: $SCORE, threshold: $THRESHOLD):"
for i in "${!PHRASES[@]}"; do
  log "  \"${PHRASES[$i]}\" (label: @${LABELS[$i]})"
done
sherpa-onnx-cli text2token \
  --tokens "$TOKENS_PATH" \
  --tokens-type bpe \
  --bpe-model "$BPE_MODEL_PATH" \
  "$RAW_KEYWORDS_PATH" "$KEYWORDS_PATH"

# --- 4. Optionally download the offline Whisper ASR model ---
# Unlike KWS, this needs no keywords-file generation step - Whisper
# transcribes arbitrary speech out of the box; the transcript is matched
# against WAKE_WORD_PHRASES at runtime instead. Also unlike KWS/streaming
# transducer models, Whisper has no joiner file.
if [ "$WITH_ASR" -eq 1 ]; then
  mkdir -p "$ASR_OUT_DIR"
  ASR_OUT_DIR="$(absolute_path "$ASR_OUT_DIR")"
  ASR_MODEL_DIR="$ASR_OUT_DIR/$ASR_MODEL_NAME"

  if [ -f "$ASR_MODEL_DIR/tiny.en-tokens.txt" ]; then
    log "ASR model already present at $ASR_MODEL_DIR, skipping download."
  else
    log "Downloading $ASR_MODEL_NAME (~113MB, no login required)..."
    ASR_TARBALL="$ASR_OUT_DIR/${ASR_MODEL_NAME}.tar.bz2"
    download "$ASR_MODEL_URL" "$ASR_TARBALL"
    log "Extracting..."
    tar xjf "$ASR_TARBALL" -C "$ASR_OUT_DIR"
    rm -f "$ASR_TARBALL"
  fi

  if [ "$PRECISION" = "int8" ]; then
    ASR_ENCODER_PATH="$ASR_MODEL_DIR/tiny.en-encoder.int8.onnx"
    ASR_DECODER_PATH="$ASR_MODEL_DIR/tiny.en-decoder.int8.onnx"
  else
    ASR_ENCODER_PATH="$ASR_MODEL_DIR/tiny.en-encoder.onnx"
    ASR_DECODER_PATH="$ASR_MODEL_DIR/tiny.en-decoder.onnx"
  fi
  ASR_TOKENS_PATH="$ASR_MODEL_DIR/tiny.en-tokens.txt"

  for f in "$ASR_ENCODER_PATH" "$ASR_DECODER_PATH" "$ASR_TOKENS_PATH"; do
    [ -f "$f" ] || die "Expected ASR model file not found: $f (the release layout may have changed - see docs/GUIDE.md §6)"
  done
fi

# --- 5. Write (or print) the KWS_* (and, with --with-asr, ASR_*/WAKE_WORD_PHRASES) env vars ---
if [ "$PRINT_ONLY" -eq 1 ]; then
  log "Done. Add these to your .env:"
  echo
  echo "KWS_ENCODER_PATH=$ENCODER_PATH"
  echo "KWS_DECODER_PATH=$DECODER_PATH"
  echo "KWS_JOINER_PATH=$JOINER_PATH"
  echo "KWS_TOKENS_PATH=$TOKENS_PATH"
  echo "KWS_KEYWORDS_PATH=$KEYWORDS_PATH"
  if [ "$WITH_ASR" -eq 1 ]; then
    echo "ASR_ENCODER_PATH=$ASR_ENCODER_PATH"
    echo "ASR_DECODER_PATH=$ASR_DECODER_PATH"
    echo "ASR_TOKENS_PATH=$ASR_TOKENS_PATH"
    echo "WAKE_WORD_PHRASES=$WAKE_WORD_PHRASES"
  fi
  exit 0
fi

touch "$ENV_FILE"
TMP_ENV="$(mktemp)"
STRIP_PATTERN='^(KWS_ENCODER_PATH|KWS_DECODER_PATH|KWS_JOINER_PATH|KWS_TOKENS_PATH|KWS_KEYWORDS_PATH)='
if [ "$WITH_ASR" -eq 1 ]; then
  # Also strips ASR_JOINER_PATH, a leftover from an earlier version of this
  # script that set up a streaming transducer ASR model; Whisper has no
  # joiner file, so a fresh --with-asr run should drop that stale line.
  STRIP_PATTERN="$STRIP_PATTERN|^(ASR_ENCODER_PATH|ASR_DECODER_PATH|ASR_JOINER_PATH|ASR_TOKENS_PATH|WAKE_WORD_PHRASES)="
fi
grep -vE "$STRIP_PATTERN" "$ENV_FILE" > "$TMP_ENV" || true
{
  cat "$TMP_ENV"
  echo "KWS_ENCODER_PATH=$ENCODER_PATH"
  echo "KWS_DECODER_PATH=$DECODER_PATH"
  echo "KWS_JOINER_PATH=$JOINER_PATH"
  echo "KWS_TOKENS_PATH=$TOKENS_PATH"
  echo "KWS_KEYWORDS_PATH=$KEYWORDS_PATH"
  if [ "$WITH_ASR" -eq 1 ]; then
    echo "ASR_ENCODER_PATH=$ASR_ENCODER_PATH"
    echo "ASR_DECODER_PATH=$ASR_DECODER_PATH"
    echo "ASR_TOKENS_PATH=$ASR_TOKENS_PATH"
    echo "WAKE_WORD_PHRASES=$WAKE_WORD_PHRASES"
  fi
} > "$ENV_FILE"
rm -f "$TMP_ENV"

log "Done. Wrote KWS_* paths into $ENV_FILE."
if [ "$WITH_ASR" -eq 1 ]; then
  log "Also wrote ASR_*/WAKE_WORD_PHRASES paths into $ENV_FILE."
fi
log "Restart the bot, then run /voiceclip enable in Discord."
