// Node-API binding over glcore.h. All calls run on the thread that called
// init() (the Node main thread), which owns the GL context.
//
//   init({ gl?: string }) -> { renderer, version, vendor }
//   release()                              (unbinds the context from this thread)
//   compile(vs, fs) -> programId            (throws with the compiler log)
//   deleteProgram(id)
//   hasUniform(programId, name) -> boolean
//   createBuffer(Float32Array, dynamic?) -> bufferId
//   updateBuffer(id, Float32Array)
//   deleteBuffer(id)
//   draw({ program, w, h, mode?, first?, count, depth?, clear?, clearColor?,
//          attribs: [{ name, buffer, size, stride?, offset? }],
//          uniforms: [[name, 'i'|'f'|'2f'|'3f'|'4f'|'m4', ...values]],
//          texture?: Uint8Array (RGBA w*h) | Float32Array (128, audio) | null,
//          out?: Uint8Array|Uint8ClampedArray (RGBA w*h, filled bottom row first) })
//        -> string of unbound uniform names ('' when all bound)
#include <napi.h>
#include <cmath>
#include "glcore.h"

// The platform C runtime's math functions. crazd's effects call these (sinf,
// cosf, powf, sin, cos, pow), and the UCRT's float results differ from V8's
// correctly-rounded Math.* by one ulp on a fraction of inputs, which is enough
// to steer a particle simulation. On Windows these reproduce the Windows crazd.
#define CRT_F1(name) static Napi::Value Crt_##name(const Napi::CallbackInfo& info) { \
    return Napi::Number::New(info.Env(), (double)name((float)info[0].As<Napi::Number>().DoubleValue())); }
#define CRT_D1(name) static Napi::Value Crt_##name(const Napi::CallbackInfo& info) { \
    return Napi::Number::New(info.Env(), name(info[0].As<Napi::Number>().DoubleValue())); }
CRT_F1(sinf) CRT_F1(cosf) CRT_F1(tanf) CRT_F1(expf) CRT_F1(logf) CRT_F1(sqrtf)
CRT_D1(sin) CRT_D1(cos) CRT_D1(tan) CRT_D1(exp) CRT_D1(log) CRT_D1(sqrt)
static Napi::Value Crt_powf(const Napi::CallbackInfo& info) {
    return Napi::Number::New(info.Env(), (double)powf((float)info[0].As<Napi::Number>().DoubleValue(), (float)info[1].As<Napi::Number>().DoubleValue()));
}
static Napi::Value Crt_pow(const Napi::CallbackInfo& info) {
    return Napi::Number::New(info.Env(), pow(info[0].As<Napi::Number>().DoubleValue(), info[1].As<Napi::Number>().DoubleValue()));
}
static Napi::Value Crt_atan2f(const Napi::CallbackInfo& info) {
    return Napi::Number::New(info.Env(), (double)atan2f((float)info[0].As<Napi::Number>().DoubleValue(), (float)info[1].As<Napi::Number>().DoubleValue()));
}
static Napi::Value Crt_atan2(const Napi::CallbackInfo& info) {
    return Napi::Number::New(info.Env(), atan2(info[0].As<Napi::Number>().DoubleValue(), info[1].As<Napi::Number>().DoubleValue()));
}

static Napi::Value Init(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    std::string glPath;
    if (info.Length() > 0 && info[0].IsObject()) {
        Napi::Object o = info[0].As<Napi::Object>();
        if (o.Has("gl") && o.Get("gl").IsString()) glPath = o.Get("gl").As<Napi::String>().Utf8Value();
    }
    std::string err;
    if (!xlgl::init(glPath.empty() ? nullptr : glPath.c_str(), err)) {
        Napi::Error::New(env, "xlgl: " + err).ThrowAsJavaScriptException();
        return env.Undefined();
    }
    Napi::Object r = Napi::Object::New(env);
    r.Set("renderer", xlgl::getString(xlgl::GL_RENDERER_));
    r.Set("version", xlgl::getString(xlgl::GL_VERSION_));
    r.Set("vendor", xlgl::getString(xlgl::GL_VENDOR_));
    return r;
}

static Napi::Value Release(const Napi::CallbackInfo& info) {
    xlgl::release();
    return info.Env().Undefined();
}

