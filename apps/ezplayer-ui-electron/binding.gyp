{
  "targets": [
    {
      "target_name": "win_hirez_timer",
      "sources": ["mainsrc/win-hirez-timer/addon.cc"],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
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
        "<!@(node -p \"require('node-addon-api').include\")",
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "defines": ["NAPI_VERSION=8", "NAPI_DISABLE_CPP_EXCEPTIONS"]
    }
  ]
}
