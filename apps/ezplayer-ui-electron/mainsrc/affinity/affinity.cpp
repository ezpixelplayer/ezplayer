// affinity/addon.cc
#include "napi.h"
#include <vector>

#if defined(_WIN32)
  #define NOMINMAX
  #include <windows.h>
#elif defined(__APPLE__)
  #include <mach/mach.h>
  #include <mach/thread_policy.h>
  #include <pthread.h>
#else
  #include <sched.h>
  #include <pthread.h>
  #include <unistd.h>
#endif

static std::vector<int> toCpuVec(const Napi::Env& env, const Napi::Array& arr) {
  std::vector<int> cpus;
  cpus.reserve(arr.Length());
  for (uint32_t i = 0; i < arr.Length(); ++i) {
    Napi::Value v = arr[i];
    if (!v.IsNumber()) continue;
    int c = v.As<Napi::Number>().Int32Value();
    if (c >= 0) cpus.push_back(c);
  }
  return cpus;
}

Napi::Value SetThreadAffinity(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsArray()) {
    Napi::TypeError::New(env, "Expected array of CPU indices").ThrowAsJavaScriptException();
    return env.Null();
  }
  auto cpus = toCpuVec(env, info[0].As<Napi::Array>());

#if defined(_WIN32)
  // NOTE: Only handles up to 64 logical CPUs (single processor group).
  DWORD_PTR mask = 0;
  for (int c : cpus) {
    if (c >= 0 && c < 64) mask |= (DWORD_PTR(1) << c);
  }
  HANDLE hThread = GetCurrentThread();
  if (mask == 0 || SetThreadAffinityMask(hThread, mask) == 0) {
    Napi::Error::New(env, "SetThreadAffinityMask failed or empty mask").ThrowAsJavaScriptException();
  }

#elif defined(__APPLE__)
  // macOS: cannot pin to specific CPU indices.
  // Best-effort: assign a unique affinity TAG so the scheduler keeps tagged threads apart.
  // Threads with the same tag prefer co-location; different tags prefer separation.
  thread_affinity_policy_data_t policy;
  // Build a small tag from the CPU list (not stable across boots; just to differentiate groups).
  integer_t tag = 0;
  for (int c : cpus) tag = (tag * 131) ^ (c + 1);
  if (tag == 0) tag = 1;
  policy.affinity_tag = tag;

  thread_t th = pthread_mach_thread_np(pthread_self());
  kern_return_t kr = thread_policy_set(th, THREAD_AFFINITY_POLICY,
                                       (thread_policy_t)&policy,
                                       THREAD_AFFINITY_POLICY_COUNT);
  if (kr != KERN_SUCCESS) {
    Napi::Error::New(env, "macOS thread_policy_set failed (no exact CPU pinning available)").ThrowAsJavaScriptException();
  }

#else
  // Linux
  cpu_set_t set;
  CPU_ZERO(&set);
  for (int c : cpus) {
    if (c >= 0 && c < CPU_SETSIZE) CPU_SET(c, &set);
  }
  if (CPU_COUNT(&set) == 0) {
    Napi::Error::New(env, "Empty CPU set").ThrowAsJavaScriptException();
  } else {
    // pid 0 means "calling thread" (tid)
    if (sched_setaffinity(0, sizeof(set), &set) != 0) {
      Napi::Error::New(env, "sched_setaffinity failed").ThrowAsJavaScriptException();
    }
  }
#endif
  return env.Undefined();
}

Napi::Value SetProcessAffinity(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsArray()) {
    Napi::TypeError::New(env, "Expected array of CPU indices").ThrowAsJavaScriptException();
    return env.Null();
  }
  auto cpus = toCpuVec(env, info[0].As<Napi::Array>());

#if defined(_WIN32)
  DWORD_PTR mask = 0;
  for (int c : cpus) if (c >= 0 && c < 64) mask |= (DWORD_PTR(1) << c);
  if (mask == 0 || SetProcessAffinityMask(GetCurrentProcess(), mask) == 0) {
    Napi::Error::New(env, "SetProcessAffinityMask failed or empty mask").ThrowAsJavaScriptException();
  }
#elif defined(__APPLE__)
  // No real process-wide CPU pinning. No-op.
  (void)cpus;
#else
  cpu_set_t set;
  CPU_ZERO(&set);
  for (int c : cpus) if (c >= 0 && c < CPU_SETSIZE) CPU_SET(c, &set);
  if (CPU_COUNT(&set) == 0 || sched_setaffinity(0, sizeof(set), &set) != 0) {
    Napi::Error::New(env, "sched_setaffinity (process) failed or empty set").ThrowAsJavaScriptException();
  }
#endif
  return env.Undefined();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("setThreadAffinity", Napi::Function::New(env, SetThreadAffinity));
  exports.Set("setProcessAffinity", Napi::Function::New(env, SetProcessAffinity));
  return exports;
}

NODE_API_MODULE(affinity, Init)
