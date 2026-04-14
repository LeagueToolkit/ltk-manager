#if defined(__APPLE__) && (defined(__aarch64__) || defined(__arm64__))
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

// Compact payload that fits inside wad_verify's 272 bytes:
//   [0x00] MOV X0, #1; RET          — wad_verify bypass (8 bytes)
//   [0x08] fopen hook code           — redirects .wad.client reads
//   [data] fopen_org_ptr             — pointer to GOT slot (8 bytes)
//   [data] prefix_ptr                — pointer to overlay path in __DATA gap (8 bytes)
//
// The overlay path is written directly into the target process's __DATA segment
// gap (unused padding between the last section and the segment boundary).
// No symlinks, no new memory allocations.

__asm__(R"(
.text

.global _payload_blob_beg
.global _payload_blob_end

.set buffer_size, 0x200

filename .req x19
mode .req x20
filename_len .req x21
fopen_org .req x22

_payload_blob_beg:

// --- wad_verify bypass (8 bytes at offset 0) ---
    mov     x0, #1
    ret

// --- fopen hook (at offset 8, jumped to by patched import stub) ---
    stp     fp, lr, [sp, #-16]!
    mov     fp, sp
    stp     filename, mode, [sp, #-16]!
    stp     filename_len, fopen_org, [sp, #-16]!
    sub     sp, sp, #buffer_size

    mov     filename, x0
    mov     mode, x1

    adr     fopen_org, Lfopen_org
    ldr     fopen_org, [fopen_org]
    ldr     fopen_org, [fopen_org]

    cbz     filename, Loriginal
    cbz     mode, Loriginal

    ldrb    w2, [mode]
    cmp     w2, #'r'
    b.ne    Loriginal
    ldrb    w2, [mode, #1]
    cmp     w2, #'b'
    b.ne    Loriginal
    ldrb    w2, [mode, #2]
    cbnz    w2, Loriginal

    mov     filename_len, #0
    mov     x0, filename
Lstrlen_loop:
    ldrb    w2, [x0], #1
    cbz     w2, Lstrlen_done
    add     filename_len, filename_len, #1
    tbnz    filename_len, #7, Loriginal
    b       Lstrlen_loop
Lstrlen_done:

    cmp     filename_len, #7
    b.lt    Loriginal
    add     x0, filename, filename_len
    sub     x0, x0, #7
    ldr     x2, [x0]
    movz    x3, #0x632E, lsl #0
    movk    x3, #0x696C, lsl #16
    movk    x3, #0x6E65, lsl #32
    movk    x3, #0x0074, lsl #48
    cmp     x2, x3
    b.ne    Loriginal

    // Build prefix + filename on stack
    mov     x0, sp
    adr     x1, Lprefix_ptr
    ldr     x1, [x1]
Lprefix_loop:
    ldrb    w2, [x1], #1
    strb    w2, [x0], #1
    cbnz    w2, Lprefix_loop

    sub     x0, x0, #1
    mov     x1, filename
Lfilename_loop:
    ldrb    w2, [x1], #1
    strb    w2, [x0], #1
    cbnz    w2, Lfilename_loop

    // Try modded path first
    mov     x0, sp
    mov     x1, mode
    blr     fopen_org
    cbnz    x0, Lreturn

Loriginal:
    mov     x0, filename
    mov     x1, mode
    blr     fopen_org

Lreturn:
    add     sp, sp, #buffer_size
    ldp     filename_len, fopen_org, [sp], #16
    ldp     filename, mode, [sp], #16
    ldp     fp, lr, [sp], #16
    ret

// --- data ---
Lfopen_org:
    .quad   0xDEAD1234DEAD5678

Lprefix_ptr:
    .quad   0xDEAD0000DEAD0000

_payload_blob_end:
)");

extern "C" {
    extern unsigned char payload_blob_beg[];
    extern unsigned char payload_blob_end[];
}

static constexpr size_t WAD_VERIFY_SIZE = 272;
static constexpr size_t HOOK_OFFSET = 8;
static constexpr size_t PATH_BUFFER_SIZE = 256;
static constexpr uint64_t PREFIX_PLACEHOLDER = 0xDEAD0000DEAD0000;

struct Payload_import_stub {
    uint32_t adrp;
    uint32_t add;
    uint32_t br;

    static Payload_import_stub create(uint64_t from, uint64_t to) {
        const int64_t page_diff = (int64_t)((to & ~0xFFF) - (from & ~0xFFF)) >> 12;
        if (page_diff < -0x100000 || page_diff > 0xFFFFF) {
            throw std::runtime_error("Import stub offset too big");
        }
        const uint32_t imm21 = page_diff & 0x1FFFFF;
        const uint32_t immlo = (imm21 & 0x3) << 29;
        const uint32_t immhi = ((imm21 >> 2) & 0x7FFFF) << 5;
        return Payload_import_stub{
            .adrp = (uint32_t)(0x90000010 | immhi | immlo),
            .add = (uint32_t)(0x91000210 | ((to & 0xFFF) << 10)),
            .br = (uint32_t)(0xD61F0200),
        };
    }
};

static PtrStorage find_wad_verify(const uint8_t* text_beg, const uint8_t* text_end, uint64_t text_addr) {
    uint8_t const PATTERN[] = {0xC3, 0x24, 0x80, 0x52, 0x04, 0x20, 0x80, 0x52};
    const auto i = std::search(text_beg, text_end, std::begin(PATTERN), std::end(PATTERN));
    if ((text_end - i) < (int64_t)(sizeof(PATTERN) + 4)) return 0;

    const uint8_t* text_bl = i + sizeof(PATTERN);
    const uint32_t instr = *(uint32_t const*)text_bl;
    const uint32_t opcode = instr & 0xFC000000;
    if (opcode != 0x94000000 && opcode != 0x14000000) return 0;
    const int32_t offset = (int32_t)(instr << 6) >> 6;
    const uint64_t bl_offset = text_bl - text_beg;
    const uint64_t bl_pc = text_addr + bl_offset;
    return bl_pc + (int64_t)offset * 4;
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
        macho.parse_data_arm64((MachO::data_t)data.data(), data.size());

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
        // arm64: MOV X0, #1 (0xD2800020) + RET (0xD65F03C0)
        uint8_t bypass_sig[] = {0x20, 0x00, 0x80, 0xD2, 0xC0, 0x03, 0x5F, 0xD6};
        uint8_t existing[8] = {};
        auto ptr = (void*)(uintptr_t)process.Rebase(off_wad_verify);
        return process.TryReadMemory(ptr, existing, 8)
            && memcmp(existing, bypass_sig, 8) == 0;
    }

    auto patch(Process const& process, std::string const& prefix) -> void {
        if (check_already_patched(process))
            throw std::runtime_error("Process is already patched");

        auto const blob_size = (size_t)(payload_blob_end - payload_blob_beg);
        if (blob_size > WAD_VERIFY_SIZE) {
            lol_throw_msg("Payload too big: {} bytes (max {})", blob_size, WAD_VERIFY_SIZE);
        }

        struct PayloadRegion { uint8_t data[WAD_VERIFY_SIZE]; };
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
        memcpy(payload.data, payload_blob_beg, blob_size);

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
    auto const blob_size = (size_t)(payload_blob_end - payload_blob_beg);
    logi("Payload size: {} bytes (max {})", blob_size, WAD_VERIFY_SIZE);
    if (blob_size > WAD_VERIFY_SIZE) {
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
