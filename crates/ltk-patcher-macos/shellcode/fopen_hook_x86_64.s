.text

.global _fopen_hook_shellcode_beg
.global _fopen_hook_shellcode_end

.set buffer_size, 0x200

# Register assignments:
# %r12 = filename
# %r13 = mode  
# %r14 = filename_len

.p2align 8
_fopen_hook_shellcode_beg:
Lsetup:
    push    %rbp
    mov     %rsp, %rbp
    push    %r12
    push    %r13
    push    %r14
    sub     $buffer_size, %rsp
    mov     %rdi, %r12              # filename = arg0
    mov     %rsi, %r13              # mode = arg1

Lcheck_args_not_null:
    test    %r12, %r12              # if (!filename)
    je      Lcall_with_filename
    test    %r13, %r13              # if (!mode)
    je      Lcall_with_filename

Lcheck_mode_eq_rb:
    cmpb    $'r', (%r13)            # if (mode[0] != 'r')
    jne     Lcall_with_filename
    cmpb    $'b', 1(%r13)           # if (mode[1] != 'b')
    jne     Lcall_with_filename
    cmpb    $0, 2(%r13)             # if (mode[2] != '\0')
    jne     Lcall_with_filename

Lget_filename_length:
    xor     %r14, %r14              # filename_len = 0
    mov     %r12, %rdi              # ptr = filename
    Lget_filename_length_continue:
        movzbl  (%rdi), %eax
        test    %al, %al
        je      Lget_filename_length_break
        inc     %r14                # filename_len++
        inc     %rdi
        cmp     $0x80, %r14         # if (filename_len >= 128)
        jge     Lcall_with_filename
        jmp     Lget_filename_length_continue
Lget_filename_length_break:

Lcheck_suffix:
    cmp     $7, %r14                # if (filename_len < 7) // strlen(".client")
    jl      Lcall_with_filename

    lea     (%r12, %r14, 1), %rdi   # ptr = filename + filename_len - 7
    sub     $7, %rdi
    mov     (%rdi), %rax            # load 8 bytes
    movabs  $0x00746E65696C632E, %rcx   # ".client\0" in little-endian
    cmp     %rcx, %rax
    jne     Lcall_with_filename

Lwrite_prefix:
    mov     %rsp, %rdi              # dst = buffer
    lea     Lprefix(%rip), %rsi     # src = prefix
    Lwrite_prefix_continue:
        lodsb
        stosb
        test    %al, %al
        jne     Lwrite_prefix_continue

Lwrite_filename:
    dec     %rdi                    # dst = buffer[strlen(buffer)]
    mov     %r12, %rsi              # src = filename
    Lwrite_filename_continue:
        lodsb
        stosb
        test    %al, %al
        jne     Lwrite_filename_continue

Lcall_with_buffer:
    mov     %rsp, %rdi              # arg0 = buffer
    mov     %r13, %rsi              # arg1 = mode
    mov     Lfopen_org_ref(%rip), %rax
    call    *(%rax)                 # Stack is 16-byte aligned here
    test    %rax, %rax
    jne     Lreturn

Lcall_with_filename:
    mov     %r12, %rdi              # arg0 = filename
    mov     %r13, %rsi              # arg1 = mode
    mov     Lfopen_org_ref(%rip), %rax
    call    *(%rax)                 # Stack is 16-byte aligned here

Lreturn:
    add     $buffer_size, %rsp
    pop     %r14
    pop     %r13
    pop     %r12
    pop     %rbp
    ret

.p2align 8
_fopen_hook_shellcode_end:

Lfopen_org_ref:
    .quad   0x11223344556677

Lprefix:
    .quad   0x11223344556677
