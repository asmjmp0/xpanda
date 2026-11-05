#!/bin/sh
# Cross-compile libxpanda_gadget.so with the LLVM toolchain bundled in the
# DevEco command-line tools (~/command-line-tools). Output:
#   assets/<abi>/libxpanda_gadget.so   (prebuilt artifact, checked in per ABI)
#
# The SDK's static libc++ archive ships with debug sections; linking strips them
# and the final artifact is stripped of local symbols (dynamic symbols are kept).
# Set XPANDA_GADGET_DEBUG=1 to keep debug info and symbols for on-device debugging.
# @Author: jmp0
set -e

CLT="${XPANDA_CLT:-$HOME/command-line-tools}"
SDK="$CLT/sdk/default/openharmony"
CXX="$SDK/native/llvm/bin/aarch64-unknown-linux-ohos-clang++"
STRIP="$SDK/native/llvm/bin/llvm-strip"
SYSROOT="$SDK/native/sysroot"

if [ ! -x "$CXX" ]; then
    echo "error: clang++ not found at $CXX" >&2
    echo "set XPANDA_CLT to your command-line-tools directory" >&2
    exit 1
fi

DIR="$(cd "$(dirname "$0")" && pwd)"
PKG_DIR="$(dirname "$DIR")"
OUT_DIR="$PKG_DIR/assets/arm64-v8a"
mkdir -p "$OUT_DIR"

# Source layout: src/gadget.cpp is the NAPI surface; common/ holds shared state,
# log and JSON helpers; js/ the JSVM + thread bridge; js/module/ the modules
# injected into the JSVM (console); socket/ the abstract-unix-socket protocol
# server; napi/ the host value conversions.
# libjsvm.so is a link-time dependency (NEEDED); JS runs on the host JS thread.
"$CXX" --sysroot="$SYSROOT" \
    -std=c++17 -O2 -fPIC -shared \
    -ffunction-sections -fdata-sections \
    -I"$SYSROOT/usr/include" \
    -I"$DIR/src" \
    "$DIR/src/gadget.cpp" \
    "$DIR/src/common/context.cpp" \
    "$DIR/src/napi/napi_utils.cpp" \
    "$DIR/src/js/jsvm_value.cpp" \
    "$DIR/src/js/module/console.cpp" \
    "$DIR/src/js/module/host_bridge.cpp" \
    "$DIR/src/js/module/host_global.cpp" \
    "$DIR/src/js/module/napi_bridge.cpp" \
    "$DIR/src/js/module/patch_bridge.cpp" \
    "$DIR/src/js/jsvm.cpp" \
    "$DIR/src/js/js_thread.cpp" \
    "$DIR/src/socket/socket_server.cpp" \
    -o "$OUT_DIR/libxpanda_gadget.so" \
    -lace_napi.z \
    -ljsvm \
    -lhilog_ndk.z \
    -luv \
    -static-libstdc++ \
    -Wl,--gc-sections \
    -Wl,-S \
    -Wl,--exclude-libs,ALL \
    -Wl,-z,defs

if [ "${XPANDA_GADGET_DEBUG:-0}" = "1" ]; then
    echo "debug build: keeping debug info and symbols"
elif [ -x "$STRIP" ]; then
    "$STRIP" --strip-unneeded "$OUT_DIR/libxpanda_gadget.so"
fi

echo "built: $OUT_DIR/libxpanda_gadget.so"
