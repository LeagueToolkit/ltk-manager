/// C API wrapper for the macOS patcher.
/// Exposes the same symbols as cslol-dll.dll on Windows so the Rust side
/// can load either library through libloading without platform branching.
#ifdef __APPLE__

#include <chrono>
#include <cstdint>
#include <string>
#include <thread>
#include <uchar.h>

#include <lol/patcher/patcher.hpp>
#include <lol/patcher/utility/process.hpp>

static std::string g_prefix;
static std::string g_last_error;

static std::string utf16_to_utf8(const char16_t* s) {
    std::string result;
    while (*s) {
        char16_t c = *s++;
        if (c < 0x80) {
            result += static_cast<char>(c);
        } else if (c < 0x800) {
            result += static_cast<char>(0xC0 | (c >> 6));
            result += static_cast<char>(0x80 | (c & 0x3F));
        } else {
            result += static_cast<char>(0xE0 | (c >> 12));
            result += static_cast<char>(0x80 | ((c >> 6) & 0x3F));
            result += static_cast<char>(0x80 | (c & 0x3F));
        }
    }
    return result;
}

static const char* set_error(std::string msg) {
    g_last_error = std::move(msg);
    return g_last_error.c_str();
}

extern "C" {

const char* cslol_init() { return nullptr; }

const char* cslol_set_config(const char16_t* prefix) {
    g_prefix = utf16_to_utf8(prefix);
    return nullptr;
}

const char* cslol_set_flags(uint64_t) { return nullptr; }
const char* cslol_set_log_level(int) { return nullptr; }
const char* cslol_set_log_file(const char16_t*) { return nullptr; }
const char* cslol_log_pull() { return nullptr; }

unsigned cslol_find() {
    return lol::patcher::Process::FindPid("/LeagueofLegends");
}

void cslol_sleep(uint32_t ms) {
    std::this_thread::sleep_for(std::chrono::milliseconds(ms));
}

const char* cslol_hook(unsigned pid, unsigned, unsigned) {
    try {
        lol::patcher::patch_process(pid, g_prefix);
        return nullptr;
    } catch (std::exception const& e) {
        return set_error(e.what());
    } catch (...) {
        return set_error("Unknown error in cslol_hook");
    }
}

}  // extern "C"
#endif  // __APPLE__
