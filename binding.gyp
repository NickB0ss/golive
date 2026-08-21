{
  "targets": [
    {
      "target_name": "golive_audio",
      "sources": [
        "native/src/addon.cc",
        "native/src/process_util.cc",
        "native/src/loopback_capture.cc"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "cflags_cc": [ "-std=c++17" ],
      "conditions": [
        ["OS=='win'", {
          "libraries": [ "mmdevapi.lib", "ole32.lib", "avrt.lib" ],
          "msvs_settings": {
            "VCCLCompilerTool": {
              "ExceptionHandling": 1,
              "AdditionalOptions": [ "/std:c++17" ]
            }
          }
        }]
      ]
    }
  ]
}
