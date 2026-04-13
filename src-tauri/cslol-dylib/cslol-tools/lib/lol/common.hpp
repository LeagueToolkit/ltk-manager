#pragma once
// Modified for ltk-manager: replaced fmt/fmtlog with std::format (C++23).
#include <format>
#include <string>
#include <string_view>

#include <cstddef>
#include <cstdint>
#include <memory>
#include <span>
#include <utility>

// Shim: route fmt::format → std::format so downstream code compiles unchanged.
namespace fmt {
    template <typename... Args>
    inline std::string format(std::format_string<Args...> fstr, Args&&... args) {
        return std::format(fstr, std::forward<Args>(args)...);
    }
}

// No-op logging macros (fmtlog removed).
#define logi(...) (void)0
#define logd(...) (void)0

namespace lol {
    void sleep_ms(std::uint32_t ms);
}
