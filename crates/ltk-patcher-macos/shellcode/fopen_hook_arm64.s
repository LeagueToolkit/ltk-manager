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

    adr     fopen_org, Lfopen_org_ref    ; fopen_org = (function**)&fopen_org_ref
    ldr     fopen_org, [fopen_org]       ; fopen_org = *fopen_org
    ldr     fopen_org, [fopen_org]       ; fopen_org

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
        cmp     filename_len, 0x80      ; check filename length
        b.ge    Lcall_with_filename
        b       Lget_filename_length_continue
Lget_filename_length_break:

Lcheck_suffix:
    cmp     filename_len, #7         ; strlen(".client") = 7
    b.lt    Lcall_with_filename

    add     x0, filename, filename_len
    sub     x0, x0, #7               ; ptr to last 7 chars + null
    ldr     x2, [x0]                 ; load 8 bytes
    movz    x3, #0x632E, lsl #0      ; ".c"
    movk    x3, #0x696C, lsl #16     ; "li"
    movk    x3, #0x6E65, lsl #32     ; "en"
    movk    x3, #0x0074, lsl #48     ; "t\0"
    cmp     x2, x3
    b.ne    Lcall_with_filename

Lwrite_prefix:
    mov     x0, sp                   ; dst = buffer
    adr     x1, Lprefix              ; src = &prefix
    Lwrite_prefix_continue:
        ldrb    w2, [x1], #1
        strb    w2, [x0], #1
        cbnz    w2, Lwrite_prefix_continue

Lwrite_filename:
    sub     x0, x0, #1               ; dst = buffer[strlen(buffer)]
    mov     x1, filename             ; src = filename
    Lwrite_filename_continue:
        ldrb    w2, [x1], #1
        strb    w2, [x0], #1
        cbnz    w2, Lwrite_filename_continue

Lcall_with_buffer:
    mov     x0, sp                   ; filename = buffer
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