static Napi::Value Compile(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsString() || !info[1].IsString()) {
        Napi::TypeError::New(env, "compile(vs, fs)").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    std::string err;
    int id = xlgl::compile(info[0].As<Napi::String>().Utf8Value(), info[1].As<Napi::String>().Utf8Value(), err);
    if (id == 0) {
        Napi::Error::New(env, err).ThrowAsJavaScriptException();
        return env.Undefined();
    }
    return Napi::Number::New(env, id);
}

static Napi::Value DeleteProgram(const Napi::CallbackInfo& info) {
    xlgl::deleteProgram(info[0].As<Napi::Number>().Int32Value());
    return info.Env().Undefined();
}

static Napi::Value HasUniform(const Napi::CallbackInfo& info) {
    return Napi::Boolean::New(info.Env(), xlgl::hasUniform(info[0].As<Napi::Number>().Int32Value(), info[1].As<Napi::String>().Utf8Value()));
}

static bool typedArrayBytes(Napi::Value v, const void*& data, size_t& bytes) {
    if (!v.IsTypedArray()) return false;
    Napi::TypedArray ta = v.As<Napi::TypedArray>();
    data = (const uint8_t*)ta.ArrayBuffer().Data() + ta.ByteOffset();
    bytes = ta.ByteLength();
    return true;
}

static Napi::Value CreateBuffer(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    const void* data = nullptr; size_t bytes = 0;
    if (!typedArrayBytes(info[0], data, bytes)) { Napi::TypeError::New(env, "createBuffer(typedArray)").ThrowAsJavaScriptException(); return env.Undefined(); }
    bool dynamic = info.Length() > 1 && info[1].ToBoolean().Value();
    return Napi::Number::New(env, xlgl::createBuffer(data, bytes, dynamic));
}

static Napi::Value UpdateBuffer(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    const void* data = nullptr; size_t bytes = 0;
    if (!typedArrayBytes(info[1], data, bytes)) { Napi::TypeError::New(env, "updateBuffer(id, typedArray)").ThrowAsJavaScriptException(); return env.Undefined(); }
    if (!xlgl::updateBuffer(info[0].As<Napi::Number>().Int32Value(), data, bytes)) Napi::Error::New(env, "unknown buffer").ThrowAsJavaScriptException();
    return env.Undefined();
}

static Napi::Value DeleteBuffer(const Napi::CallbackInfo& info) {
    xlgl::deleteBuffer(info[0].As<Napi::Number>().Int32Value());
    return info.Env().Undefined();
}

