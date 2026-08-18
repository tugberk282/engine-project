#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <aclapi.h>
#include <sddl.h>
#include <userenv.h>
#include <stdio.h>
#include <stdlib.h>
#include <wchar.h>

#ifndef PROCESS_CREATION_CHILD_PROCESS_RESTRICTED
#define PROCESS_CREATION_CHILD_PROCESS_RESTRICTED 0x01
#endif

#ifndef PROCESS_CREATION_MITIGATION_POLICY_WIN32K_SYSTEM_CALL_DISABLE_ALWAYS_ON
#define PROCESS_CREATION_MITIGATION_POLICY_WIN32K_SYSTEM_CALL_DISABLE_ALWAYS_ON (1ULL << 28)
#endif

#ifndef PROCESS_CREATION_MITIGATION_POLICY_EXTENSION_POINT_DISABLE_ALWAYS_ON
#define PROCESS_CREATION_MITIGATION_POLICY_EXTENSION_POINT_DISABLE_ALWAYS_ON (1ULL << 32)
#endif

typedef struct Options {
    const wchar_t *profile;
    const wchar_t *staging;
    const wchar_t *executable;
    const wchar_t *adapter;
    const wchar_t *command_line;
    DWORD timeout_ms;
    SIZE_T memory_bytes;
    DWORD cpu_ms;
} Options;

static void report_error(const wchar_t *code, DWORD detail) {
    fwprintf(stderr, L"{\"ok\":false,\"code\":\"%ls\",\"detail\":%lu}\n", code, detail);
}

static int parse_u32(const wchar_t *value, DWORD *out) {
    wchar_t *end = NULL;
    unsigned long parsed = wcstoul(value, &end, 10);
    if (!value[0] || !end || *end || parsed == 0 || parsed > 0xffffffffUL) return 0;
    *out = (DWORD) parsed;
    return 1;
}

static int parse_size(const wchar_t *value, SIZE_T *out) {
    wchar_t *end = NULL;
    unsigned long long parsed = wcstoull(value, &end, 10);
    if (!value[0] || !end || *end || parsed < (16ULL << 20) || parsed > (4ULL << 30)) return 0;
    *out = (SIZE_T) parsed;
    return 1;
}

static int parse_options(int argc, wchar_t **argv, Options *out) {
    ZeroMemory(out, sizeof(*out));
    for (int i = 1; i < argc; i++) {
        if (i + 1 >= argc) return 0;
        if (!wcscmp(argv[i], L"--profile")) out->profile = argv[++i];
        else if (!wcscmp(argv[i], L"--staging")) out->staging = argv[++i];
        else if (!wcscmp(argv[i], L"--executable")) out->executable = argv[++i];
        else if (!wcscmp(argv[i], L"--adapter")) out->adapter = argv[++i];
        else if (!wcscmp(argv[i], L"--command-line")) out->command_line = argv[++i];
        else if (!wcscmp(argv[i], L"--timeout-ms")) { if (!parse_u32(argv[++i], &out->timeout_ms)) return 0; }
        else if (!wcscmp(argv[i], L"--memory-bytes")) { if (!parse_size(argv[++i], &out->memory_bytes)) return 0; }
        else if (!wcscmp(argv[i], L"--cpu-ms")) { if (!parse_u32(argv[++i], &out->cpu_ms)) return 0; }
        else return 0;
    }
    return out->profile && out->staging && out->executable && out->adapter && out->command_line
        && out->timeout_ms && out->memory_bytes && out->cpu_ms;
}

static int is_absolute_non_reparse_directory(const wchar_t *path) {
    if (!path || wcslen(path) < 3 || path[1] != L':' || (path[2] != L'\\' && path[2] != L'/')) return 0;
    DWORD attrs = GetFileAttributesW(path);
    return attrs != INVALID_FILE_ATTRIBUTES
        && (attrs & FILE_ATTRIBUTE_DIRECTORY)
        && !(attrs & FILE_ATTRIBUTE_REPARSE_POINT);
}

static HRESULT get_or_create_profile(const wchar_t *name, PSID *sid) {
    HRESULT hr = CreateAppContainerProfile(name, name, L"Tugberk Engine untrusted play session", NULL, 0, sid);
    if (hr == HRESULT_FROM_WIN32(ERROR_ALREADY_EXISTS)) {
        hr = DeriveAppContainerSidFromAppContainerName(name, sid);
    }
    return hr;
}

