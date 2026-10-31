#!/bin/sh
# Устанавливает официальную сборку Node.js (по умолчанию 24.22.2) в /usr/local.
set -eu

NODE_VERSION="${NODE_VERSION:-24.22.2}"

case "$(uname -m)" in
  x86_64 | amd64) NODE_ARCH=x64 ;;
  aarch64 | arm64) NODE_ARCH=arm64 ;;
  *)
    echo "Unsupported architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

ARCHIVE="node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz"
BASE_URL="https://nodejs.org/dist/v${NODE_VERSION}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

curl --fail --silent --show-error --location --output "$TMP_DIR/$ARCHIVE" "$BASE_URL/$ARCHIVE"
curl --fail --silent --show-error --location --output "$TMP_DIR/SHASUMS256.txt" "$BASE_URL/SHASUMS256.txt"

EXPECTED="$(awk -v name="$ARCHIVE" '$2 == name { print $1 }' "$TMP_DIR/SHASUMS256.txt")"
ACTUAL="$(sha256sum "$TMP_DIR/$ARCHIVE" | awk '{ print $1 }')"
if [ -z "$EXPECTED" ] || [ "$EXPECTED" != "$ACTUAL" ]; then
  echo "Node.js archive checksum mismatch" >&2
  exit 1
fi

tar -xJf "$TMP_DIR/$ARCHIVE" -C /usr/local --strip-components=1
node --version
npm --version
