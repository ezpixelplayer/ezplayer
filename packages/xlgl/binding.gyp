{
  "targets": [
    {
      "target_name": "xlgl",
      "sources": ["src/xlgl.cpp"],
      "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
      "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS", "NAPI_VERSION=8"],
      "cflags_cc": ["-std=c++17", "-fexceptions"],
      "conditions": [
        ["OS=='win'", {
          "libraries": ["user32.lib", "gdi32.lib"],
          "msvs_settings": { "VCCLCompilerTool": { "ExceptionHandling": 1, "AdditionalOptions": ["/std:c++17"] } }
        }],
        ["OS=='linux'", { "libraries": ["-ldl"] }]
      ]
    }
  ]
}