static DWORD grant_path_access(const wchar_t *path, PSID sid, DWORD inheritance) {
    PACL old_acl = NULL;
    PSECURITY_DESCRIPTOR descriptor = NULL;
    DWORD error = GetNamedSecurityInfoW((LPWSTR)path, SE_FILE_OBJECT, DACL_SECURITY_INFORMATION,
        NULL, NULL, &old_acl, NULL, &descriptor);
    if (error != ERROR_SUCCESS) return error;

    EXPLICIT_ACCESSW access;
    ZeroMemory(&access, sizeof(access));
    access.grfAccessPermissions = FILE_GENERIC_READ | FILE_GENERIC_WRITE | FILE_GENERIC_EXECUTE | DELETE;
    access.grfAccessMode = GRANT_ACCESS;
    access.grfInheritance = inheritance;
    access.Trustee.TrusteeForm = TRUSTEE_IS_SID;
    access.Trustee.TrusteeType = TRUSTEE_IS_USER;
    access.Trustee.ptstrName = (LPWSTR)sid;

    PACL new_acl = NULL;
    error = SetEntriesInAclW(1, &access, old_acl, &new_acl);
    if (error == ERROR_SUCCESS) {
        error = SetNamedSecurityInfoW((LPWSTR)path, SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
            NULL, NULL, new_acl, NULL);
    }
    if (new_acl) LocalFree(new_acl);
    if (descriptor) LocalFree(descriptor);
    return error;
}

static HANDLE create_job(const Options *options) {
    HANDLE job = CreateJobObjectW(NULL, NULL);
    if (!job) return NULL;

    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits;
    ZeroMemory(&limits, sizeof(limits));
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        | JOB_OBJECT_LIMIT_ACTIVE_PROCESS | JOB_OBJECT_LIMIT_PROCESS_MEMORY
        | JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION;
    limits.BasicLimitInformation.ActiveProcessLimit = 1;
    limits.ProcessMemoryLimit = options->memory_bytes;
    if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof(limits))) {
        CloseHandle(job);
        return NULL;
    }

    JOBOBJECT_BASIC_LIMIT_INFORMATION cpu;
    ZeroMemory(&cpu, sizeof(cpu));
    cpu.LimitFlags = JOB_OBJECT_LIMIT_PROCESS_TIME;
    cpu.PerProcessUserTimeLimit.QuadPart = ((LONGLONG)options->cpu_ms) * 10000;
    if (!SetInformationJobObject(job, JobObjectBasicLimitInformation, &cpu, sizeof(cpu))) {
        CloseHandle(job);
        return NULL;
    }
    return job;
}