static Napi::Value Draw(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsObject()) { Napi::TypeError::New(env, "draw(options)").ThrowAsJavaScriptException(); return env.Undefined(); }
    Napi::Object o = info[0].As<Napi::Object>();
    xlgl::DrawReq req;
    auto num = [&](const char* k, double d) { return o.Has(k) && o.Get(k).IsNumber() ? o.Get(k).As<Napi::Number>().DoubleValue() : d; };
    req.program = (int)num("program", 0);
    req.w = (int)num("w", 0);
    req.h = (int)num("h", 0);
    req.first = (int)num("first", 0);
    req.count = (int)num("count", 4);
    req.depth = o.Has("depth") && o.Get("depth").ToBoolean().Value();
    req.clear = !o.Has("clear") || o.Get("clear").ToBoolean().Value();
    if (o.Has("mode") && o.Get("mode").IsString()) {
        std::string m = o.Get("mode").As<Napi::String>().Utf8Value();
        req.mode = m == "triangles" ? xlgl::GL_TRIANGLES_ : m == "lines" ? xlgl::GL_LINES_ : m == "line_strip" ? xlgl::GL_LINE_STRIP_ : m == "points" ? xlgl::GL_POINTS_ : xlgl::GL_TRIANGLE_STRIP_;
    }
    if (o.Has("clearColor") && o.Get("clearColor").IsArray()) {
        Napi::Array a = o.Get("clearColor").As<Napi::Array>();
        for (uint32_t i = 0; i < 4 && i < a.Length(); ++i) req.clearColor[i] = (float)a.Get(i).As<Napi::Number>().DoubleValue();
    }
    if (o.Has("attribs") && o.Get("attribs").IsArray()) {
        Napi::Array a = o.Get("attribs").As<Napi::Array>();
        for (uint32_t i = 0; i < a.Length(); ++i) {
            Napi::Object e = a.Get(i).As<Napi::Object>();
            xlgl::Attrib at;
            at.name = e.Get("name").As<Napi::String>().Utf8Value();
            at.buffer = e.Get("buffer").As<Napi::Number>().Int32Value();
            at.size = e.Get("size").As<Napi::Number>().Int32Value();
            at.stride = e.Has("stride") ? e.Get("stride").As<Napi::Number>().Int32Value() : 0;
            at.offset = e.Has("offset") ? e.Get("offset").As<Napi::Number>().Int32Value() : 0;
            req.attribs.push_back(at);
        }
    }
    if (o.Has("uniforms") && o.Get("uniforms").IsArray()) {
        Napi::Array a = o.Get("uniforms").As<Napi::Array>();
        for (uint32_t i = 0; i < a.Length(); ++i) {
            if (!a.Get(i).IsArray()) continue;
            Napi::Array u = a.Get(i).As<Napi::Array>();
            if (u.Length() < 3) continue;
            xlgl::Uniform un;
            un.name = u.Get(0u).As<Napi::String>().Utf8Value();
            un.kind = u.Get(1u).As<Napi::String>().Utf8Value();
            memset(un.v, 0, sizeof un.v);
            for (uint32_t k = 2; k < u.Length() && k - 2 < 16; ++k) un.v[k - 2] = (float)u.Get(k).As<Napi::Number>().DoubleValue();
            req.uniforms.push_back(un);
        }
    }
    const void* tex = nullptr; size_t texBytes = 0;
    if (o.Has("texture") && typedArrayBytes(o.Get("texture"), tex, texBytes)) {
        Napi::TypedArray ta = o.Get("texture").As<Napi::TypedArray>();
        if (ta.TypedArrayType() == napi_float32_array) {
            if (texBytes < 128 * 4) { Napi::Error::New(env, "audio texture needs 128 floats").ThrowAsJavaScriptException(); return env.Undefined(); }
            req.textureAudio = true;
        } else if (texBytes < (size_t)req.w * req.h * 4) {
            Napi::Error::New(env, "texture smaller than w*h*4").ThrowAsJavaScriptException(); return env.Undefined();
        }
        req.texture = tex;
    }
    const void* outp = nullptr; size_t outBytes = 0;
    if (o.Has("out") && typedArrayBytes(o.Get("out"), outp, outBytes)) {
        if (outBytes < (size_t)req.w * req.h * 4) { Napi::Error::New(env, "out smaller than w*h*4").ThrowAsJavaScriptException(); return env.Undefined(); }
        req.out = const_cast<void*>(outp);
    }
    std::string err, unbound;
    if (!xlgl::draw(req, err, unbound)) {
        Napi::Error::New(env, err).ThrowAsJavaScriptException();
        return env.Undefined();
    }
    return Napi::String::New(env, unbound);
}

static Napi::Object InitModule(Napi::Env env, Napi::Object exports) {
    exports.Set("init", Napi::Function::New(env, Init));
    exports.Set("release", Napi::Function::New(env, Release));
    exports.Set("compile", Napi::Function::New(env, Compile));
    exports.Set("deleteProgram", Napi::Function::New(env, DeleteProgram));
    exports.Set("hasUniform", Napi::Function::New(env, HasUniform));
    exports.Set("createBuffer", Napi::Function::New(env, CreateBuffer));
    exports.Set("updateBuffer", Napi::Function::New(env, UpdateBuffer));
    exports.Set("deleteBuffer", Napi::Function::New(env, DeleteBuffer));
    exports.Set("draw", Napi::Function::New(env, Draw));
    Napi::Object crt = Napi::Object::New(env);
#define CRT_EXPORT(name) crt.Set(#name, Napi::Function::New(env, Crt_##name));
    CRT_EXPORT(sinf) CRT_EXPORT(cosf) CRT_EXPORT(tanf) CRT_EXPORT(expf) CRT_EXPORT(logf) CRT_EXPORT(sqrtf) CRT_EXPORT(powf) CRT_EXPORT(atan2f)
    CRT_EXPORT(sin) CRT_EXPORT(cos) CRT_EXPORT(tan) CRT_EXPORT(exp) CRT_EXPORT(log) CRT_EXPORT(sqrt) CRT_EXPORT(pow) CRT_EXPORT(atan2)
    exports.Set("crt", crt);
    return exports;
}

NODE_API_MODULE(xlgl, InitModule)
