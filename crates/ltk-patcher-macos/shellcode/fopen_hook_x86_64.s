.text

.global _fopen_hook_shellcode_beg
.global _fopen_hook_shellcode_end

.set buffer_size, 0x200

# %r12 = filename, %r13 = mode, %r14 = filename_len
# The data region (fopen pointer + prefix) is reached through the absolute
# pointer baked into Ldata_ptr at the end of the shellcode.

.p2align 4
_fopen_hook_shellcode_beg:
Lsetup:
    push    %rbp
    mov     %rsp, %rbp
    push    %r12
    push    %r13
    push    %r14
    sub     $buffer_size, %rsp
    mov     %rdi, %r12
    mov     %rsi, %r13

Lcheck_args_not_null:
    test    %r12, %r12
    je      Lcall_with_filename
    test    %r13, %r13
    je      Lcall_with_filename

Lcheck_mode_eq_rb:
    cmpb    $'r', (%r13)
    jne     Lcall_with_filename
    cmpb    $'b', 1(%r13)
    jne     Lcall_with_filename
    cmpb    $0, 2(%r13)
    jne     Lcall_with_filename

Lget_filename_length:
    xor     %r14, %r14
    mov     %r12, %rdi
    Lget_filename_length_continue:
        movzbl  (%rdi), %eax
        test    %al, %al
        je      Lget_filename_length_break
        inc     %r14
        inc     %rdi
        cmp     $0x80, %r14
        jge     Lcall_with_filename
        jmp     Lget_filename_length_continue
Lget_filename_length_break:

Lcheck_suffix:
    cmp     $7, %r14
    jl      Lcall_with_filename

    lea     (%r12, %r14, 1), %rdi
    sub     $7, %rdi
    mov     (%rdi), %rax
    movabs  $0x00746E65696C632E, %rcx   # ".client\0"
    cmp     %rcx, %rax
    jne     Lcall_with_filename

Lwrite_prefix:
    mov     %rsp, %rdi                  # dst = buffer
    mov     Ldata_ptr(%rip), %rsi       # rsi = data region address
    add     $8, %rsi                    # src = data + 8 = prefix string
    Lwrite_prefix_continue:
        lodsb
        stosb
        test    %al, %al
        jne     Lwrite_prefix_continue

Lwrite_filename:
    dec     %rdi
    mov     %r12, %rsi
    Lwrite_filename_continue:
        lodsb
        stosb
        test    %al, %al
        jne     Lwrite_filename_continue

Lcall_with_buffer:
    mov     %rsp, %rdi
    mov     %r13, %rsi
    mov     Ldata_ptr(%rip), %rax       # rax = data region address
    mov     (%rax), %rax                # rax = *(data) = &fopen (GOT addr)
    call    *(%rax)
    test    %rax, %rax
    jne     Lreturn

Lcall_with_filename:
    mov     %r12, %rdi
    mov     %r13, %rsi
    mov     Ldata_ptr(%rip), %rax
    mov     (%rax), %rax
    call    *(%rax)

Lreturn:
    add     $buffer_size, %rsp
    pop     %r14
    pop     %r13
    pop     %r12
    pop     %rbp
    ret

.p2align 3
Ldata_ptr:
    .quad   0x1122334455667788
_fopen_hook_shellcode_end:
