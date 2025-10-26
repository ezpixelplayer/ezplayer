{
  "targets": [
    {
      "target_name": "win_hirez_timer",
      "sources": ["mainsrc/win-hirez-timer/addon.cc"],
      "include_dirs": [
        "<(module_root_dir)/deps/node-addon-api"
      ],
      "defines": [ "NAPI_VERSION=8", "NAPI_DISABLE_CPP_EXCEPTIONS" ],
      "conditions": [
        ["OS==\"win\"", {
          "libraries": [ "winmm.lib" ]
        }]
      ]
    },
    {
      "target_name": "affinity",
      "sources": ["mainsrc/affinity/affinity.cpp"],
      "include_dirs": [
        "<(module_root_dir)/deps/node-addon-api"
      ],
      "defines": ["NAPI_VERSION=8", "NAPI_DISABLE_CPP_EXCEPTIONS"]
    }
  ]
}
