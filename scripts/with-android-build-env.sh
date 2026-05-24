#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${JAVA_HOME:-}" || ! -x "$JAVA_HOME/bin/java" ]]; then
  if command -v /usr/libexec/java_home >/dev/null 2>&1; then
    if detected_home=$(/usr/libexec/java_home -v 17 2>/dev/null); then
      export JAVA_HOME="$detected_home"
    fi
  fi

  if [[ -z "${JAVA_HOME:-}" || ! -x "$JAVA_HOME/bin/java" ]]; then
    for candidate in \
      /opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home \
      /usr/local/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home \
      /opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home \
      /usr/local/opt/openjdk/libexec/openjdk.jdk/Contents/Home
    do
      if [[ -x "$candidate/bin/java" ]]; then
        export JAVA_HOME="$candidate"
        break
      fi
    done
  fi
fi

if [[ -z "${JAVA_HOME:-}" || ! -x "$JAVA_HOME/bin/java" ]]; then
  echo "Could not find a Java 17+ runtime. Install openjdk@17 or set JAVA_HOME." >&2
  exit 1
fi
export PATH="$JAVA_HOME/bin:$PATH"

if [[ -z "${ANDROID_HOME:-}" || ! -d "$ANDROID_HOME/platforms" ]]; then
  for candidate in \
    "$HOME/Library/Android/sdk" \
    /Volumes/T705/code/android-sdk \
    /Volumes/T705/code/android-commandlinetools \
    /opt/homebrew/share/android-commandlinetools
  do
    if [[ -d "$candidate/platforms" && -d "$candidate/platform-tools" ]]; then
      export ANDROID_HOME="$candidate"
      break
    fi
  done
fi

if [[ -z "${ANDROID_HOME:-}" || ! -d "$ANDROID_HOME/platforms" ]]; then
  echo "Could not find an Android SDK. Install command line tools or set ANDROID_HOME." >&2
  exit 1
fi
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"

exec "$@"
