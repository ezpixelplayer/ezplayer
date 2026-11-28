// Offscreen GL 3.3 core for xlrender (header-only, no GL headers or import
// libraries): the context, program/buffer objects and a render-to-image draw.
// Windows uses WGL from the system opengl32.dll or a Mesa opengl32.dll given
// by path (llvmpipe software path); Linux uses EGL (surfaceless or default
// display; LIBGL_ALWAYS_SOFTWARE=1 picks llvmpipe).
#pragma once
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <map>
#include <string>
#include <vector>

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#else
#include <dlfcn.h>
#include <pthread.h>
#endif

namespace xlgl {

typedef unsigned int GLenum;
typedef unsigned int GLuint;
typedef int GLint;
typedef int GLsizei;
typedef unsigned char GLboolean;
typedef unsigned char GLubyte;
typedef float GLfloat;
typedef char GLchar;
typedef ptrdiff_t GLsizeiptr;

enum : GLenum {
    GL_FALSE_ = 0, GL_NO_ERROR_ = 0, GL_FLOAT_ = 0x1406, GL_UNSIGNED_BYTE_ = 0x1401,
    GL_RED_ = 0x1903, GL_RGBA_ = 0x1908, GL_TEXTURE_2D_ = 0x0DE1, GL_TEXTURE0_ = 0x84C0,
    GL_TEXTURE_MIN_FILTER_ = 0x2801, GL_TEXTURE_MAG_FILTER_ = 0x2800,
    GL_TEXTURE_WRAP_S_ = 0x2802, GL_TEXTURE_WRAP_T_ = 0x2803, GL_LINEAR_ = 0x2601, GL_NEAREST_ = 0x2600,
    GL_CLAMP_TO_EDGE_ = 0x812F, GL_COLOR_BUFFER_BIT_ = 0x4000, GL_DEPTH_BUFFER_BIT_ = 0x100,
    GL_POINTS_ = 0, GL_LINES_ = 1, GL_LINE_STRIP_ = 3, GL_TRIANGLES_ = 4, GL_TRIANGLE_STRIP_ = 5,
    GL_ARRAY_BUFFER_ = 0x8892, GL_STATIC_DRAW_ = 0x88E4, GL_DYNAMIC_DRAW_ = 0x88E8,
    GL_FRAMEBUFFER_ = 0x8D40, GL_RENDERBUFFER_ = 0x8D41, GL_COLOR_ATTACHMENT0_ = 0x8CE0,
    GL_DEPTH_ATTACHMENT_ = 0x8D00, GL_DEPTH_COMPONENT24_ = 0x81A6, GL_DEPTH_TEST_ = 0x0B71,
    GL_VERTEX_SHADER_ = 0x8B31, GL_FRAGMENT_SHADER_ = 0x8B30, GL_COMPILE_STATUS_ = 0x8B81,
    GL_LINK_STATUS_ = 0x8B82, GL_INFO_LOG_LENGTH_ = 0x8B84, GL_ACTIVE_UNIFORMS_ = 0x8B86,
    GL_VENDOR_ = 0x1F00, GL_RENDERER_ = 0x1F01, GL_VERSION_ = 0x1F02,
    GL_PACK_ALIGNMENT_ = 0x0D05, GL_UNPACK_ALIGNMENT_ = 0x0CF5,
};

#ifdef _WIN32
#define XLGL_API __stdcall
#else
#define XLGL_API
#endif

#define XLGL_FUNCS(X) \
    X(const GLubyte*, glGetString, (GLenum)) \
    X(GLenum, glGetError, (void)) \
    X(void, glEnable, (GLenum)) \
    X(void, glDisable, (GLenum)) \
    X(void, glViewport, (GLint, GLint, GLsizei, GLsizei)) \
    X(void, glClearColor, (GLfloat, GLfloat, GLfloat, GLfloat)) \
    X(void, glClear, (unsigned int)) \
    X(void, glPixelStorei, (GLenum, GLint)) \
    X(void, glGenTextures, (GLsizei, GLuint*)) \
    X(void, glDeleteTextures, (GLsizei, const GLuint*)) \
    X(void, glBindTexture, (GLenum, GLuint)) \
    X(void, glTexImage2D, (GLenum, GLint, GLint, GLsizei, GLsizei, GLint, GLenum, GLenum, const void*)) \
    X(void, glTexSubImage2D, (GLenum, GLint, GLint, GLint, GLsizei, GLsizei, GLenum, GLenum, const void*)) \
    X(void, glTexParameteri, (GLenum, GLenum, GLint)) \
    X(void, glReadPixels, (GLint, GLint, GLsizei, GLsizei, GLenum, GLenum, void*)) \
    X(void, glDrawArrays, (GLenum, GLint, GLsizei)) \
    X(void, glActiveTexture, (GLenum)) \
    X(void, glGenBuffers, (GLsizei, GLuint*)) \
    X(void, glDeleteBuffers, (GLsizei, const GLuint*)) \
    X(void, glBindBuffer, (GLenum, GLuint)) \
    X(void, glBufferData, (GLenum, GLsizeiptr, const void*, GLenum)) \
    X(void, glGenVertexArrays, (GLsizei, GLuint*)) \
    X(void, glBindVertexArray, (GLuint)) \
    X(void, glGenFramebuffers, (GLsizei, GLuint*)) \
    X(void, glBindFramebuffer, (GLenum, GLuint)) \
    X(void, glGenRenderbuffers, (GLsizei, GLuint*)) \
    X(void, glBindRenderbuffer, (GLenum, GLuint)) \
    X(void, glRenderbufferStorage, (GLenum, GLenum, GLsizei, GLsizei)) \
    X(void, glFramebufferRenderbuffer, (GLenum, GLenum, GLenum, GLuint)) \
    X(void, glDeleteRenderbuffers, (GLsizei, const GLuint*)) \
    X(GLuint, glCreateShader, (GLenum)) \
    X(void, glShaderSource, (GLuint, GLsizei, const GLchar* const*, const GLint*)) \
    X(void, glCompileShader, (GLuint)) \
    X(void, glGetShaderiv, (GLuint, GLenum, GLint*)) \
    X(void, glGetShaderInfoLog, (GLuint, GLsizei, GLsizei*, GLchar*)) \
    X(void, glDeleteShader, (GLuint)) \
    X(GLuint, glCreateProgram, (void)) \
    X(void, glDeleteProgram, (GLuint)) \
    X(void, glAttachShader, (GLuint, GLuint)) \
    X(void, glDetachShader, (GLuint, GLuint)) \
    X(void, glLinkProgram, (GLuint)) \
    X(void, glGetProgramiv, (GLuint, GLenum, GLint*)) \
    X(void, glGetProgramInfoLog, (GLuint, GLsizei, GLsizei*, GLchar*)) \
    X(void, glUseProgram, (GLuint)) \
    X(void, glGetActiveUniform, (GLuint, GLuint, GLsizei, GLsizei*, GLint*, GLenum*, GLchar*)) \
    X(GLint, glGetUniformLocation, (GLuint, const GLchar*)) \
    X(GLint, glGetAttribLocation, (GLuint, const GLchar*)) \
    X(void, glVertexAttribPointer, (GLuint, GLint, GLenum, GLboolean, GLsizei, const void*)) \
    X(void, glEnableVertexAttribArray, (GLuint)) \
    X(void, glDisableVertexAttribArray, (GLuint)) \
    X(void, glUniform1i, (GLint, GLint)) \
    X(void, glUniform1f, (GLint, GLfloat)) \
    X(void, glUniform2f, (GLint, GLfloat, GLfloat)) \
    X(void, glUniform3f, (GLint, GLfloat, GLfloat, GLfloat)) \
    X(void, glUniform4f, (GLint, GLfloat, GLfloat, GLfloat, GLfloat)) \
    X(void, glUniformMatrix4fv, (GLint, GLsizei, GLboolean, const GLfloat*))

#define XLGL_DECL(ret, name, args) typedef ret (XLGL_API *PFN_##name) args; static PFN_##name name = nullptr;
XLGL_FUNCS(XLGL_DECL)
#undef XLGL_DECL

typedef void* (*GetProcFn)(const char*);

static bool loadFunctions(GetProcFn getProc, std::string& err) {
    bool ok = true;
#define XLGL_LOAD(ret, name, args) name = (PFN_##name)getProc(#name); if (!name) { err += std::string("missing ") + #name + "\n"; ok = false; }
    XLGL_FUNCS(XLGL_LOAD)
#undef XLGL_LOAD
    return ok;
}

// ---- context creation ----
#ifdef _WIN32
static HMODULE g_gl = nullptr;
typedef HGLRC (WINAPI *PFN_wglCreateContext)(HDC);
typedef BOOL (WINAPI *PFN_wglDeleteContext)(HGLRC);
typedef BOOL (WINAPI *PFN_wglMakeCurrent)(HDC, HGLRC);
typedef PROC (WINAPI *PFN_wglGetProcAddress)(LPCSTR);
typedef int (WINAPI *PFN_wglChoosePixelFormat)(HDC, const PIXELFORMATDESCRIPTOR*);
typedef BOOL (WINAPI *PFN_wglSetPixelFormat)(HDC, int, const PIXELFORMATDESCRIPTOR*);
typedef HGLRC (WINAPI *PFN_wglCreateContextAttribsARB)(HDC, HGLRC, const int*);
static PFN_wglGetProcAddress p_wglGetProcAddress = nullptr;

static void* winGetProc(const char* name) {
    void* p = (void*)p_wglGetProcAddress(name);
    if (p == nullptr || p == (void*)1 || p == (void*)2 || p == (void*)3 || p == (void*)-1) {
        p = (void*)GetProcAddress(g_gl, name);
    }
    return p;
}

static HDC g_hdc = nullptr;
static HGLRC g_ctx = nullptr;
static PFN_wglMakeCurrent p_wglMakeCurrent = nullptr;
static unsigned long currentThread() { return (unsigned long)GetCurrentThreadId(); }
// Makes the existing context current on the calling thread (fails while
// another live thread still holds it).
static bool bindToThread(std::string& err) {
    if (!p_wglMakeCurrent(g_hdc, g_ctx)) { err = "context is current on another thread (error " + std::to_string(GetLastError()) + ")"; return false; }
    return true;
}
static void unbindThread() { p_wglMakeCurrent(nullptr, nullptr); }

static bool createContext(const char* glPath, std::string& err) {
    const bool custom = glPath && *glPath;
    // A Mesa drop-in brings its own DLLs beside it, so search its folder first.
    g_gl = custom ? LoadLibraryExA(glPath, nullptr, LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_DEFAULT_DIRS) : LoadLibraryA("opengl32.dll");
    if (!g_gl) { err = std::string("cannot load ") + (custom ? glPath : "opengl32.dll") + " (error " + std::to_string(GetLastError()) + ")"; return false; }
    auto wglCreateContext_ = (PFN_wglCreateContext)GetProcAddress(g_gl, "wglCreateContext");
    auto wglDeleteContext_ = (PFN_wglDeleteContext)GetProcAddress(g_gl, "wglDeleteContext");
    auto wglMakeCurrent_ = (PFN_wglMakeCurrent)GetProcAddress(g_gl, "wglMakeCurrent");
    p_wglGetProcAddress = (PFN_wglGetProcAddress)GetProcAddress(g_gl, "wglGetProcAddress");
    // With the system opengl32.dll the pixel format must go through GDI (it owns
    // the ICD bookkeeping); a Mesa drop-in exports its own wgl* pixel-format API.
    auto choosePF = custom ? (PFN_wglChoosePixelFormat)GetProcAddress(g_gl, "wglChoosePixelFormat") : nullptr;
    auto setPF = custom ? (PFN_wglSetPixelFormat)GetProcAddress(g_gl, "wglSetPixelFormat") : nullptr;
    if (!wglCreateContext_ || !wglMakeCurrent_ || !p_wglGetProcAddress) { err = "WGL entry points missing"; return false; }

    WNDCLASSA wc = {};
    wc.style = CS_OWNDC;
    wc.lpfnWndProc = DefWindowProcA;
    wc.hInstance = GetModuleHandleA(nullptr);
    wc.lpszClassName = "xlgl";
    RegisterClassA(&wc);
    HWND hwnd = CreateWindowA("xlgl", "xlgl", WS_OVERLAPPEDWINDOW, 0, 0, 16, 16, nullptr, nullptr, wc.hInstance, nullptr);
    if (!hwnd) { err = "CreateWindow failed"; return false; }
    HDC hdc = GetDC(hwnd);
    PIXELFORMATDESCRIPTOR pfd = {};
    pfd.nSize = sizeof(pfd);
    pfd.nVersion = 1;
    pfd.dwFlags = PFD_DRAW_TO_WINDOW | PFD_SUPPORT_OPENGL;
    pfd.iPixelType = PFD_TYPE_RGBA;
    pfd.cColorBits = 32;
    pfd.cAlphaBits = 8;
    pfd.iLayerType = PFD_MAIN_PLANE;
    int pf = choosePF ? choosePF(hdc, &pfd) : ChoosePixelFormat(hdc, &pfd);
    if (pf == 0) { err = "no pixel format"; return false; }
    BOOL setOk = setPF ? setPF(hdc, pf, &pfd) : SetPixelFormat(hdc, pf, &pfd);
    if (!setOk) { err = "SetPixelFormat failed"; return false; }
    HGLRC legacy = wglCreateContext_(hdc);
    if (!legacy || !wglMakeCurrent_(hdc, legacy)) { err = "legacy context failed (error " + std::to_string(GetLastError()) + ")"; return false; }
    g_hdc = hdc; g_ctx = legacy; p_wglMakeCurrent = wglMakeCurrent_;
    auto createAttribs = (PFN_wglCreateContextAttribsARB)p_wglGetProcAddress("wglCreateContextAttribsARB");
    if (createAttribs) {
        const int attribs[] = { 0x2091, 3, 0x2092, 3, 0x9126, 0x1, 0 }; // MAJOR 3, MINOR 3, PROFILE core
        HGLRC core = createAttribs(hdc, nullptr, attribs);
        if (core) {
            wglMakeCurrent_(nullptr, nullptr);
            wglDeleteContext_(legacy);
            if (!wglMakeCurrent_(hdc, core)) { err = "core context make current failed"; return false; }
            g_ctx = core;
        }
    }
    return loadFunctions(winGetProc, err);
}
#else
typedef void* EGLDisplay; typedef void* EGLConfig; typedef void* EGLContext; typedef void* EGLSurface;
typedef int EGLint; typedef unsigned int EGLBoolean;
enum : EGLint {
    EGL_NONE_ = 0x3038, EGL_SURFACE_TYPE_ = 0x3033, EGL_PBUFFER_BIT_ = 0x0001, EGL_RENDERABLE_TYPE_ = 0x3040,
    EGL_OPENGL_BIT_ = 0x0008, EGL_RED_SIZE_ = 0x3024, EGL_GREEN_SIZE_ = 0x3023, EGL_BLUE_SIZE_ = 0x3022,
    EGL_ALPHA_SIZE_ = 0x3021, EGL_WIDTH_ = 0x3057, EGL_HEIGHT_ = 0x3056, EGL_OPENGL_API_ = 0x30A2,
    EGL_CONTEXT_MAJOR_VERSION_ = 0x3098, EGL_CONTEXT_MINOR_VERSION_ = 0x30FB,
    EGL_CONTEXT_OPENGL_PROFILE_MASK_ = 0x30FD, EGL_CONTEXT_OPENGL_CORE_PROFILE_BIT_ = 0x1,
    EGL_PLATFORM_SURFACELESS_MESA_ = 0x31DD,
};
typedef void* (*PFN_eglGetProcAddress)(const char*);
typedef EGLDisplay (*PFN_eglGetDisplay)(void*);
typedef EGLDisplay (*PFN_eglGetPlatformDisplayEXT)(unsigned int, void*, const EGLint*);
typedef EGLBoolean (*PFN_eglInitialize)(EGLDisplay, EGLint*, EGLint*);
typedef EGLBoolean (*PFN_eglBindAPI)(unsigned int);
typedef EGLBoolean (*PFN_eglChooseConfig)(EGLDisplay, const EGLint*, EGLConfig*, EGLint, EGLint*);
typedef EGLContext (*PFN_eglCreateContext)(EGLDisplay, EGLConfig, EGLContext, const EGLint*);
typedef EGLSurface (*PFN_eglCreatePbufferSurface)(EGLDisplay, EGLConfig, const EGLint*);
typedef EGLBoolean (*PFN_eglMakeCurrent)(EGLDisplay, EGLSurface, EGLSurface, EGLContext);
typedef EGLint (*PFN_eglGetError)(void);
static PFN_eglGetProcAddress p_eglGetProcAddress = nullptr;
static void* linuxGetProc(const char* name) { return p_eglGetProcAddress(name); }
static EGLDisplay g_dpy = nullptr;
static EGLSurface g_surf = nullptr;
static EGLContext g_ctx = nullptr;
static PFN_eglMakeCurrent p_eglMakeCurrent = nullptr;
static unsigned long currentThread() { return (unsigned long)pthread_self(); }
static bool bindToThread(std::string& err) {
    if (!p_eglMakeCurrent(g_dpy, g_surf, g_surf, g_ctx)) { err = "context is current on another thread"; return false; }
    return true;
}
static void unbindThread() { p_eglMakeCurrent(g_dpy, nullptr, nullptr, nullptr); }

static bool createContext(const char*, std::string& err) {
    void* egl = dlopen("libEGL.so.1", RTLD_NOW);
    if (!egl) egl = dlopen("libEGL.so", RTLD_NOW);
    if (!egl) { err = "cannot load libEGL"; return false; }
    p_eglGetProcAddress = (PFN_eglGetProcAddress)dlsym(egl, "eglGetProcAddress");
    auto getDisplay = (PFN_eglGetDisplay)dlsym(egl, "eglGetDisplay");
    auto initialize = (PFN_eglInitialize)dlsym(egl, "eglInitialize");
    auto bindAPI = (PFN_eglBindAPI)dlsym(egl, "eglBindAPI");
    auto chooseConfig = (PFN_eglChooseConfig)dlsym(egl, "eglChooseConfig");
    auto createCtx = (PFN_eglCreateContext)dlsym(egl, "eglCreateContext");
    auto createPbuffer = (PFN_eglCreatePbufferSurface)dlsym(egl, "eglCreatePbufferSurface");
    auto makeCurrent = (PFN_eglMakeCurrent)dlsym(egl, "eglMakeCurrent");
    auto getError = (PFN_eglGetError)dlsym(egl, "eglGetError");
    if (!p_eglGetProcAddress || !getDisplay || !initialize || !bindAPI || !chooseConfig || !createCtx || !createPbuffer || !makeCurrent) { err = "EGL entry points missing"; return false; }
    EGLDisplay dpy = nullptr;
    auto getPlatformDisplay = (PFN_eglGetPlatformDisplayEXT)p_eglGetProcAddress("eglGetPlatformDisplayEXT");
    if (getPlatformDisplay) dpy = getPlatformDisplay(EGL_PLATFORM_SURFACELESS_MESA_, nullptr, nullptr);
    if (!dpy) dpy = getDisplay(nullptr);
    EGLint maj = 0, min = 0;
    if (!dpy || !initialize(dpy, &maj, &min)) { err = "eglInitialize failed (" + std::to_string(getError ? getError() : 0) + ")"; return false; }
    if (!bindAPI(EGL_OPENGL_API_)) { err = "eglBindAPI(OpenGL) failed"; return false; }
    const EGLint cfgAttribs[] = { EGL_SURFACE_TYPE_, EGL_PBUFFER_BIT_, EGL_RENDERABLE_TYPE_, EGL_OPENGL_BIT_,
        EGL_RED_SIZE_, 8, EGL_GREEN_SIZE_, 8, EGL_BLUE_SIZE_, 8, EGL_ALPHA_SIZE_, 8, EGL_NONE_ };
    EGLConfig cfg = nullptr; EGLint n = 0;
    if (!chooseConfig(dpy, cfgAttribs, &cfg, 1, &n) || n == 0) { err = "eglChooseConfig failed"; return false; }
    const EGLint ctxAttribs[] = { EGL_CONTEXT_MAJOR_VERSION_, 3, EGL_CONTEXT_MINOR_VERSION_, 3,
        EGL_CONTEXT_OPENGL_PROFILE_MASK_, EGL_CONTEXT_OPENGL_CORE_PROFILE_BIT_, EGL_NONE_ };
    EGLContext ctx = createCtx(dpy, cfg, nullptr, ctxAttribs);
    if (!ctx) { err = "eglCreateContext failed (" + std::to_string(getError ? getError() : 0) + ")"; return false; }
    const EGLint pbAttribs[] = { EGL_WIDTH_, 1, EGL_HEIGHT_, 1, EGL_NONE_ };
    EGLSurface surf = createPbuffer(dpy, cfg, pbAttribs);
    if (!makeCurrent(dpy, surf, surf, ctx)) { err = "eglMakeCurrent failed (" + std::to_string(getError ? getError() : 0) + ")"; return false; }
    g_dpy = dpy; g_surf = surf; g_ctx = ctx; p_eglMakeCurrent = makeCurrent;
    return loadFunctions(linuxGetProc, err);
}
#endif

// ---- objects ----
struct Program { GLuint id = 0; std::map<std::string, GLint> uniforms; std::map<std::string, GLint> attribs; };
struct Target { GLuint color = 0, depth = 0, tex = 0; int w = 0, h = 0; };

struct Uniform { std::string name; std::string kind; float v[16]; };
struct Attrib { std::string name; int buffer; int size; int stride; int offset; };
struct DrawReq {
    int program = 0;
    int w = 0, h = 0;
    GLenum mode = GL_TRIANGLE_STRIP_;
    int first = 0, count = 0;
    bool depth = false;
    bool clear = true;
    float clearColor[4] = { 0, 0, 0, 0 };
    std::vector<Attrib> attribs;
    std::vector<Uniform> uniforms;
    const void* texture = nullptr;   // RGBA w*h bytes, or 128 floats when audio
    bool textureAudio = false;
    void* out = nullptr;             // RGBA w*h bytes, bottom row first
};

static std::map<int, Program> g_programs;
static std::map<int, GLuint> g_buffers;
static std::map<uint64_t, Target> g_targets;
static GLuint g_vao = 0, g_fbo = 0, g_audioTex = 0;
static int g_nextId = 1;
static bool g_ready = false;

static std::string infoLog(GLuint obj, bool program) {
    GLint len = 0;
    if (program) glGetProgramiv(obj, GL_INFO_LOG_LENGTH_, &len); else glGetShaderiv(obj, GL_INFO_LOG_LENGTH_, &len);
    std::string log((size_t)(len > 0 ? len : 0), '\0');
    if (len > 0) { GLsizei got = 0; if (program) glGetProgramInfoLog(obj, len, &got, &log[0]); else glGetShaderInfoLog(obj, len, &got, &log[0]); log.resize((size_t)got); }
    return log;
}

static unsigned long g_owner = 0;

// One context per process. A call from another thread (a render worker
// after the one that created it has finished) takes the context over.
inline bool init(const char* glPath, std::string& err) {
    if (g_ready) {
        if (g_owner == currentThread()) return true;
        if (!bindToThread(err)) return false;
        g_owner = currentThread();
        return true;
    }
    if (!createContext(glPath, err)) return false;
    g_owner = currentThread();
    glGenVertexArrays(1, &g_vao);
    glGenFramebuffers(1, &g_fbo);
    glPixelStorei(GL_PACK_ALIGNMENT_, 1);
    glPixelStorei(GL_UNPACK_ALIGNMENT_, 1);
    g_ready = true;
    return true;
}

// Lets go of the context on the calling thread so another thread can init().
inline void release() {
    if (g_ready && g_owner == currentThread()) { unbindThread(); g_owner = 0; }
}

inline std::string getString(GLenum what) { const char* s = g_ready ? (const char*)glGetString(what) : nullptr; return s ? s : ""; }

inline int compile(const std::string& vs, const std::string& fs, std::string& err) {
    GLuint vsh = glCreateShader(GL_VERTEX_SHADER_);
    const GLchar* vsrc = vs.c_str();
    glShaderSource(vsh, 1, &vsrc, nullptr);
    glCompileShader(vsh);
    GLint ok = 0;
    glGetShaderiv(vsh, GL_COMPILE_STATUS_, &ok);
    if (!ok) { err = "vertex shader: " + infoLog(vsh, false); glDeleteShader(vsh); return 0; }
    GLuint fsh = glCreateShader(GL_FRAGMENT_SHADER_);
    const GLchar* fsrc = fs.c_str();
    glShaderSource(fsh, 1, &fsrc, nullptr);
    glCompileShader(fsh);
    glGetShaderiv(fsh, GL_COMPILE_STATUS_, &ok);
    if (!ok) { err = "fragment shader: " + infoLog(fsh, false); glDeleteShader(vsh); glDeleteShader(fsh); return 0; }
    GLuint prog = glCreateProgram();
    glAttachShader(prog, vsh);
    glAttachShader(prog, fsh);
    glLinkProgram(prog);
    glGetProgramiv(prog, GL_LINK_STATUS_, &ok);
    glDetachShader(prog, vsh); glDetachShader(prog, fsh);
    glDeleteShader(vsh); glDeleteShader(fsh);
    if (!ok) { err = "link: " + infoLog(prog, true); glDeleteProgram(prog); return 0; }
    Program p;
    p.id = prog;
    GLint count = 0;
    glGetProgramiv(prog, GL_ACTIVE_UNIFORMS_, &count);
    for (GLint i = 0; i < count; ++i) {
        char buf[256]; GLsizei len = 0; GLint size = 0; GLenum type = 0;
        glGetActiveUniform(prog, (GLuint)i, sizeof buf, &len, &size, &type, buf);
        p.uniforms[buf] = glGetUniformLocation(prog, buf);
    }
    int id = g_nextId++;
    g_programs[id] = p;
    return id;
}

inline void deleteProgram(int id) {
    auto it = g_programs.find(id);
    if (it == g_programs.end()) return;
    glDeleteProgram(it->second.id);
    g_programs.erase(it);
}

inline bool hasUniform(int program, const std::string& name) {
    auto it = g_programs.find(program);
    return it != g_programs.end() && it->second.uniforms.count(name) > 0;
}

inline int createBuffer(const void* data, size_t bytes, bool dynamic) {
    GLuint b = 0;
    glGenBuffers(1, &b);
    glBindBuffer(GL_ARRAY_BUFFER_, b);
    glBufferData(GL_ARRAY_BUFFER_, (GLsizeiptr)bytes, data, dynamic ? GL_DYNAMIC_DRAW_ : GL_STATIC_DRAW_);
    glBindBuffer(GL_ARRAY_BUFFER_, 0);
    int id = g_nextId++;
    g_buffers[id] = b;
    return id;
}

inline bool updateBuffer(int id, const void* data, size_t bytes) {
    auto it = g_buffers.find(id);
    if (it == g_buffers.end()) return false;
    glBindBuffer(GL_ARRAY_BUFFER_, it->second);
    glBufferData(GL_ARRAY_BUFFER_, (GLsizeiptr)bytes, data, GL_DYNAMIC_DRAW_);
    glBindBuffer(GL_ARRAY_BUFFER_, 0);
    return true;
}

inline void deleteBuffer(int id) {
    auto it = g_buffers.find(id);
    if (it == g_buffers.end()) return;
    glDeleteBuffers(1, &it->second);
    g_buffers.erase(it);
}

// ShaderEffect.cpp sizeForRenderBuffer / RenderBufferTexture / allocColorRenderbuffer:
// RGBA renderbuffer plus a linear, clamped RGBA8 input texture per size.
static Target& targetFor(int w, int h, bool depth) {
    uint64_t key = ((uint64_t)(uint32_t)w << 32) | (uint32_t)h;
    auto it = g_targets.find(key);
    if (it != g_targets.end()) {
        if (depth && it->second.depth == 0) {
            glGenRenderbuffers(1, &it->second.depth);
            glBindRenderbuffer(GL_RENDERBUFFER_, it->second.depth);
            glRenderbufferStorage(GL_RENDERBUFFER_, GL_DEPTH_COMPONENT24_, w, h);
        }
        return it->second;
    }
    Target t;
    t.w = w; t.h = h;
    glGenRenderbuffers(1, &t.color);
    glBindRenderbuffer(GL_RENDERBUFFER_, t.color);
    glRenderbufferStorage(GL_RENDERBUFFER_, GL_RGBA_, w, h);
    if (depth) {
        glGenRenderbuffers(1, &t.depth);
        glBindRenderbuffer(GL_RENDERBUFFER_, t.depth);
        glRenderbufferStorage(GL_RENDERBUFFER_, GL_DEPTH_COMPONENT24_, w, h);
    }
    glGenTextures(1, &t.tex);
    glBindTexture(GL_TEXTURE_2D_, t.tex);
    glTexImage2D(GL_TEXTURE_2D_, 0, GL_RGBA_, w, h, 0, GL_RGBA_, GL_UNSIGNED_BYTE_, nullptr);
    glTexParameteri(GL_TEXTURE_2D_, GL_TEXTURE_MIN_FILTER_, GL_LINEAR_);
    glTexParameteri(GL_TEXTURE_2D_, GL_TEXTURE_MAG_FILTER_, GL_LINEAR_);
    glTexParameteri(GL_TEXTURE_2D_, GL_TEXTURE_WRAP_S_, GL_CLAMP_TO_EDGE_);
    glTexParameteri(GL_TEXTURE_2D_, GL_TEXTURE_WRAP_T_, GL_CLAMP_TO_EDGE_);
    glBindTexture(GL_TEXTURE_2D_, 0);
    return g_targets[key] = t;
}

static GLuint audioTexture() {
    if (g_audioTex) return g_audioTex;
    glGenTextures(1, &g_audioTex);
    glBindTexture(GL_TEXTURE_2D_, g_audioTex);
    glTexImage2D(GL_TEXTURE_2D_, 0, GL_RED_, 128, 1, 0, GL_RED_, GL_FLOAT_, nullptr);
    glTexParameteri(GL_TEXTURE_2D_, GL_TEXTURE_MIN_FILTER_, GL_LINEAR_);
    glTexParameteri(GL_TEXTURE_2D_, GL_TEXTURE_MAG_FILTER_, GL_LINEAR_);
    glTexParameteri(GL_TEXTURE_2D_, GL_TEXTURE_WRAP_S_, GL_CLAMP_TO_EDGE_);
    glTexParameteri(GL_TEXTURE_2D_, GL_TEXTURE_WRAP_T_, GL_CLAMP_TO_EDGE_);
    glBindTexture(GL_TEXTURE_2D_, 0);
    return g_audioTex;
}

// Draws into a w*h RGBA target and reads it back into req.out. Returns the
// names of uniforms the program does not have (optimised out or misspelt).
inline bool draw(const DrawReq& req, std::string& err, std::string& unbound) {
    auto it = g_programs.find(req.program);
    if (it == g_programs.end()) { err = "unknown program"; return false; }
    if (req.w <= 0 || req.h <= 0) { err = "bad size"; return false; }
    Program& p = it->second;
    Target& t = targetFor(req.w, req.h, req.depth);
    glBindVertexArray(g_vao);
    glBindFramebuffer(GL_FRAMEBUFFER_, g_fbo);
    glFramebufferRenderbuffer(GL_FRAMEBUFFER_, GL_COLOR_ATTACHMENT0_, GL_RENDERBUFFER_, t.color);
    glFramebufferRenderbuffer(GL_FRAMEBUFFER_, GL_DEPTH_ATTACHMENT_, GL_RENDERBUFFER_, req.depth ? t.depth : 0);
    glViewport(0, 0, req.w, req.h);
    if (req.depth) glEnable(GL_DEPTH_TEST_); else glDisable(GL_DEPTH_TEST_);
    if (req.clear) {
        glClearColor(req.clearColor[0], req.clearColor[1], req.clearColor[2], req.clearColor[3]);
        glClear(GL_COLOR_BUFFER_BIT_ | (req.depth ? GL_DEPTH_BUFFER_BIT_ : 0));
    }
    glActiveTexture(GL_TEXTURE0_);
    if (req.textureAudio) {
        glBindTexture(GL_TEXTURE_2D_, audioTexture());
        if (req.texture) glTexSubImage2D(GL_TEXTURE_2D_, 0, 0, 0, 128, 1, GL_RED_, GL_FLOAT_, req.texture);
    } else {
        glBindTexture(GL_TEXTURE_2D_, t.tex);
        if (req.texture) glTexSubImage2D(GL_TEXTURE_2D_, 0, 0, 0, req.w, req.h, GL_RGBA_, GL_UNSIGNED_BYTE_, req.texture);
    }
    glUseProgram(p.id);
    for (const Uniform& u : req.uniforms) {
        auto l = p.uniforms.find(u.name);
        if (l == p.uniforms.end()) { if (!unbound.empty()) unbound += ","; unbound += u.name; continue; }
        GLint loc = l->second;
        if (u.kind == "i") glUniform1i(loc, (GLint)u.v[0]);
        else if (u.kind == "f") glUniform1f(loc, u.v[0]);
        else if (u.kind == "2f") glUniform2f(loc, u.v[0], u.v[1]);
        else if (u.kind == "3f") glUniform3f(loc, u.v[0], u.v[1], u.v[2]);
        else if (u.kind == "4f") glUniform4f(loc, u.v[0], u.v[1], u.v[2], u.v[3]);
        else if (u.kind == "m4") glUniformMatrix4fv(loc, 1, GL_FALSE_, u.v);
    }
    std::vector<GLuint> enabled;
    for (const Attrib& a : req.attribs) {
        auto b = g_buffers.find(a.buffer);
        if (b == g_buffers.end()) continue;
        auto cached = p.attribs.find(a.name);
        GLint loc;
        if (cached == p.attribs.end()) { loc = glGetAttribLocation(p.id, a.name.c_str()); p.attribs[a.name] = loc; }
        else loc = cached->second;
        if (loc < 0) continue;
        glBindBuffer(GL_ARRAY_BUFFER_, b->second);
        glVertexAttribPointer((GLuint)loc, a.size, GL_FLOAT_, GL_FALSE_, a.stride, (const void*)(intptr_t)a.offset);
        glEnableVertexAttribArray((GLuint)loc);
        enabled.push_back((GLuint)loc);
    }
    glDrawArrays(req.mode, req.first, req.count);
    for (GLuint loc : enabled) glDisableVertexAttribArray(loc);
    if (req.out) glReadPixels(0, 0, req.w, req.h, GL_RGBA_, GL_UNSIGNED_BYTE_, req.out);
    glUseProgram(0);
    glBindBuffer(GL_ARRAY_BUFFER_, 0);
    glBindVertexArray(0);
    glBindFramebuffer(GL_FRAMEBUFFER_, 0);
    GLenum e = glGetError();
    if (e != GL_NO_ERROR_) { err = "GL error " + std::to_string(e); return false; }
    return true;
}

} // namespace xlgl