int wmain(int argc, wchar_t **argv) {
    Options options;
    if (!parse_options(argc, argv, &options)) {
        report_error(L"INVALID_LAUNCH_POLICY", ERROR_INVALID_PARAMETER);
        return 64;
    }
    if (!is_absolute_non_reparse_directory(options.staging)) {
        report_error(L"INVALID_STAGING_ROOT", ERROR_INVALID_REPARSE_DATA);
        return 65;
    }

    PSID appcontainer_sid = NULL;
    HRESULT hr = get_or_create_profile(options.profile, &appcontainer_sid);
    if (FAILED(hr)) {
        report_error(L"APPCONTAINER_PROFILE_FAILED", HRESULT_CODE(hr));
        return 66;
    }
    DWORD acl_error = grant_path_access(options.staging, appcontainer_sid, SUB_CONTAINERS_AND_OBJECTS_INHERIT);
    if (acl_error == ERROR_SUCCESS) {
        acl_error = grant_path_access(options.executable, appcontainer_sid, NO_INHERITANCE);
    }
    if (acl_error == ERROR_SUCCESS) {
        acl_error = grant_path_access(options.adapter, appcontainer_sid, NO_INHERITANCE);
    }
    if (acl_error != ERROR_SUCCESS) {
        report_error(L"STAGING_ACL_FAILED", acl_error);
        FreeSid(appcontainer_sid);
        return 67;
    }

    HANDLE job = create_job(&options);
    if (!job) {
        report_error(L"JOB_POLICY_FAILED", GetLastError());
        FreeSid(appcontainer_sid);
        return 68;
    }

    SIZE_T attribute_size = 0;
    InitializeProcThreadAttributeList(NULL, 3, 0, &attribute_size);
    LPPROC_THREAD_ATTRIBUTE_LIST attributes = (LPPROC_THREAD_ATTRIBUTE_LIST)HeapAlloc(
        GetProcessHeap(), HEAP_ZERO_MEMORY, attribute_size);
    if (!attributes || !InitializeProcThreadAttributeList(attributes, 3, 0, &attribute_size)) {
        report_error(L"ATTRIBUTE_POLICY_FAILED", GetLastError());
        if (attributes) HeapFree(GetProcessHeap(), 0, attributes);
        CloseHandle(job);
        FreeSid(appcontainer_sid);
        return 69;
    }

    SECURITY_CAPABILITIES capabilities;
    ZeroMemory(&capabilities, sizeof(capabilities));
    capabilities.AppContainerSid = appcontainer_sid;
    DWORD child_policy = PROCESS_CREATION_CHILD_PROCESS_RESTRICTED;
    DWORD64 mitigation_policy = PROCESS_CREATION_MITIGATION_POLICY_WIN32K_SYSTEM_CALL_DISABLE_ALWAYS_ON
        | PROCESS_CREATION_MITIGATION_POLICY_EXTENSION_POINT_DISABLE_ALWAYS_ON;
    BOOL attributes_ok = UpdateProcThreadAttribute(attributes, 0,
        PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES, &capabilities, sizeof(capabilities), NULL, NULL)
        && UpdateProcThreadAttribute(attributes, 0, PROC_THREAD_ATTRIBUTE_CHILD_PROCESS_POLICY,
            &child_policy, sizeof(child_policy), NULL, NULL)
        && UpdateProcThreadAttribute(attributes, 0, PROC_THREAD_ATTRIBUTE_MITIGATION_POLICY,
            &mitigation_policy, sizeof(mitigation_policy), NULL, NULL);
    if (!attributes_ok) {
        report_error(L"ATTRIBUTE_POLICY_FAILED", GetLastError());
        DeleteProcThreadAttributeList(attributes);
        HeapFree(GetProcessHeap(), 0, attributes);
        CloseHandle(job);
        FreeSid(appcontainer_sid);
        return 70;
    }

    STARTUPINFOEXW startup;
    PROCESS_INFORMATION process;
    ZeroMemory(&startup, sizeof(startup));
    ZeroMemory(&process, sizeof(process));
    startup.StartupInfo.cb = sizeof(startup);
    startup.lpAttributeList = attributes;
    wchar_t *command_line = _wcsdup(options.command_line);
    BOOL created = command_line && CreateProcessW(options.executable, command_line,
        NULL, NULL, FALSE, CREATE_SUSPENDED | EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT
            | CREATE_BREAKAWAY_FROM_JOB | CREATE_NO_WINDOW,
        NULL, options.staging, &startup.StartupInfo, &process);
    DWORD create_error = created ? ERROR_SUCCESS : GetLastError();
    free(command_line);
    DeleteProcThreadAttributeList(attributes);
    HeapFree(GetProcessHeap(), 0, attributes);
    FreeSid(appcontainer_sid);
    if (!created) {
        report_error(L"SANDBOX_PROCESS_CREATE_FAILED", create_error);
        CloseHandle(job);
        return 71;
    }

    if (!AssignProcessToJobObject(job, process.hProcess)) {
        DWORD assign_error = GetLastError();
        TerminateProcess(process.hProcess, 126);
        WaitForSingleObject(process.hProcess, 5000);
        report_error(L"JOB_ASSIGNMENT_FAILED", assign_error);
        CloseHandle(process.hThread);
        CloseHandle(process.hProcess);
        CloseHandle(job);
        return 72;
    }
    if (ResumeThread(process.hThread) == (DWORD)-1) {
        DWORD resume_error = GetLastError();
        TerminateJobObject(job, 125);
        report_error(L"SANDBOX_RESUME_FAILED", resume_error);
        CloseHandle(process.hThread);
        CloseHandle(process.hProcess);
        CloseHandle(job);
        return 73;
    }
    CloseHandle(process.hThread);

    DWORD waited = WaitForSingleObject(process.hProcess, options.timeout_ms);
    if (waited == WAIT_TIMEOUT) {
        TerminateJobObject(job, 124);
        WaitForSingleObject(process.hProcess, 5000);
        report_error(L"PLAY_SANDBOX_TIMEOUT", WAIT_TIMEOUT);
        CloseHandle(process.hProcess);
        CloseHandle(job);
        return 74;
    }
    if (waited != WAIT_OBJECT_0) {
        DWORD wait_error = GetLastError();
        TerminateJobObject(job, 123);
        report_error(L"PLAY_SANDBOX_WAIT_FAILED", wait_error);
        CloseHandle(process.hProcess);
        CloseHandle(job);
        return 75;
    }

    DWORD exit_code = 0;
    GetExitCodeProcess(process.hProcess, &exit_code);
    CloseHandle(process.hProcess);
    CloseHandle(job);
    wprintf(L"{\"ok\":true,\"exitCode\":%lu,\"sandboxed\":true}\n", exit_code);
    return exit_code == 0 ? 0 : 76;
}
