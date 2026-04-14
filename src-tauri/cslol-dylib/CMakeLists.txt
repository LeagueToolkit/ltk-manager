cmake_minimum_required(VERSION 3.20)
project(cslol VERSION 1.0.0 LANGUAGES CXX ASM)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(LOL_LIB "${CMAKE_CURRENT_SOURCE_DIR}/cslol-tools/lib")

add_library(cslol SHARED
    cslol_api.cpp
    ${LOL_LIB}/lol/common.cpp
    ${LOL_LIB}/lol/error.cpp
    ${LOL_LIB}/lol/fs.cpp
    ${LOL_LIB}/lol/patcher/patcher_macos_arm64.cpp
    ${LOL_LIB}/lol/patcher/patcher_macos_amd64.cpp
    ${LOL_LIB}/lol/patcher/utility/process_macos.cpp
)

target_include_directories(cslol PRIVATE ${LOL_LIB})

set_target_properties(cslol PROPERTIES
    OUTPUT_NAME cslol
    PREFIX lib
    MACOSX_RPATH ON
    BUILD_WITH_INSTALL_RPATH TRUE
    INSTALL_RPATH "@loader_path"
)
