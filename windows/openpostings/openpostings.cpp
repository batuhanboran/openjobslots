// openjobslots.cpp : Defines the entry point for the application.
//

#include "pch.h"
#include "openjobslots.h"

#include "AutolinkedNativeModules.g.h"

#include "NativeModules.h"
#include <appmodel.h>
#include <WindowsAppSDK-VersionInfo.h>
#include <shellapi.h>

// A PackageProvider containing any turbo modules you define within this app project
struct CompReactPackageProvider
    : winrt::implements<CompReactPackageProvider, winrt::Microsoft::ReactNative::IReactPackageProvider> {
 public: // IReactPackageProvider
  void CreatePackage(winrt::Microsoft::ReactNative::IReactPackageBuilder const &packageBuilder) noexcept {
    AddAttributedModules(packageBuilder, true);
  }
};

namespace {
bool FileExists(const std::wstring &path) {
  const DWORD attributes = GetFileAttributesW(path.c_str());
  return attributes != INVALID_FILE_ATTRIBUTES && (attributes & FILE_ATTRIBUTE_DIRECTORY) == 0;
}

void LaunchBackendIfInstalled(const std::wstring &appDirectory) {
  const std::wstring launcherScriptPath = appDirectory + L"\\backend\\launch-backend.vbs";
  if (!FileExists(launcherScriptPath)) {
    return;
  }

  const std::wstring parameters = L"\"" + launcherScriptPath + L"\"";
  const auto launchResult = reinterpret_cast<INT_PTR>(
      ShellExecuteW(nullptr, L"open", L"wscript.exe", parameters.c_str(), appDirectory.c_str(), SW_HIDE));

  (void)launchResult;
}
} // namespace

// The entry point of the Win32 application
_Use_decl_annotations_ int CALLBACK WinMain(HINSTANCE instance, HINSTANCE, PSTR /* commandLine */, int showCmd) {
  // Initialize WinRT
  winrt::init_apartment(winrt::apartment_type::single_threaded);

  HMODULE windowsAppRuntimeModule = nullptr;
  HMODULE bootstrapModule = nullptr;
  using MddBootstrapShutdownFn = void(WINAPI *)();
  MddBootstrapShutdownFn bootstrapShutdown = nullptr;

#if defined(MICROSOFT_WINDOWSAPPSDK_SELFCONTAINED)
  // Self-contained mode: load the local Windows App SDK runtime from app payload.
  using WindowsAppRuntimeEnsureIsLoadedFn = HRESULT(WINAPI *)();
  windowsAppRuntimeModule = LoadLibraryW(L"Microsoft.WindowsAppRuntime.dll");
  if (!windowsAppRuntimeModule) {
    return static_cast<int>(HRESULT_FROM_WIN32(GetLastError()));
  }

  auto ensureIsLoaded = reinterpret_cast<WindowsAppRuntimeEnsureIsLoadedFn>(
      GetProcAddress(windowsAppRuntimeModule, "WindowsAppRuntime_EnsureIsLoaded"));
  if (!ensureIsLoaded) {
    FreeLibrary(windowsAppRuntimeModule);
    return static_cast<int>(E_NOINTERFACE);
  }

  const auto ensureLoadedHr = ensureIsLoaded();
  if (FAILED(ensureLoadedHr)) {
    FreeLibrary(windowsAppRuntimeModule);
    return static_cast<int>(ensureLoadedHr);
  }
#else
  // Framework-dependent mode: bootstrap into installed Windows App SDK runtime.
  using MddBootstrapInitialize2Fn = HRESULT(WINAPI *)(UINT32, PCWSTR, PACKAGE_VERSION, UINT32);
  bootstrapModule = LoadLibraryW(L"Microsoft.WindowsAppRuntime.Bootstrap.dll");
  if (!bootstrapModule) {
    return static_cast<int>(HRESULT_FROM_WIN32(GetLastError()));
  }

  auto bootstrapInitialize =
      reinterpret_cast<MddBootstrapInitialize2Fn>(GetProcAddress(bootstrapModule, "MddBootstrapInitialize2"));
  bootstrapShutdown = reinterpret_cast<MddBootstrapShutdownFn>(GetProcAddress(bootstrapModule, "MddBootstrapShutdown"));

  if (!bootstrapInitialize || !bootstrapShutdown) {
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
    FreeLibrary(bootstrapModule);
    return static_cast<int>(bootstrapHr);
  }
#endif

  // Enable per monitor DPI scaling
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);

  // Find the path hosting the app exe file
  WCHAR appDirectory[MAX_PATH];
  GetModuleFileNameW(NULL, appDirectory, MAX_PATH);
  PathCchRemoveFileSpec(appDirectory, MAX_PATH);
  LaunchBackendIfInstalled(appDirectory);

  // Create a ReactNativeWin32App with the ReactNativeAppBuilder
  auto reactNativeWin32App{winrt::Microsoft::ReactNative::ReactNativeAppBuilder().Build()};

  // Configure the initial InstanceSettings for the app's ReactNativeHost
  auto settings{reactNativeWin32App.ReactNativeHost().InstanceSettings()};
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

  int exitCode = 0;
  try {
    // Start the app
    reactNativeWin32App.Start();
  } catch (winrt::hresult_error const &e) {
    exitCode = static_cast<int>(e.code());
  } catch (...) {
    exitCode = static_cast<int>(E_FAIL);
  }

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
  return exitCode;
}
