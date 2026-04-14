#if defined(__APPLE__) && (defined(__x86_64__) || defined(__amd64__))
#    include <algorithm>
#    include <chrono>
#    include <cstdio>
#    include <cstring>
#    include <functional>
#    include <thread>

#    include "utility/delay.hpp"
#    include "utility/macho.hpp"
#    include "utility/process.hpp"

// do not reorder
#    include <lol/error.hpp>
#    include <lol/patcher/patcher.hpp>

using namespace lol;
using namespace lol::patcher;
using namespace std::chrono_literals;

// Compact payload for AMD64 — fits inside wad_verify's 184 bytes.
// Same approach as ARM64: wad_verify bypass + fopen hook + data in one blob.
// Import stub uses direct E9 JMP (no indirect pointer needed).
//
// The overlay path is written directly into the target process's __DATA segment
// gap (unused padding between the last section and the segment boundary).
// No symlinks, no new memory allocations.

__asm__(R"(
.text

.global _payload_blob_beg_amd64
.global _payload_blob_end_amd64

_payload_blob_beg_amd64:

// --- wad_verify bypass (6 bytes at offset 0) ---
    .byte 0xB8, 0x01, 0x00, 0x00, 0x00     // mov eax, 1
    .byte 0xC3                              // ret

// --- fopen hook (at offset 6, jumped to by patched import stub) ---

    // Early bailout — tail-call original fopen for non-matching calls
    test    %rdi, %rdi
    jz      Lamd64_passthru
    cmpw    $0x6272, (%rsi)                 // "rb" as 16-bit
    jne     Lamd64_passthru
    cmpb    $0, 2(%rsi)
    jne     Lamd64_passthru

    // Matching call — full prologue
    push    %rbp
    mov     %rsp, %rbp
    push    %r12
    push    %r13
    sub     $0x100, %rsp
    mov     %rdi, %r12
    mov     %rsi, %r13

    // strlen + suffix check via repnz scasb
    xor     %ecx, %ecx
    mov     $0x80, %cl
    xor     %al, %al
    repnz   scasb
    jnz     Lamd64_original
    mov     -8(%rdi), %rax
    movabs  $0x00746E65696C632E, %rcx       // ".client\0"
    cmp     %rcx, %rax
    jne     Lamd64_original

    // Build prefix + filename on stack
    mov     %rsp, %rdi
    mov     Lamd64_prefix_ptr(%rip), %rsi
Lamd64_pfx:
    lodsb
    stosb
    test    %al, %al
    jne     Lamd64_pfx
    dec     %rdi
    mov     %r12, %rsi
Lamd64_fn:
    lodsb
    stosb
    test    %al, %al
    jne     Lamd64_fn

    // Try modded path first
    mov     %rsp, %rdi
    mov     %r13, %rsi
    mov     Lamd64_fopen_org(%rip), %rax
    call    *(%rax)
    test    %rax, %rax
    jne     Lamd64_return

Lamd64_original:
    mov     %r12, %rdi
    mov     %r13, %rsi
    mov     Lamd64_fopen_org(%rip), %rax
    call    *(%rax)

Lamd64_return:
    add     $0x100, %rsp
    pop     %r13
    pop     %r12
    pop     %rbp
    ret

Lamd64_passthru:
    mov     Lamd64_fopen_org(%rip), %rax
    jmp     *(%rax)

// --- data ---
Lamd64_fopen_org:
    .quad   0xDEAD1234DEAD5678

Lamd64_prefix_ptr:
    .quad   0xDEAD0000DEAD0000

_payload_blob_end_amd64:
)");

extern "C" {
    extern unsigned char payload_blob_beg_amd64[];
    extern unsigned char payload_blob_end_amd64[];
}

static constexpr size_t WAD_VERIFY_SIZE_AMD64 = 184;
static constexpr size_t HOOK_OFFSET = 6;
static constexpr size_t PATH_BUFFER_SIZE = 256;
static constexpr uint64_t PREFIX_PLACEHOLDER = 0xDEAD0000DEAD0000;

// Import stub: E9 <rel32> + NOP (direct near jump, 6 bytes to match original stub size)
struct Payload_import_stub {
    uint8_t stub[6] = {};

