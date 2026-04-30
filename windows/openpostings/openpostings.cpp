// openjobslots.cpp : Defines the entry point for the application.
//

#include "pch.h"
#include "openjobslots.h"

#include "AutolinkedNativeModules.g.h"

#include "NativeModules.h"
#include <appmodel.h>
#include <WindowsAppSDK-VersionInfo.h>
#include <shellapi.h>
#include <ShlObj.h>
#include <tlhelp32.h>
#include <atomic>
#include <cstdint>
#include <cwctype>
#include <sstream>

// A PackageProvider containing any turbo modules you define within this app project
struct CompReactPackageProvider
    : winrt::implements<CompReactPackageProvider, winrt::Microsoft::ReactNative::IReactPackageProvider> {
 public: // IReactPackageProvider
  void CreatePackage(winrt::Microsoft::ReactNative::IReactPackageBuilder const &packageBuilder) noexcept {
    AddAttributedModules(packageBuilder, true);
  }
};

namespace {
std::wstring g_frontendLogPath;
std::wstring g_frontendCrashLogPath;
std::atomic<bool> g_frontendShutdownInitiated{false};

bool FileExists(const std::wstring &path) {
  const DWORD attributes = GetFileAttributesW(path.c_str());
  return attributes != INVALID_FILE_ATTRIBUTES && (attributes & FILE_ATTRIBUTE_DIRECTORY) == 0;
}

bool DirectoryExists(const std::wstring &path) {
  const DWORD attributes = GetFileAttributesW(path.c_str());
  return attributes != INVALID_FILE_ATTRIBUTES && (attributes & FILE_ATTRIBUTE_DIRECTORY) != 0;
}

std::wstring GetEnvironmentVariableValue(const wchar_t *name) {
  if (!name || !*name) {
    return L"";
  }

  const DWORD required = GetEnvironmentVariableW(name, nullptr, 0);
  if (required == 0) {
    return L"";
  }

  std::wstring value(required, L'\0');
  const DWORD written = GetEnvironmentVariableW(name, value.data(), required);
  if (written == 0 || written >= required) {
    return L"";
  }
  value.resize(written);
  return value;
}

std::wstring JoinPath(const std::wstring &left, const std::wstring &right) {
  if (left.empty()) return right;
  if (right.empty()) return left;
  if (left.back() == L'\\' || left.back() == L'/') {
    return left + right;
  }
  return left + L"\\" + right;
}

std::wstring GetLogsDirectoryPath() {
  const std::wstring localAppData = GetEnvironmentVariableValue(L"LOCALAPPDATA");
  if (localAppData.empty()) {
    return L"";
  }
  return JoinPath(JoinPath(JoinPath(localAppData, L"OpenJobSlots"), L"backend"), L"logs");
}

std::wstring GetDesktopFailurePath() {
  wchar_t desktopPath[MAX_PATH]{};
  const HRESULT result = SHGetFolderPathW(nullptr, CSIDL_DESKTOPDIRECTORY, nullptr, SHGFP_TYPE_CURRENT, desktopPath);
  if (FAILED(result)) {
    return L"";
  }
  return JoinPath(std::wstring(desktopPath), L"failure.txt");
}

void EnsureDirectoryExists(const std::wstring &path) {
  if (path.empty()) return;
  SHCreateDirectoryExW(nullptr, path.c_str(), nullptr);
}

std::string WideToUtf8(const std::wstring &value) {
  if (value.empty()) return std::string();

  const int required = WideCharToMultiByte(CP_UTF8, 0, value.c_str(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
  if (required <= 0) {
    return std::string();
  }

  std::string utf8(required, '\0');
  const int written = WideCharToMultiByte(
      CP_UTF8,
      0,
      value.c_str(),
      static_cast<int>(value.size()),
      utf8.data(),
      required,
      nullptr,
      nullptr);
  if (written <= 0) {
    return std::string();
  }
  utf8.resize(static_cast<size_t>(written));
  return utf8;
}

void AppendUtf8Line(const std::wstring &path, const std::wstring &line) {
  if (path.empty()) return;

  HANDLE fileHandle = CreateFileW(
      path.c_str(),
      FILE_APPEND_DATA,
      FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
      nullptr,
      OPEN_ALWAYS,
      FILE_ATTRIBUTE_NORMAL,
      nullptr);
  if (fileHandle == INVALID_HANDLE_VALUE) {
    return;
  }

  const std::wstring lineWithNewline = line + L"\r\n";
  const std::string utf8 = WideToUtf8(lineWithNewline);
  if (!utf8.empty()) {
    DWORD written = 0;
    WriteFile(fileHandle, utf8.data(), static_cast<DWORD>(utf8.size()), &written, nullptr);
  }

  CloseHandle(fileHandle);
}

void WriteUtf8Text(const std::wstring &path, const std::wstring &content) {
  if (path.empty()) return;

  HANDLE fileHandle = CreateFileW(
      path.c_str(),
      GENERIC_WRITE,
      FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
      nullptr,
      CREATE_ALWAYS,
      FILE_ATTRIBUTE_NORMAL,
      nullptr);
  if (fileHandle == INVALID_HANDLE_VALUE) {
    return;
  }

  const std::string utf8 = WideToUtf8(content);
  if (!utf8.empty()) {
    DWORD written = 0;
    WriteFile(fileHandle, utf8.data(), static_cast<DWORD>(utf8.size()), &written, nullptr);
  }

  CloseHandle(fileHandle);
}

std::wstring MakeTimestamp() {
  SYSTEMTIME localTime{};
  GetLocalTime(&localTime);
  wchar_t buffer[64]{};
  swprintf_s(
      buffer,
      L"%04u-%02u-%02u %02u:%02u:%02u.%03u",
      localTime.wYear,
      localTime.wMonth,
      localTime.wDay,
      localTime.wHour,
      localTime.wMinute,
      localTime.wSecond,
      localTime.wMilliseconds);
  return std::wstring(buffer);
}

std::wstring ToHexUInt64(uint64_t value) {
  std::wstringstream stream;
  stream << L"0x" << std::hex << std::uppercase << value;
  return stream.str();
}

std::wstring ToLowerInvariant(std::wstring value) {
  for (auto &ch : value) {
    ch = static_cast<wchar_t>(towlower(ch));
  }
  return value;
}

std::wstring GetFileNameFromPath(const std::wstring &path) {
  const size_t slashPos = path.find_last_of(L"\\/");
  if (slashPos == std::wstring::npos) {
    return path;
  }
  return path.substr(slashPos + 1);
}

bool StartProcessWithWindowMode(
    const std::wstring &applicationPath,
    std::wstring commandLine,
    const std::wstring &workingDirectory,
    DWORD creationFlags = 0,
    bool hideWindow = true) {
  if (applicationPath.empty() || commandLine.empty()) {
    return false;
  }

  STARTUPINFOW startupInfo{};
  startupInfo.cb = sizeof(startupInfo);
  startupInfo.dwFlags = STARTF_USESHOWWINDOW;
  startupInfo.wShowWindow = hideWindow ? SW_HIDE : SW_SHOW;

  PROCESS_INFORMATION processInfo{};
  const BOOL created = CreateProcessW(
      applicationPath.c_str(),
      &commandLine[0],
      nullptr,
      nullptr,
      FALSE,
      creationFlags,
      nullptr,
      workingDirectory.empty() ? nullptr : workingDirectory.c_str(),
      &startupInfo,
      &processInfo);

  if (!created) {
    return false;
  }

  CloseHandle(processInfo.hThread);
  CloseHandle(processInfo.hProcess);
  return true;
}

bool HasCommandLineArgument(const wchar_t *argumentName) {
  if (!argumentName || !*argumentName) {
    return false;
  }

  int argumentCount = 0;
  LPWSTR *arguments = CommandLineToArgvW(GetCommandLineW(), &argumentCount);
  if (!arguments) {
    return false;
  }

  bool found = false;
  for (int index = 1; index < argumentCount; ++index) {
    if (lstrcmpiW(arguments[index], argumentName) == 0) {
      found = true;
      break;
    }
  }

  LocalFree(arguments);
  return found;
}

bool IsOpenJobSlotsBackendAlreadyRunning(const std::wstring &installDirectoryLower) {
  HANDLE snapshotHandle = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (snapshotHandle == INVALID_HANDLE_VALUE) {
    return false;
  }

  PROCESSENTRY32W processEntry{};
  processEntry.dwSize = sizeof(processEntry);
  bool isRunning = false;

  if (Process32FirstW(snapshotHandle, &processEntry)) {
    do {
      if (_wcsicmp(processEntry.szExeFile, L"node.exe") != 0) {
        continue;
      }

      HANDLE processHandle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, processEntry.th32ProcessID);
      if (!processHandle) {
        continue;
      }

      wchar_t processPath[MAX_PATH]{};
      DWORD processPathLength = MAX_PATH;
      const BOOL queried = QueryFullProcessImageNameW(processHandle, 0, processPath, &processPathLength);
      CloseHandle(processHandle);

      if (!queried || processPathLength == 0) {
        continue;
      }

      std::wstring processPathLower(processPath, processPathLength);
      processPathLower = ToLowerInvariant(processPathLower);
      if (processPathLower.find(installDirectoryLower) != std::wstring::npos) {
        isRunning = true;
        break;
      }
    } while (Process32NextW(snapshotHandle, &processEntry));
  }

  CloseHandle(snapshotHandle);
  return isRunning;
}

std::wstring GetAppDirectoryPath() {
  wchar_t appDirectoryBuffer[MAX_PATH]{};
  const DWORD length = GetModuleFileNameW(nullptr, appDirectoryBuffer, MAX_PATH);
  if (length == 0 || length >= MAX_PATH) {
    return L"";
  }

  if (FAILED(PathCchRemoveFileSpec(appDirectoryBuffer, MAX_PATH))) {
    return L"";
  }

  return std::wstring(appDirectoryBuffer);
}

winrt::Microsoft::ReactNative::JSIEngine ResolveJsEngineOverride(std::wstring *engineNameOut = nullptr) {
  std::wstring configuredName = L"v8";
  const std::wstring configuredValue = GetEnvironmentVariableValue(L"OPENJOBSLOTS_JS_ENGINE");
  if (!configuredValue.empty()) {
    std::wstring lowerValue = configuredValue;
    for (auto &ch : lowerValue) {
      ch = static_cast<wchar_t>(towlower(ch));
    }
    if (lowerValue == L"hermes" || lowerValue == L"chakra" || lowerValue == L"v8") {
      configuredName = lowerValue;
    }
  }

  if (engineNameOut) {
    *engineNameOut = configuredName;
  }

  if (configuredName == L"hermes") {
    return winrt::Microsoft::ReactNative::JSIEngine::Hermes;
  }
  if (configuredName == L"v8") {
    return winrt::Microsoft::ReactNative::JSIEngine::V8;
  }
  return winrt::Microsoft::ReactNative::JSIEngine::Chakra;
}

std::wstring GetModulePathForAddress(uintptr_t address, uintptr_t *moduleBaseOut = nullptr) {
  if (moduleBaseOut) {
    *moduleBaseOut = 0;
  }
  if (address == 0) {
    return L"";
  }

  HMODULE moduleHandle = nullptr;
  const BOOL moduleFound = GetModuleHandleExW(
      GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
      reinterpret_cast<LPCWSTR>(address),
      &moduleHandle);
  if (!moduleFound || !moduleHandle) {
    return L"";
  }

  if (moduleBaseOut) {
    *moduleBaseOut = reinterpret_cast<uintptr_t>(moduleHandle);
  }

  wchar_t modulePath[MAX_PATH]{};
  const DWORD length = GetModuleFileNameW(moduleHandle, modulePath, MAX_PATH);
  if (length == 0 || length >= MAX_PATH) {
    return L"";
  }
  return std::wstring(modulePath, length);
}

void WriteFrontendLog(const std::wstring &message) {
  if (g_frontendLogPath.empty()) return;
  AppendUtf8Line(g_frontendLogPath, L"[" + MakeTimestamp() + L"] " + message);
}

std::wstring BuildCrashReport(const std::wstring &reason, DWORD exceptionCode, uintptr_t exceptionAddress, int exitCode) {
  uintptr_t moduleBaseAddress = 0;
  const std::wstring faultingModulePath = GetModulePathForAddress(exceptionAddress, &moduleBaseAddress);
  const uintptr_t moduleOffset =
      moduleBaseAddress > 0 && exceptionAddress >= moduleBaseAddress ? exceptionAddress - moduleBaseAddress : 0;

  std::wstringstream stream;
  stream << L"OpenJobSlots Frontend Crash Report\r\n";
  stream << L"Timestamp: " << MakeTimestamp() << L"\r\n";
  stream << L"Reason: " << reason << L"\r\n";
  stream << L"Exception code: " << ToHexUInt64(static_cast<uint64_t>(exceptionCode)) << L"\r\n";
  stream << L"Exception address: " << ToHexUInt64(static_cast<uint64_t>(exceptionAddress)) << L"\r\n";
  stream << L"Faulting module: " << (faultingModulePath.empty() ? L"Unknown" : faultingModulePath) << L"\r\n";
  stream << L"Module offset: " << ToHexUInt64(static_cast<uint64_t>(moduleOffset)) << L"\r\n";
  stream << L"Exit code: " << ToHexUInt64(static_cast<uint64_t>(static_cast<uint32_t>(exitCode))) << L"\r\n";
  stream << L"Process id: " << GetCurrentProcessId() << L"\r\n";
  stream << L"Thread id: " << GetCurrentThreadId() << L"\r\n";
  stream << L"Frontend host log: " << g_frontendLogPath << L"\r\n";
  stream << L"Frontend crash log: " << g_frontendCrashLogPath << L"\r\n";
  return stream.str();
}

void PromptAndSaveDesktopCrashReport(const std::wstring &reportContent) {
  const int result = MessageBoxW(
      nullptr,
      L"OpenJobSlots frontend encountered a crash.\nWould you like to save a failure report to your Desktop?",
      L"OpenJobSlots Crash",
      MB_ICONERROR | MB_YESNO | MB_TOPMOST);

  if (result != IDYES) {
    return;
  }

  const std::wstring desktopFailurePath = GetDesktopFailurePath();
  if (desktopFailurePath.empty()) {
    MessageBoxW(
        nullptr,
        L"Unable to resolve Desktop path for failure.txt.",
        L"OpenJobSlots Crash",
        MB_ICONWARNING | MB_OK | MB_TOPMOST);
    return;
  }

  WriteUtf8Text(desktopFailurePath, reportContent);
  MessageBoxW(
      nullptr,
      L"Saved crash report to Desktop as failure.txt.",
      L"OpenJobSlots Crash",
      MB_ICONINFORMATION | MB_OK | MB_TOPMOST);
}

LONG WINAPI FrontendUnhandledExceptionFilter(EXCEPTION_POINTERS *exceptionPointers) {
  const DWORD exceptionCode =
      exceptionPointers && exceptionPointers->ExceptionRecord ? exceptionPointers->ExceptionRecord->ExceptionCode : 0;
  const uintptr_t exceptionAddress = exceptionPointers && exceptionPointers->ExceptionRecord
      ? reinterpret_cast<uintptr_t>(exceptionPointers->ExceptionRecord->ExceptionAddress)
      : 0;
  const std::wstring faultingModulePath = GetModulePathForAddress(exceptionAddress, nullptr);
  const std::wstring faultingModuleName = ToLowerInvariant(GetFileNameFromPath(faultingModulePath));

  const bool ignoreShutdownException = g_frontendShutdownInitiated.load(std::memory_order_relaxed) &&
      exceptionCode == EXCEPTION_ACCESS_VIOLATION &&
      (faultingModuleName == L"microsoft.reactnative.dll" || faultingModuleName == L"hermes.dll");
  if (ignoreShutdownException) {
    WriteFrontendLog(
        L"Ignoring shutdown-time native exception. Code=" + ToHexUInt64(static_cast<uint64_t>(exceptionCode)) +
        L" Module=" + (faultingModulePath.empty() ? L"Unknown" : faultingModulePath));
    return EXCEPTION_EXECUTE_HANDLER;
  }

  const std::wstring report = BuildCrashReport(L"Unhandled native exception", exceptionCode, exceptionAddress, static_cast<int>(exceptionCode));
  WriteFrontendLog(L"Unhandled native exception captured. Code=" + ToHexUInt64(static_cast<uint64_t>(exceptionCode)));

  if (!g_frontendCrashLogPath.empty()) {
    AppendUtf8Line(g_frontendCrashLogPath, report);
  }
  PromptAndSaveDesktopCrashReport(report);
  return EXCEPTION_EXECUTE_HANDLER;
}

void LaunchBackendIfInstalled(const std::wstring &appDirectory) {
  const std::wstring backendDirectory = JoinPath(appDirectory, L"backend");
  if (!DirectoryExists(backendDirectory)) {
    WriteFrontendLog(L"Backend directory missing; skipping backend launcher.");
    return;
  }

  const std::wstring nodePath = JoinPath(backendDirectory, L"node\\node.exe");
  const std::wstring launcherScriptPath = JoinPath(backendDirectory, L"launcher.js");
  if (!FileExists(nodePath) || !FileExists(launcherScriptPath)) {
    WriteFrontendLog(L"Backend launcher runtime missing; skipping backend launcher.");
    return;
  }

  const std::wstring installDirectoryLower = ToLowerInvariant(appDirectory);
  if (IsOpenJobSlotsBackendAlreadyRunning(installDirectoryLower)) {
    WriteFrontendLog(L"OpenJobSlots backend node process already running; skipping duplicate launcher.");
    return;
  }

  std::wstring commandLine = L"\"" + nodePath + L"\" \"" + launcherScriptPath + L"\"";

  const bool launched = StartProcessWithWindowMode(
      nodePath,
      commandLine,
      backendDirectory,
      CREATE_NO_WINDOW,
      true);

  if (!launched) {
    const DWORD launchError = GetLastError();
    WriteFrontendLog(
        L"Failed to launch backend node runtime. Error=" + std::to_wstring(static_cast<unsigned long long>(launchError)));
  }
}
} // namespace

// The entry point of the Win32 application
_Use_decl_annotations_ int CALLBACK WinMain(HINSTANCE instance, HINSTANCE, PSTR /* commandLine */, int showCmd) {
  const std::wstring appDirectory = GetAppDirectoryPath();
  if (HasCommandLineArgument(L"--backend-startup")) {
    LaunchBackendIfInstalled(appDirectory);
    return 0;
  }

  // Initialize WinRT
  winrt::init_apartment(winrt::apartment_type::single_threaded);

  const std::wstring logsDirectoryPath = GetLogsDirectoryPath();
  EnsureDirectoryExists(logsDirectoryPath);
  g_frontendLogPath = logsDirectoryPath.empty() ? L"" : JoinPath(logsDirectoryPath, L"frontend.log");
  g_frontendCrashLogPath = logsDirectoryPath.empty() ? L"" : JoinPath(logsDirectoryPath, L"frontend-crash.log");
  g_frontendShutdownInitiated.store(false, std::memory_order_relaxed);
  SetUnhandledExceptionFilter(FrontendUnhandledExceptionFilter);
  WriteFrontendLog(L"Frontend process started.");

  HMODULE windowsAppRuntimeModule = nullptr;
  HMODULE bootstrapModule = nullptr;
  using MddBootstrapShutdownFn = void(WINAPI *)();
  MddBootstrapShutdownFn bootstrapShutdown = nullptr;

#if defined(MICROSOFT_WINDOWSAPPSDK_SELFCONTAINED)
  // Self-contained mode: load the local Windows App SDK runtime from app payload.
  using WindowsAppRuntimeEnsureIsLoadedFn = HRESULT(WINAPI *)();
  windowsAppRuntimeModule = LoadLibraryW(L"Microsoft.WindowsAppRuntime.dll");
  if (!windowsAppRuntimeModule) {
    WriteFrontendLog(L"Failed to load Microsoft.WindowsAppRuntime.dll.");
    return static_cast<int>(HRESULT_FROM_WIN32(GetLastError()));
  }

  auto ensureIsLoaded = reinterpret_cast<WindowsAppRuntimeEnsureIsLoadedFn>(
      GetProcAddress(windowsAppRuntimeModule, "WindowsAppRuntime_EnsureIsLoaded"));
  if (!ensureIsLoaded) {
    WriteFrontendLog(L"WindowsAppRuntime_EnsureIsLoaded function not found.");
    FreeLibrary(windowsAppRuntimeModule);
    return static_cast<int>(E_NOINTERFACE);
  }

  const auto ensureLoadedHr = ensureIsLoaded();
  if (FAILED(ensureLoadedHr)) {
    WriteFrontendLog(L"WindowsAppRuntime_EnsureIsLoaded failed.");
    FreeLibrary(windowsAppRuntimeModule);
    return static_cast<int>(ensureLoadedHr);
  }
#else
  // Framework-dependent mode: bootstrap into installed Windows App SDK runtime.
  using MddBootstrapInitialize2Fn = HRESULT(WINAPI *)(UINT32, PCWSTR, PACKAGE_VERSION, UINT32);
  bootstrapModule = LoadLibraryW(L"Microsoft.WindowsAppRuntime.Bootstrap.dll");
  if (!bootstrapModule) {
    WriteFrontendLog(L"Failed to load Microsoft.WindowsAppRuntime.Bootstrap.dll.");
    return static_cast<int>(HRESULT_FROM_WIN32(GetLastError()));
  }

  auto bootstrapInitialize =
      reinterpret_cast<MddBootstrapInitialize2Fn>(GetProcAddress(bootstrapModule, "MddBootstrapInitialize2"));
  bootstrapShutdown = reinterpret_cast<MddBootstrapShutdownFn>(GetProcAddress(bootstrapModule, "MddBootstrapShutdown"));

  if (!bootstrapInitialize || !bootstrapShutdown) {
    WriteFrontendLog(L"Missing bootstrap exports.");
    FreeLibrary(bootstrapModule);
    return static_cast<int>(E_NOINTERFACE);
  }

  PACKAGE_VERSION minVersion{};
  minVersion.Version = WINDOWSAPPSDK_RUNTIME_VERSION_UINT64;
  const auto bootstrapHr = bootstrapInitialize(
      WINDOWSAPPSDK_RELEASE_MAJORMINOR,
      WINDOWSAPPSDK_RELEASE_VERSION_TAG_W,
      minVersion,
      0x0008 | 0x0010 /* OnNoMatch_ShowUI | OnPackageIdentity_NOOP */);
  if (FAILED(bootstrapHr)) {
    WriteFrontendLog(L"MddBootstrapInitialize2 failed.");
    FreeLibrary(bootstrapModule);
    return static_cast<int>(bootstrapHr);
  }
#endif

  // Enable per monitor DPI scaling
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);

