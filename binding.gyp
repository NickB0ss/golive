{
  "targets": [
    {
      "target_name": "golive_audio",
      "sources": [
        "native/src/addon.cc",
        "native/src/process_util.cc",
        "native/src/loopback_capture.cc",
        "native/src/audio_sessions.cc",
        "native/src/gpu_priority.cc"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "cflags_cc": [ "-std=c++20" ],
      "conditions": [
        ["OS=='win'", {
          "libraries": [ "mmdevapi.lib", "ole32.lib", "avrt.lib" ],
          "msvs_settings": {
            "VCCLCompilerTool": {
              "ExceptionHandling": 1,
              "AdditionalOptions": [ "/std:c++20" ]
            }
          }
        }]
      ]
    },
    {
      "target_name": "golive-media",
      "type": "executable",
      "sources": [
        "native/media/main.cc",
        "native/media/args.cc",
        "native/media/controle.cc",
        "native/media/metricas.cc",
        "native/media/pacote.cc",
        "native/media/pacote_vetores.cc",
        "native/media/sha256.cc"
      ],
      "cflags_cc": [ "-std=c++20", "-pthread" ],
      "ldflags": [ "-pthread" ],
      "conditions": [
        ["OS=='win'", {
          "win_delay_load_hook": "false",
          "msvs_settings": {
            "VCCLCompilerTool": {
              "ExceptionHandling": 1,
              "AdditionalOptions": [ "/std:c++20" ]
            },
            "VCLinkerTool": { "SubSystem": 1 }
          }
        }]
      ]
    }
  ]
}