    static Payload_import_stub create(uint64_t from, uint64_t to) {
        const int64_t offset = (int64_t)to - (int64_t)(from + 5);  // E9 is 5 bytes, RIP points past it
        if (offset < std::numeric_limits<int32_t>::min() || offset > std::numeric_limits<int32_t>::max()) {
            throw std::runtime_error("Import stub offset too big");
        }
        Payload_import_stub result{};
        result.stub[0] = 0xE9;  // JMP rel32
        uint32_t rel = static_cast<uint32_t>(offset);
        memcpy(&result.stub[1], &rel, 4);
        result.stub[5] = 0x90;  // NOP padding
        return result;
    }
};

static PtrStorage find_wad_verify(const uint8_t* text_beg, const uint8_t* text_end, uint64_t text_addr) {
    uint8_t const PATTERN[] = {
        0xB9, 0x26, 0x01, 0x00, 0x00, 0x41, 0xB8, 0x00, 0x01, 0x00, 0x00, 0x4C, 0x89, 0xF6, 0xE8
    };
    const auto i = std::search(text_beg, text_end, std::begin(PATTERN), std::end(PATTERN));
    if ((text_end - i) < (int64_t)(sizeof(PATTERN) + 4)) return 0;

    const uint8_t* text_disp = i + sizeof(PATTERN);
    const int32_t disp = (int32_t)((uint32_t)text_disp[0] | ((uint32_t)text_disp[1] << 8) |
                                   ((uint32_t)text_disp[2] << 16) | ((uint32_t)text_disp[3] << 24));
    const uint64_t call_offset = text_addr + (text_disp + 4) - text_beg;
    return call_offset + (uint64_t)disp;
}

struct Context {
    std::uint64_t off_wad_verify = {};
    std::uint64_t off_fopen_ptr = {};
    std::uint64_t off_fopen_stub = {};
    std::uint64_t off_data_gap = {};
    std::size_t data_gap_size = {};

    auto scan(Process const& process) -> void {
        auto data = process.Dump();
        auto macho = MachO{};
        macho.parse_data_amd64((MachO::data_t)data.data(), data.size());

        auto const [text_addr, text_data, text_size] = macho.find_section("__text");
        if (!text_data) throw std::runtime_error("Failed to find __text section");

        off_wad_verify = find_wad_verify(text_data, text_data + text_size, text_addr);
        if (!off_wad_verify) throw std::runtime_error("Failed to find wad_verify call");

        if (!(off_fopen_ptr = macho.find_import_ptr("_fopen")))
            throw std::runtime_error("Failed to find fopen org");
        if (!(off_fopen_stub = macho.find_stub_refs(off_fopen_ptr)))
            throw std::runtime_error("Failed to find fopen stub");

        auto const [gap_addr, gap_size] = macho.find_data_gap();
        if (!gap_addr || gap_size < PATH_BUFFER_SIZE)
            throw std::runtime_error("Failed to find __DATA gap for overlay path");
        off_data_gap = gap_addr;
        data_gap_size = gap_size;
    }

    auto check_already_patched(Process const& process) -> bool {
        // amd64: MOV EAX, 1 (B8 01 00 00 00) + RET (C3)
        uint8_t bypass_sig[] = {0xB8, 0x01, 0x00, 0x00, 0x00, 0xC3};
        uint8_t existing[6] = {};
        auto ptr = (void*)(uintptr_t)process.Rebase(off_wad_verify);
        return process.TryReadMemory(ptr, existing, 6)
            && memcmp(existing, bypass_sig, 6) == 0;
    }