  // Find the path hosting the app exe file
  WriteFrontendLog(L"Launching backend helper if installed.");
  LaunchBackendIfInstalled(appDirectory);

  // Create a ReactNativeWin32App with the ReactNativeAppBuilder
  auto reactNativeWin32App{winrt::Microsoft::ReactNative::ReactNativeAppBuilder().Build()};

  // Configure the initial InstanceSettings for the app's ReactNativeHost
  auto settings{reactNativeWin32App.ReactNativeHost().InstanceSettings()};
  std::wstring configuredJsEngineName;
  settings.JSIEngineOverride(ResolveJsEngineOverride(&configuredJsEngineName));
  WriteFrontendLog(L"Configured JS engine override: " + configuredJsEngineName + L".");
  // Register any autolinked native modules
  RegisterAutolinkedNativeModulePackages(settings.PackageProviders());
  // Register any native modules defined within this app project
  settings.PackageProviders().Append(winrt::make<CompReactPackageProvider>());

#if BUNDLE
  // Load the JS bundle from a file (not Metro):
  // Set the path (on disk) where the .bundle file is located
  settings.BundleRootPath(std::wstring(L"file://").append(appDirectory).append(L"\\Bundle\\").c_str());
  // Set the name of the bundle file (without the .bundle extension)
  settings.JavaScriptBundleFile(L"index.windows");
  // Disable hot reload
  settings.UseFastRefresh(false);
#else
  // Load the JS bundle from Metro
  settings.JavaScriptBundleFile(L"index");
  // Enable hot reload
  settings.UseFastRefresh(true);
#endif
#if _DEBUG
  // For Debug builds
  // Enable Direct Debugging of JS
  settings.UseDirectDebugger(true);
  // Enable the Developer Menu
  settings.UseDeveloperSupport(true);
#else
  // For Release builds:
  // Disable Direct Debugging of JS
  settings.UseDirectDebugger(false);
  // Disable the Developer Menu
  settings.UseDeveloperSupport(false);
#endif

