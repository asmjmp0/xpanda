# xpanda-gadget native library — DevEco/hvigor integration.
# Copy this directory into <project>/entry/src/main/cpp/ (or add it as a
# subdirectory) and declare libxpanda_gadget.so in the HAP packaging config.
# @Author: jmp0
cmake_minimum_required(VERSION 3.5.0)
project(xpanda_gadget)

set(NATIVERENDER_ROOT_PATH ${CMAKE_CURRENT_SOURCE_DIR})

include_directories(${NATIVERENDER_ROOT_PATH})

add_library(xpanda_gadget SHARED
    gadget.cpp
    socket_server.cpp
)

target_link_libraries(xpanda_gadget PUBLIC
    libace_napi.z.so
)