    auto patch(Process const& process, std::string const& prefix) -> void {
        if (check_already_patched(process))
            throw std::runtime_error("Process is already patched");

        auto const blob_size = (size_t)(payload_blob_end_amd64 - payload_blob_beg_amd64);
        if (blob_size > WAD_VERIFY_SIZE_AMD64) {
            lol_throw_msg("Payload too big: {} bytes (max {})", blob_size, WAD_VERIFY_SIZE_AMD64);
        }

        struct PayloadRegion { uint8_t data[WAD_VERIFY_SIZE_AMD64]; };
        auto const ptr_wad_verify = process.Rebase<PayloadRegion>(off_wad_verify);
        auto const ptr_fopen_ptr = process.Rebase(off_fopen_ptr);
        auto const ptr_fopen_stub = process.Rebase<Payload_import_stub>(off_fopen_stub);

        // Write overlay path to the __DATA segment gap
        struct PathBuffer { char data[PATH_BUFFER_SIZE]; };
        auto const ptr_data_gap = process.Rebase<PathBuffer>(off_data_gap);
        PathBuffer path_buf = {};
        strncpy(path_buf.data, prefix.c_str(), sizeof(path_buf.data) - 1);
        process.MarkWritable(ptr_data_gap);
        process.Write(ptr_data_gap, path_buf);

        // Build payload with placeholders resolved
        PayloadRegion payload = {};
        memcpy(payload.data, payload_blob_beg_amd64, blob_size);

        // Resolve fopen GOT pointer
        uint64_t const fopen_placeholder = 0xDEAD1234DEAD5678;
        uint64_t const fopen_ptr_addr = (uint64_t)ptr_fopen_ptr;
        for (size_t i = 0; i <= blob_size - 8; i++) {
            uint64_t val;
            memcpy(&val, payload.data + i, 8);
            if (val == fopen_placeholder) {
                memcpy(payload.data + i, &fopen_ptr_addr, 8);
                break;
            }
        }

        // Resolve overlay path pointer (address of __DATA gap in target process)
        uint64_t const data_gap_addr = (uint64_t)ptr_data_gap;
        for (size_t i = 0; i <= blob_size - 8; i++) {
            uint64_t val;
            memcpy(&val, payload.data + i, 8);
            if (val == PREFIX_PLACEHOLDER) {
                memcpy(payload.data + i, &data_gap_addr, 8);
                break;
            }
        }

        auto const hook_addr = (PtrStorage)ptr_wad_verify + HOOK_OFFSET;
        auto payload_stub = Payload_import_stub::create((PtrStorage)ptr_fopen_stub, hook_addr);

        process.MarkWritable(ptr_wad_verify);
        process.Write(ptr_wad_verify, payload);
        process.MarkExecutable(ptr_wad_verify);

        process.MarkWritable(ptr_fopen_stub);
        process.Write(ptr_fopen_stub, payload_stub);
        process.MarkExecutable(ptr_fopen_stub);
    }
};

auto patcher::run(std::function<void(Message, char const*)> update,
                  fs::path const& profile_path,
                  fs::path const& config_path,
                  fs::path const& game_path,
                  fs::names const& opts) -> void {
    auto const blob_size = (size_t)(payload_blob_end_amd64 - payload_blob_beg_amd64);
    logi("Payload size: {} bytes (max {})", blob_size, WAD_VERIFY_SIZE_AMD64);
    if (blob_size > WAD_VERIFY_SIZE_AMD64) {
        throw std::runtime_error("Payload too big for wad_verify!");
    }

    auto prefix = profile_path.string();
    if (!prefix.empty() && prefix.back() != '/') prefix += '/';

    (void)config_path;
    (void)game_path;
    (void)opts;

    auto ctx = Context{};
    for (;;) {
        auto pid = Process::FindPid("/LeagueofLegends");
        if (!pid) {
            update(M_WAIT_START, "");
            sleep_ms(10);
            continue;
        }

        update(M_FOUND, "");
        auto process = Process::Open(pid);

        update(M_SCAN, "");
        ctx.scan(process);

        update(M_PATCH, "");
        ctx.patch(process, prefix);

        update(M_WAIT_EXIT, "");
        run_until_or(
            3h,
            Intervals{5s, 10s, 15s},
            [&] { return process.IsExited(); },
            []() -> bool { throw PatcherTimeout(std::string("Timed out exit")); });

        update(M_DONE, "");
    }
}

auto patcher::patch_process(std::uint32_t pid, fs::path const& profile_path) -> void {
    auto process = Process::Open(pid);

    auto proc_path = process.Path().string();
    if (proc_path.find("LeagueofLegends") == std::string::npos)
        throw std::runtime_error("Target process is not League of Legends");

    auto prefix = profile_path.string();
    if (!prefix.empty() && prefix.back() != '/') prefix += '/';

    auto ctx = Context{};
    ctx.scan(process);
    ctx.patch(process, prefix);
}

#endif