  // Get the ReactViewOptions so we can set the initial RN component to load
  auto viewOptions{reactNativeWin32App.ReactViewOptions()};
  viewOptions.ComponentName(L"openjobslots");
  auto appWindow{reactNativeWin32App.AppWindow()};
  appWindow.Title(L"OpenJobSlots");
  appWindow.Changed([](
                        winrt::Microsoft::UI::Windowing::AppWindow const &changedWindow,
                        winrt::Microsoft::UI::Windowing::AppWindowChangedEventArgs const &) {
    if (changedWindow.Title() != L"OpenJobSlots") {
      changedWindow.Title(L"OpenJobSlots");
    }
  });
  appWindow.Destroying([](
                           winrt::Microsoft::UI::Windowing::AppWindow const &,
                           winrt::Windows::Foundation::IInspectable const &) {
    g_frontendShutdownInitiated.store(true, std::memory_order_relaxed);
    WriteFrontendLog(L"Frontend window destroy requested.");
  });

  int exitCode = 0;
  try {
    // Start the app
    WriteFrontendLog(L"Starting React Native Windows app host.");
    reactNativeWin32App.Start();
  } catch (winrt::hresult_error const &e) {
    exitCode = static_cast<int>(e.code());
    const std::wstring report = BuildCrashReport(L"Unhandled winrt::hresult_error", static_cast<DWORD>(e.code()), 0, exitCode);
    WriteFrontendLog(L"winrt::hresult_error captured. HRESULT=" + ToHexUInt64(static_cast<uint64_t>(static_cast<uint32_t>(e.code()))));
    if (!g_frontendCrashLogPath.empty()) {
      AppendUtf8Line(g_frontendCrashLogPath, report);
    }
    PromptAndSaveDesktopCrashReport(report);
  } catch (...) {
    exitCode = static_cast<int>(E_FAIL);
    const std::wstring report = BuildCrashReport(L"Unhandled unknown C++ exception", static_cast<DWORD>(E_FAIL), 0, exitCode);
    WriteFrontendLog(L"Unknown C++ exception captured.");
    if (!g_frontendCrashLogPath.empty()) {
      AppendUtf8Line(g_frontendCrashLogPath, report);
    }
    PromptAndSaveDesktopCrashReport(report);
  }
  g_frontendShutdownInitiated.store(true, std::memory_order_relaxed);

#if defined(MICROSOFT_WINDOWSAPPSDK_SELFCONTAINED)
  if (windowsAppRuntimeModule) {
    FreeLibrary(windowsAppRuntimeModule);
  }
#else
  if (bootstrapShutdown) {
    bootstrapShutdown();
  }
  if (bootstrapModule) {
    FreeLibrary(bootstrapModule);
  }
#endif
  WriteFrontendLog(L"Frontend process exiting with code " + ToHexUInt64(static_cast<uint64_t>(static_cast<uint32_t>(exitCode))) + L".");
  return exitCode;
}
