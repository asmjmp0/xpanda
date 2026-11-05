# xpanda-gadget native library — DevEco/hvigor integration.
# Copy this directory into <project>/entry/src/main/cpp/ (or add it as a
# subdirectory) and declare libxpanda_gadget.so in the HAP packaging config.
#
# Layout:
#   src/gadget.cpp            NAPI module entry + exported functions
#   src/common/               shared socket instance, hilog helpers, mini JSON
#   src/napi/                 NAPI value conversions (host ArkTS runtime)
#   src/js/                   JSVM runtime + JS-thread bridge
#   src/js/module/            modules injected into the JSVM (console)
#   src/socket/               abstract unix socket + NDJSON protocol
# @Author: jmp0
cmake_minimum_required(VERSION 3.5.0)
project(xpanda_gadget)

set(NATIVERENDER_ROOT_PATH ${CMAKE_CURRENT_SOURCE_DIR})

include_directories(
    ${NATIVERENDER_ROOT_PATH}/src
    ${NATIVERENDER_ROOT_PATH}/src/common
    ${NATIVERENDER_ROOT_PATH}/src/napi
    ${NATIVERENDER_ROOT_PATH}/src/js
    ${NATIVERENDER_ROOT_PATH}/src/socket
)

add_library(xpanda_gadget SHARED
    src/gadget.cpp
    src/common/context.cpp
    src/napi/napi_utils.cpp
    src/js/jsvm_value.cpp
    src/js/module/console.cpp
    src/js/module/host_bridge.cpp
    src/js/module/host_global.cpp
    src/js/module/napi_bridge.cpp
    src/js/jsvm.cpp
    src/js/js_thread.cpp
    src/socket/socket_server.cpp
)

target_link_libraries(xpanda_gadget PUBLIC
    libace_napi.z.so
    libjsvm.so
    libhilog_ndk.z.so
)
