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

static int network_error = 0;
static int can_connect_loopback(unsigned short port) {
    WSADATA data;
    if (WSAStartup(MAKEWORD(2, 2), &data) != 0) return 0;
    SOCKET socket_handle = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (socket_handle == INVALID_SOCKET) { WSACleanup(); return 0; }
    u_long nonblocking = 1;
    ioctlsocket(socket_handle, FIONBIO, &nonblocking);
    struct sockaddr_in address;
    ZeroMemory(&address, sizeof(address));
    address.sin_family = AF_INET;
    address.sin_port = htons(port);
    address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
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
    network_error = connect_error;
    closesocket(socket_handle);
    WSACleanup();
    return connected;
}

int wmain(int argc, wchar_t **argv) {
    if (argc < 6) return 10;
    const wchar_t *result_path = argv[2];
    const wchar_t *outside_read = argv[3];
    const wchar_t *outside_write = argv[4];
    unsigned short port = (unsigned short)wcstoul(argv[5], NULL, 10);
    if (argc > 6) Sleep((DWORD)wcstoul(argv[6], NULL, 10));
    wchar_t secret[16];
    DWORD secret_length = GetEnvironmentVariableW(L"TUGBERK_TEST_SECRET", secret, 16);
    FILE *result = _wfopen(result_path, L"wb");
    if (!result) return 13;
    int network_authority = can_connect_loopback(port);
    fprintf(result,
        "{\"outsideRead\":%s,\"outsideWrite\":%s,\"secretVisible\":%s,\"childSpawn\":%s,\"networkAuthority\":%s,\"networkError\":%d}",
        can_read(outside_read) ? "true" : "false",
        can_write(outside_write) ? "true" : "false",
        secret_length ? "true" : "false",
        can_spawn() ? "true" : "false",
        network_authority ? "true" : "false", network_error);
    fclose(result);
    return 0;
}
