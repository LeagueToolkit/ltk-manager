#include <algorithm>
#include <array>
#include <arpa/inet.h>
#include <cerrno>
#include <chrono>
#include <csignal>
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <limits>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <thread>
#include <vector>

#include <libproc.h>
#include <mach/mach.h>
#include <mach/mach_vm.h>
#include <mach-o/fat.h>
#include <mach-o/loader.h>
#include <mach-o/nlist.h>
#include <unistd.h>

namespace fs = std::filesystem;
using namespace std::chrono_literals;

#if defined(__aarch64__) || defined(__arm64__)
struct PayloadFopenHook {
    unsigned char fopen_hook[0x100] = {};
    std::uint64_t fopen_org_ptr = {};
    char prefix[0x100] = {};
    std::uint64_t fopen_hook_ptr = {};
};

__asm__(R"(
.text

.global _fopen_hook_shellcode_beg
.global _fopen_hook_shellcode_end

.set buffer_size, 0x200

filename .req x19
mode .req x20
filename_len .req x21
fopen_org .req x22

.p2align 8
_fopen_hook_shellcode_beg:
    stp     fp, lr, [sp, #-16]!
    mov     fp, sp
    stp     filename, mode, [sp, #-16]!
    stp     filename_len, fopen_org, [sp, #-16]!
    sub     sp, sp, #buffer_size

    mov     filename, x0
    mov     mode, x1

    adr     fopen_org, Lfopen_org_ref
    ldr     fopen_org, [fopen_org]
    ldr     fopen_org, [fopen_org]

Lcheck_args_not_null:
    cbz     filename, Lcall_with_filename
    cbz     mode, Lcall_with_filename

Lcheck_mode_eq_rb:
    ldrb    w2, [mode]
    cmp     w2, #'r'
    b.ne    Lcall_with_filename
    ldrb    w2, [mode, #1]
    cmp     w2, #'b'
    b.ne    Lcall_with_filename
    ldrb    w2, [mode, #2]
    cbnz    w2, Lcall_with_filename

Lget_filename_length:
    mov     filename_len, #0
    mov     x0, filename
    Lget_filename_length_continue:
        ldrb    w2, [x0], #1
        cbz     w2, Lget_filename_length_break
        add     filename_len, filename_len, #1
        cmp     filename_len, 0x80
        b.ge    Lcall_with_filename
        b       Lget_filename_length_continue
Lget_filename_length_break:

Lcheck_suffix:
    cmp     filename_len, #7
    b.lt    Lcall_with_filename

    add     x0, filename, filename_len
    sub     x0, x0, #7
    ldr     x2, [x0]
    movz    x3, #0x632E, lsl #0
    movk    x3, #0x696C, lsl #16
    movk    x3, #0x6E65, lsl #32
    movk    x3, #0x0074, lsl #48
    cmp     x2, x3
    b.ne    Lcall_with_filename

Lwrite_prefix:
    mov     x0, sp
    adr     x1, Lprefix
    Lwrite_prefix_continue:
        ldrb    w2, [x1], #1
        strb    w2, [x0], #1
        cbnz    w2, Lwrite_prefix_continue

Lwrite_filename:
    sub     x0, x0, #1
    mov     x1, filename
    Lwrite_filename_continue:
        ldrb    w2, [x1], #1
        strb    w2, [x0], #1
        cbnz    w2, Lwrite_filename_continue

Lcall_with_buffer:
    mov     x0, sp
    mov     x1, mode
    blr     fopen_org
    cbnz    x0, Lreturn

Lcall_with_filename:
    mov     x0, filename
    mov     x1, mode
    blr     fopen_org

Lreturn:
    add     sp, sp, #buffer_size
    ldp     filename_len, fopen_org, [sp], #16
    ldp     filename, mode, [sp], #16
    ldp     fp, lr, [sp], #16
    ret

.p2align 8
_fopen_hook_shellcode_end:
Lfopen_org_ref:
    .quad   0x11223344556677

Lprefix:
    .quad   0x11223344556677
)");

extern "C" {
extern unsigned char fopen_hook_shellcode_beg[];
extern unsigned char fopen_hook_shellcode_end[];
}

struct PayloadWadVerify {
    unsigned char return_true[0x8] = {
        0x20, 0x00, 0x80, 0xD2, 0xC0, 0x03, 0x5F, 0xD6,
    };
    std::uint64_t fopen_hook_ptr = {};
};

struct PayloadImportStub {
    std::uint32_t adrp = {};
    std::uint32_t ldr = {};
    std::uint32_t br = {};

    static PayloadImportStub create(std::uint64_t from, std::uint64_t to) {
        const std::int64_t page_diff =
            static_cast<std::int64_t>((to & ~0xFFFull) - (from & ~0xFFFull)) >> 12;
        if (page_diff < -0x100000 || page_diff > 0xFFFFF) {
            throw std::runtime_error("import stub offset too large");
        }
        const std::uint32_t imm21 = static_cast<std::uint32_t>(page_diff) & 0x1FFFFF;
        const std::uint32_t immlo = (imm21 & 0x3) << 29;
        const std::uint32_t immhi = ((imm21 >> 2) & 0x7FFFF) << 5;
        return PayloadImportStub{
            static_cast<std::uint32_t>(0x90000010 | immhi | immlo),
            static_cast<std::uint32_t>(0xF9400210 | (((to & 0xFFF) >> 3) << 10)),
            0xD61F0200,
        };
    }
};

static std::uint64_t find_wad_verify(
    const std::uint8_t* text_beg,
    const std::uint8_t* text_end,
    std::uint64_t text_addr) {
    const std::uint8_t pattern[] = {
        0xC3, 0x24, 0x80, 0x52, 0x04, 0x20, 0x80, 0x52,
    };
    const auto it = std::search(text_beg, text_end, std::begin(pattern), std::end(pattern));
    if ((text_end - it) < static_cast<std::ptrdiff_t>(sizeof(pattern) + 4)) {
        return 0;
    }

    const std::uint8_t* text_bl = it + sizeof(pattern);
    std::uint32_t instr = 0;
    std::memcpy(&instr, text_bl, sizeof(instr));
    const std::uint32_t opcode = instr & 0xFC000000;
    if (opcode != 0x94000000 && opcode != 0x14000000) {
        return 0;
    }

    const std::int32_t offset = static_cast<std::int32_t>(instr << 6) >> 6;
    const std::uint64_t bl_offset = static_cast<std::uint64_t>(text_bl - text_beg);
    const std::uint64_t bl_pc = text_addr + bl_offset;
    return bl_pc + static_cast<std::int64_t>(offset) * 4;
}
#else
#error The macOS process patcher supports Apple Silicon arm64 only
#endif

struct SectionInfo {
    const section_64* section = nullptr;
    const std::uint8_t* data = nullptr;
};

struct MachOScan {
    std::uint64_t wad_verify = 0;
    std::uint64_t fopen_ptr = 0;
    std::uint64_t fopen_stub = 0;
    std::string arch;
};

enum class PatchMode {
    All,
};

struct Options {
    PatchMode mode = PatchMode::All;
    pid_t parent_pid = 0;
    const char* overlay_root = nullptr;
};

struct Process {
    mach_port_t task = MACH_PORT_NULL;
    pid_t pid = 0;

    explicit Process(pid_t p) : pid(p) {
        if (task_for_pid(mach_task_self(), pid, &task) != KERN_SUCCESS) {
            throw std::runtime_error("task_for_pid failed. Run with the required macOS debugging permission or as a permitted development build.");
        }
    }

    Process(const Process&) = delete;
    Process& operator=(const Process&) = delete;

    ~Process() {
        if (task != MACH_PORT_NULL) {
            mach_port_deallocate(mach_task_self(), task);
        }
    }

    std::uint64_t base() const {
        mach_vm_address_t address = 0;
        mach_vm_size_t size = 0;
        natural_t depth = 0;
        vm_region_submap_info_data_64_t info = {};
        mach_msg_type_number_t count = VM_REGION_SUBMAP_INFO_COUNT_64;
        const auto kr = mach_vm_region_recurse(
            task,
            &address,
            &size,
            &depth,
            reinterpret_cast<vm_region_recurse_info_t>(&info),
            &count);
        if (kr != KERN_SUCCESS) {
            throw std::runtime_error("mach_vm_region_recurse failed");
        }
        return address - 0x100000000ull;
    }

    void* allocate(std::size_t size) const {
        mach_vm_address_t address = 0;
        const auto kr = mach_vm_allocate(task, &address, size, VM_FLAGS_ANYWHERE);
        if (kr != KERN_SUCCESS) {
            throw std::runtime_error("mach_vm_allocate failed");
        }
        return reinterpret_cast<void*>(address);
    }

    void write(std::uint64_t address, const void* source, std::size_t size) const {
        const auto kr = mach_vm_write(
            task,
            static_cast<mach_vm_address_t>(address),
            reinterpret_cast<vm_offset_t>(source),
            static_cast<mach_msg_type_number_t>(size));
        if (kr != KERN_SUCCESS) {
            throw std::runtime_error("mach_vm_write failed");
        }
    }

    std::vector<std::uint8_t> read(std::uint64_t address, std::size_t size) const {
        std::vector<std::uint8_t> buffer(size);
        mach_vm_size_t copied = 0;
        const auto kr = mach_vm_read_overwrite(
            task,
            static_cast<mach_vm_address_t>(address),
            static_cast<mach_vm_size_t>(size),
            reinterpret_cast<mach_vm_address_t>(buffer.data()),
            &copied);
        if (kr != KERN_SUCCESS) {
            throw std::runtime_error("mach_vm_read_overwrite failed");
        }
        buffer.resize(static_cast<std::size_t>(copied));
        return buffer;
    }

    void mark_writable(std::uint64_t address, std::size_t size) const {
        const auto kr = mach_vm_protect(
            task,
            static_cast<mach_vm_address_t>(address),
            static_cast<mach_vm_size_t>(size),
            FALSE,
            VM_PROT_READ | VM_PROT_WRITE | VM_PROT_COPY);
        if (kr != KERN_SUCCESS) {
            throw std::runtime_error("mach_vm_protect writable failed");
        }
    }

    void mark_executable(std::uint64_t address, std::size_t size) const {
        const auto kr = mach_vm_protect(
            task,
            static_cast<mach_vm_address_t>(address),
            static_cast<mach_vm_size_t>(size),
            FALSE,
            VM_PROT_READ | VM_PROT_EXECUTE);
        if (kr != KERN_SUCCESS) {
            throw std::runtime_error("mach_vm_protect executable failed");
        }
    }
};

static bool ends_with(std::string_view value, std::string_view suffix) {
    return value.size() >= suffix.size() &&
           value.compare(value.size() - suffix.size(), suffix.size(), suffix) == 0;
}

static pid_t find_league_pid() {
    std::array<pid_t, 4096> pids = {};
    const int bytes = proc_listpids(PROC_ALL_PIDS, 0, pids.data(), static_cast<int>(pids.size() * sizeof(pid_t)));
    const int count = bytes / static_cast<int>(sizeof(pid_t));
    char path[PROC_PIDPATHINFO_MAXSIZE] = {};

    for (int i = 0; i < count; ++i) {
        if (pids[i] <= 0) {
            continue;
        }
        const int len = proc_pidpath(pids[i], path, sizeof(path));
        if (len > 0 && ends_with(std::string_view(path, static_cast<std::size_t>(len)), "/LeagueofLegends")) {
            return pids[i];
        }
    }
    return 0;
}

static bool process_exited(const Process& process) {
    int pid = 0;
    pid_for_task(process.task, &pid);
    return pid <= 0;
}

static std::vector<std::uint8_t> read_file(const fs::path& path) {
    std::ifstream stream(path, std::ios::binary);
    if (!stream) {
        throw std::runtime_error("failed to open game executable");
    }
    return std::vector<std::uint8_t>(
        std::istreambuf_iterator<char>(stream),
        std::istreambuf_iterator<char>());
}

static fs::path process_path(pid_t pid) {
    char path[PROC_PIDPATHINFO_MAXSIZE] = {};
    const int len = proc_pidpath(pid, path, sizeof(path));
    if (len <= 0) {
        throw std::runtime_error("proc_pidpath failed");
    }
    return fs::path(std::string(path, path + len));
}

static std::uint32_t target_cpu_type() {
    return CPU_TYPE_ARM64;
}

static const char* cpu_type_name(std::uint32_t cpu_type) {
    switch (cpu_type) {
    case CPU_TYPE_ARM64:
        return "arm64";
    default:
        return "unknown";
    }
}

static std::pair<const std::uint8_t*, std::size_t> select_macho_slice(const std::vector<std::uint8_t>& file) {
    if (file.size() < sizeof(std::uint32_t)) {
        throw std::runtime_error("game executable is too small");
    }

    std::uint32_t magic = 0;
    std::memcpy(&magic, file.data(), sizeof(magic));
    if (magic == MH_MAGIC_64) {
        return {file.data(), file.size()};
    }

    if (magic != FAT_CIGAM && magic != FAT_MAGIC) {
        throw std::runtime_error("unsupported Mach-O magic");
    }

    const bool swap = magic == FAT_CIGAM;
    auto read_be = [swap](std::uint32_t value) {
        return swap ? ntohl(value) : value;
    };

    const auto* header = reinterpret_cast<const fat_header*>(file.data());
    const auto arch_count = read_be(header->nfat_arch);
    const auto* arch = reinterpret_cast<const fat_arch*>(file.data() + sizeof(fat_header));
    for (std::uint32_t i = 0; i < arch_count; ++i) {
        if (reinterpret_cast<const std::uint8_t*>(&arch[i + 1]) > file.data() + file.size()) {
            break;
        }
        if (read_be(static_cast<std::uint32_t>(arch[i].cputype)) == target_cpu_type()) {
            const auto offset = read_be(arch[i].offset);
            const auto size = read_be(arch[i].size);
            if (offset > file.size() || size > file.size() - offset) {
                throw std::runtime_error("invalid fat Mach-O slice bounds");
            }
            return {file.data() + offset, size};
        }
    }

    throw std::runtime_error("no matching architecture slice in game executable");
}

static bool section_name_eq(const char name[16], const char* expected) {
    return std::strncmp(name, expected, 16) == 0;
}

static const char* symbol_name(
    const std::uint8_t* macho,
    const symtab_command* symtab,
    std::uint32_t index) {
    const auto* symbols = reinterpret_cast<const nlist_64*>(macho + symtab->symoff);
    const auto strx = symbols[index].n_un.n_strx;
    return reinterpret_cast<const char*>(macho + symtab->stroff + strx);
}

static bool symbol_is_fopen(
    const std::uint8_t* macho,
    const symtab_command* symtab,
    std::uint32_t index) {
    if (index == INDIRECT_SYMBOL_ABS || index == INDIRECT_SYMBOL_LOCAL ||
        (index & INDIRECT_SYMBOL_LOCAL) != 0) {
        return false;
    }
    if (index >= symtab->nsyms) {
        return false;
    }
    return std::strcmp(symbol_name(macho, symtab, index), "_fopen") == 0;
}

static MachOScan scan_macho(const std::vector<std::uint8_t>& file) {
    const auto [macho, macho_size] = select_macho_slice(file);
    if (macho_size < sizeof(mach_header_64)) {
        throw std::runtime_error("Mach-O slice is too small");
    }

    const auto* header = reinterpret_cast<const mach_header_64*>(macho);
    if (header->magic != MH_MAGIC_64) {
        throw std::runtime_error("expected 64-bit Mach-O");
    }

    const std::uint8_t* command_ptr = macho + sizeof(mach_header_64);
    const symtab_command* symtab = nullptr;
    const dysymtab_command* dysymtab = nullptr;
    SectionInfo text;
    std::vector<const section_64*> pointer_sections;
    std::vector<const section_64*> stub_sections;

    for (std::uint32_t i = 0; i < header->ncmds; ++i) {
        const auto* command = reinterpret_cast<const load_command*>(command_ptr);
        if (command_ptr + sizeof(load_command) > macho + macho_size ||
            command_ptr + command->cmdsize > macho + macho_size) {
            throw std::runtime_error("invalid Mach-O load command bounds");
        }

        if (command->cmd == LC_SEGMENT_64) {
            const auto* segment = reinterpret_cast<const segment_command_64*>(command_ptr);
            const auto* section = reinterpret_cast<const section_64*>(command_ptr + sizeof(segment_command_64));
            for (std::uint32_t s = 0; s < segment->nsects; ++s) {
                if (reinterpret_cast<const std::uint8_t*>(&section[s + 1]) > command_ptr + command->cmdsize) {
                    break;
                }
                const std::uint32_t section_type = section[s].flags & SECTION_TYPE;
                if (section_name_eq(section[s].segname, "__TEXT") &&
                    section_name_eq(section[s].sectname, "__text")) {
                    if (section[s].offset > macho_size || section[s].size > macho_size - section[s].offset) {
                        throw std::runtime_error("__text section has invalid bounds");
                    }
                    text = SectionInfo{&section[s], macho + section[s].offset};
                } else if (section_type == S_LAZY_SYMBOL_POINTERS ||
                           section_type == S_NON_LAZY_SYMBOL_POINTERS) {
                    pointer_sections.push_back(&section[s]);
                } else if (section_type == S_SYMBOL_STUBS) {
                    stub_sections.push_back(&section[s]);
                }
            }
        } else if (command->cmd == LC_SYMTAB) {
            symtab = reinterpret_cast<const symtab_command*>(command_ptr);
        } else if (command->cmd == LC_DYSYMTAB) {
            dysymtab = reinterpret_cast<const dysymtab_command*>(command_ptr);
        }

        command_ptr += command->cmdsize;
    }

    if (!text.section || !symtab || !dysymtab) {
        throw std::runtime_error("failed to find required Mach-O sections");
    }
    if (symtab->symoff > macho_size || symtab->stroff > macho_size ||
        dysymtab->indirectsymoff > macho_size) {
        throw std::runtime_error("invalid Mach-O symbol table bounds");
    }

    const auto* indirect = reinterpret_cast<const std::uint32_t*>(macho + dysymtab->indirectsymoff);

    MachOScan result;
    result.arch = cpu_type_name(static_cast<std::uint32_t>(header->cputype));
    result.wad_verify = find_wad_verify(
        text.data,
        text.data + text.section->size,
        text.section->addr);

    for (const auto* section : pointer_sections) {
        const std::uint64_t count = section->size / sizeof(std::uint64_t);
        for (std::uint64_t i = 0; i < count; ++i) {
            const auto indirect_index = section->reserved1 + static_cast<std::uint32_t>(i);
            if (indirect_index >= dysymtab->nindirectsyms) {
                continue;
            }
            if (symbol_is_fopen(macho, symtab, indirect[indirect_index])) {
                result.fopen_ptr = section->addr + i * sizeof(std::uint64_t);
            }
        }
    }

    for (const auto* section : stub_sections) {
        const std::uint32_t stub_size = section->reserved2;
        if (stub_size == 0) {
            continue;
        }
        const std::uint64_t count = section->size / stub_size;
        for (std::uint64_t i = 0; i < count; ++i) {
            const auto indirect_index = section->reserved1 + static_cast<std::uint32_t>(i);
            if (indirect_index >= dysymtab->nindirectsyms) {
                continue;
            }
            if (symbol_is_fopen(macho, symtab, indirect[indirect_index])) {
                result.fopen_stub = section->addr + i * stub_size;
            }
        }
    }

    if (!result.wad_verify) {
        throw std::runtime_error("failed to find wad_verify call");
    }
    if (!result.fopen_ptr) {
        throw std::runtime_error("failed to find fopen import pointer");
    }
    if (!result.fopen_stub) {
        throw std::runtime_error("failed to find fopen import stub");
    }
    return result;
}

static void patch_process(
    const Process& process,
    const MachOScan& scan,
    const std::string& prefix) {
    const auto base = process.base();
    const auto ptr_wad_verify = base + scan.wad_verify;
    const auto ptr_fopen_ptr = base + scan.fopen_ptr;
    const auto ptr_fopen_stub = base + scan.fopen_stub;

    PayloadFopenHook payload_fopen = {};
    const auto shellcode_size = static_cast<std::size_t>(
        fopen_hook_shellcode_end - fopen_hook_shellcode_beg);
    if (shellcode_size != sizeof(payload_fopen.fopen_hook)) {
        throw std::runtime_error("fopen hook shellcode has unexpected size");
    }

    const auto ptr_fopen_hook = reinterpret_cast<std::uint64_t>(process.allocate(sizeof(PayloadFopenHook)));
    const auto ptr_fopen_hook_ptr = ptr_fopen_hook + offsetof(PayloadFopenHook, fopen_hook_ptr);
    std::memcpy(payload_fopen.fopen_hook, fopen_hook_shellcode_beg, shellcode_size);
    payload_fopen.fopen_org_ptr = ptr_fopen_ptr;
    std::memcpy(payload_fopen.prefix, prefix.c_str(), prefix.size() + 1);
    payload_fopen.fopen_hook_ptr = ptr_fopen_hook;

    const auto payload_stub = PayloadImportStub::create(ptr_fopen_stub, ptr_fopen_hook_ptr);

    process.mark_writable(ptr_fopen_hook, sizeof(payload_fopen));
    process.write(ptr_fopen_hook, &payload_fopen, sizeof(payload_fopen));
    process.mark_executable(ptr_fopen_hook, sizeof(payload_fopen));

    process.mark_writable(ptr_fopen_stub, sizeof(payload_stub));
    process.write(ptr_fopen_stub, &payload_stub, sizeof(payload_stub));
    process.mark_executable(ptr_fopen_stub, sizeof(payload_stub));

    PayloadWadVerify payload_wad_verify = {};

    process.mark_writable(ptr_wad_verify, sizeof(payload_wad_verify.return_true));
    process.write(ptr_wad_verify, &payload_wad_verify.return_true, sizeof(payload_wad_verify.return_true));
    process.mark_executable(ptr_wad_verify, sizeof(payload_wad_verify.return_true));
}

static std::string normalized_prefix(const char* path_arg) {
    auto path = fs::absolute(fs::path(path_arg).lexically_normal()).generic_string();
    if (!ends_with(path, "/")) {
        path.push_back('/');
    }
    if (path.size() >= sizeof(PayloadFopenHook::prefix)) {
        throw std::runtime_error("overlay path is too long for patcher payload");
    }
    return path;
}

static void print_usage(const char* argv0) {
    std::cerr
        << "usage: " << argv0 << " [--parent-pid <pid>] <overlay-root>\n";
}

static Options parse_options(int argc, char** argv) {
    Options options;
    for (int i = 1; i < argc; ++i) {
        const std::string_view arg(argv[i]);
        if (arg == "--parent-pid") {
            if (i + 1 >= argc) {
                throw std::runtime_error("missing --parent-pid value");
            }
            options.parent_pid = static_cast<pid_t>(std::stol(argv[++i]));
        } else if (!arg.empty() && arg[0] == '-') {
            throw std::runtime_error("unknown option: " + std::string(arg));
        } else if (!options.overlay_root) {
            options.overlay_root = argv[i];
        } else {
            throw std::runtime_error("multiple overlay roots provided");
        }
    }

    if (!options.overlay_root) {
        throw std::runtime_error("missing overlay root");
    }
    return options;
}

static bool parent_is_alive(pid_t parent_pid) {
    if (parent_pid <= 0) {
        return true;
    }
    if (kill(parent_pid, 0) == 0) {
        return true;
    }
    return errno == EPERM;
}

int main(int argc, char** argv) {
    try {
        const auto options = parse_options(argc, argv);
        const auto prefix = normalized_prefix(options.overlay_root);
        bool printed_wait = false;

        for (;;) {
            if (!parent_is_alive(options.parent_pid)) {
                std::cout << "parent process exited; stopping patcher\n" << std::flush;
                return 0;
            }

            const pid_t pid = find_league_pid();
            if (!pid) {
                if (!printed_wait) {
                    std::cout << "waiting for LeagueofLegends\n" << std::flush;
                    printed_wait = true;
                }
                std::this_thread::sleep_for(10ms);
                continue;
            }

            printed_wait = false;
            std::cout << "found LeagueofLegends pid=" << pid << "\n" << std::flush;

            const auto exe = process_path(pid);
            const auto file = read_file(exe);
            const auto scan = scan_macho(file);
            const Process process(pid);

            patch_process(process, scan, prefix);

            std::cout << "patched LeagueofLegends pid=" << pid << "\n" << std::flush;

            while (!process_exited(process)) {
                if (!parent_is_alive(options.parent_pid)) {
                    std::cout << "parent process exited; stopping patcher\n" << std::flush;
                    return 0;
                }
                std::this_thread::sleep_for(1s);
            }
            std::cout << "LeagueofLegends exited\n" << std::flush;
        }
    } catch (const std::exception& e) {
        print_usage(argv[0]);
        std::cerr << "ltk_macos_process_patcher: " << e.what() << "\n";
        return 1;
    }
}
