{
  "targets": [
    {
      "target_name": "icmp_ping",
      "sources": ["src/addon.cpp"],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "defines": ["NAPI_VERSION=8", "NAPI_DISABLE_CPP_EXCEPTIONS"],
      "conditions": [
        ["OS==\"win\"", {
          "libraries": ["iphlpapi.lib", "ws2_32.lib"]
        }]
      ]
    }
  ]
}
