#include "napi.h"

#if defined(_WIN32)
  #define NOMINMAX
  #include <windows.h>
  #include <mmsystem.h>
  #pragma comment(lib, "winmm.lib")
  static LONG g_refCount = 0;
#endif

// begin(1) ⇒ request 1 ms resolution; returns true if active after call
Napi::Value Begin(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
#if defined(_WIN32)
  // Ref-count so multiple Begin calls are ok; only first calls timeBeginPeriod.
  LONG count = InterlockedIncrement(&g_refCount);
  if (count == 1) {
    MMRESULT r = timeBeginPeriod(1);
    if (r != TIMERR_NOERROR) {
      InterlockedDecrement(&g_refCount);
      Napi::Error::New(env, "timeBeginPeriod(1) failed").ThrowAsJavaScriptException();
    }
  }
  return Napi::Boolean::New(env, true);
#else
  return Napi::Boolean::New(env, false); // no-op on non-Windows
#endif
}

// end() ⇒ release one ref; when refCount hits 0, restore default
Napi::Value End(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
#if defined(_WIN32)
  LONG count = InterlockedDecrement(&g_refCount);
  if (count < 0) { // guard against imbalance
    InterlockedIncrement(&g_refCount);
    Napi::Error::New(env, "Unbalanced End()").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  if (count == 0) {
    MMRESULT r = timeEndPeriod(1);
    if (r != TIMERR_NOERROR) {
      Napi::Error::New(env, "timeEndPeriod(1) failed").ThrowAsJavaScriptException();
    }
  }
#endif
  return env.Undefined();
}

#if defined(_WIN32)
// Ensure we release on process shutdown even if End() wasn’t called.
void AtExitHook(void* /*arg*/) {
  while (g_refCount > 0) {
    timeEndPeriod(1);
    --g_refCount;
  }
}
#endif

Napi::Object Init(Napi::Env env, Napi::Object exports) {
#if defined(_WIN32)
  napi_add_env_cleanup_hook(env, AtExitHook, nullptr);
#endif
  exports.Set("begin", Napi::Function::New(env, Begin));
  exports.Set("end",   Napi::Function::New(env, End));
  return exports;
}

NODE_API_MODULE(win_hirez_timer, Init)
