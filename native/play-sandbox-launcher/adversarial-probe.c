#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <winsock2.h>
#include <ws2tcpip.h>
#include <stdio.h>
#include <wchar.h>

static int can_read(const wchar_t *path) {
    HANDLE file = CreateFileW(path, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
        NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    if (file == INVALID_HANDLE_VALUE) return 0;
    CloseHandle(file);
    return 1;
}

static int can_write(const wchar_t *path) {
    HANDLE file = CreateFileW(path, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
    if (file == INVALID_HANDLE_VALUE) return 0;
    CloseHandle(file);
    DeleteFileW(path);
    return 1;
}

static int can_spawn(void) {
    STARTUPINFOW startup;
    PROCESS_INFORMATION process;
    ZeroMemory(&startup, sizeof(startup));
    ZeroMemory(&process, sizeof(process));
    startup.cb = sizeof(startup);
    wchar_t command[] = L"cmd.exe /c exit 0";
    if (!CreateProcessW(NULL, command, NULL, NULL, FALSE, CREATE_NO_WINDOW, NULL, NULL, &startup, &process)) return 0;
    TerminateProcess(process.hProcess, 1);
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
    return 1;
}

static int connect_ipv4(const char *address_text, unsigned short port, int *error_out) {
    SOCKET socket_handle = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (socket_handle == INVALID_SOCKET) { *error_out = WSAGetLastError(); return 0; }
    u_long nonblocking = 1;
    ioctlsocket(socket_handle, FIONBIO, &nonblocking);
    struct sockaddr_in address;
    ZeroMemory(&address, sizeof(address));
    address.sin_family = AF_INET;
    address.sin_port = htons(port);
    if (inet_pton(AF_INET, address_text, &address.sin_addr) != 1) {
        *error_out = WSAEINVAL;
        closesocket(socket_handle);
        return 0;
    }
    int connected = connect(socket_handle, (struct sockaddr *)&address, sizeof(address)) == 0;
    int connect_error = connected ? 0 : WSAGetLastError();
    if (!connected && connect_error == WSAEWOULDBLOCK) {
        fd_set writable;
        FD_ZERO(&writable);
        FD_SET(socket_handle, &writable);
        struct timeval timeout = { 1, 0 };
        int selected = select(0, NULL, &writable, NULL, &timeout);
        if (selected > 0) {
            int socket_error = 0;
            int socket_error_size = sizeof(socket_error);
            getsockopt(socket_handle, SOL_SOCKET, SO_ERROR, (char *)&socket_error, &socket_error_size);
            connected = socket_error == 0;
            connect_error = socket_error;
        } else {
            connect_error = selected == 0 ? WSAETIMEDOUT : WSAGetLastError();
        }
    }
    *error_out = connect_error;
    closesocket(socket_handle);
    return connected;
}

static int can_resolve_dns(int *error_out) {
    struct addrinfo hints;
    struct addrinfo *result = NULL;
    ZeroMemory(&hints, sizeof(hints));
    hints.ai_family = AF_INET;
    hints.ai_socktype = SOCK_STREAM;
    int status = getaddrinfo("example.com", "443", &hints, &result);
    if (result) freeaddrinfo(result);
    *error_out = status;
    return status == 0;
}

static int can_open_process(DWORD pid) {
    if (!pid) return 0;
    HANDLE process = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, FALSE, pid);
    if (!process) return 0;
    CloseHandle(process);
    return 1;
}

static int can_open_named_pipe(const wchar_t *pipe_name) {
    if (!pipe_name || !pipe_name[0]) return 0;
    HANDLE pipe = CreateFileW(pipe_name, GENERIC_READ | GENERIC_WRITE, 0, NULL, OPEN_EXISTING, 0, NULL);
    if (pipe == INVALID_HANDLE_VALUE) return 0;
    CloseHandle(pipe);
    return 1;
}

static int can_load_external_dll(const wchar_t *dll_path) {
    if (!dll_path || !dll_path[0]) return 0;
    HMODULE module = LoadLibraryExW(dll_path, NULL, LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_SYSTEM32);
    if (!module) return 0;
    FreeLibrary(module);
    return 1;
}

static int write_oversized_output(const wchar_t *result_path) {
    FILE *result = _wfopen(result_path, L"wb");
    if (!result) return 13;
    for (int i = 0; i < 128 * 1024; i++) fputc('A', result);
    fclose(result);
    return 0;
}

int wmain(int argc, wchar_t **argv) {
    if (argc < 6) return 10;
    const wchar_t *result_path = argv[2];
    const wchar_t *outside_read = argv[3];
    const wchar_t *outside_write = argv[4];
    unsigned short port = (unsigned short)wcstoul(argv[5], NULL, 10);
    DWORD parent_pid = argc > 6 ? (DWORD)wcstoul(argv[6], NULL, 10) : 0;
    const wchar_t *pipe_name = argc > 7 ? argv[7] : L"";
    const wchar_t *dll_path = argc > 8 ? argv[8] : L"";
    const wchar_t *mode = argc > 9 ? argv[9] : L"base";
    if (!wcsncmp(mode, L"sleep:", 6)) Sleep((DWORD)wcstoul(mode + 6, NULL, 10));
    if (!wcscmp(mode, L"cpu")) { for (;;) { YieldProcessor(); } }
    if (!wcscmp(mode, L"memory")) {
        for (;;) {
            void *block = VirtualAlloc(NULL, 1024 * 1024, MEM_RESERVE | MEM_COMMIT, PAGE_READWRITE);
            if (!block) return 31;
            SecureZeroMemory(block, 1024 * 1024);
        }
    }
    if (!wcscmp(mode, L"crash")) TerminateProcess(GetCurrentProcess(), 32);
    if (!wcscmp(mode, L"output")) return write_oversized_output(result_path);
    wchar_t secret[16];
    DWORD secret_length = GetEnvironmentVariableW(L"TUGBERK_TEST_SECRET", secret, 16);
    FILE *result = _wfopen(result_path, L"wb");
    if (!result) return 13;
    WSADATA data;
    if (WSAStartup(MAKEWORD(2, 2), &data) != 0) return 14;
    int loopback_error = 0;
    int internet_error = 0;
    int lan_error = 0;
    int dns_error = 0;
    int loopback_authority = connect_ipv4("127.0.0.1", port, &loopback_error);
    int internet_authority = connect_ipv4("1.1.1.1", 443, &internet_error);
    int lan_authority = connect_ipv4("192.168.0.1", 445, &lan_error);
    int dns_authority = can_resolve_dns(&dns_error);
    WSACleanup();
    fprintf(result,
        "{\"outsideRead\":%s,\"outsideWrite\":%s,\"secretVisible\":%s,\"childSpawn\":%s,"
        "\"loopbackAuthority\":%s,\"loopbackError\":%d,\"internetAuthority\":%s,\"internetError\":%d,"
        "\"lanAuthority\":%s,\"lanError\":%d,\"dnsAuthority\":%s,\"dnsError\":%d,"
        "\"processHandle\":%s,\"namedPipe\":%s,\"externalDll\":%s}",
        can_read(outside_read) ? "true" : "false",
        can_write(outside_write) ? "true" : "false",
        secret_length ? "true" : "false",
        can_spawn() ? "true" : "false",
        loopback_authority ? "true" : "false", loopback_error,
        internet_authority ? "true" : "false", internet_error,
        lan_authority ? "true" : "false", lan_error,
        dns_authority ? "true" : "false", dns_error,
        can_open_process(parent_pid) ? "true" : "false",
        can_open_named_pipe(pipe_name) ? "true" : "false",
        can_load_external_dll(dll_path) ? "true" : "false");
    fclose(result);
    return 0;
}
