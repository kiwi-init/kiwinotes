// swift-tools-version:5.10
import PackageDescription

let package = Package(
    name: "KiwiHelper",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "kiwi-helper", targets: ["kiwi-helper"]),
        .executable(name: "kiwi-ipc-probe", targets: ["kiwi-ipc-probe"]),
        // For spikes/stt-bench, which reruns the transcript's post-processing on its results (T51).
        .library(name: "KiwiHelperCore", targets: ["KiwiHelperCore"]),
        // The same Whisper runtime as the helper's precise mode, for spikes/stt-bench (T6602).
        .library(name: "TranscribeCpp", targets: ["TranscribeCpp"]),
    ],
    dependencies: [
        // Parakeet on the Neural Engine (ADR 0003, ADR 0004). A fixed release, not VoiceInk's `main`.
        .package(url: "https://github.com/FluidInference/FluidAudio.git", exact: "0.18.2"),
    ],
    targets: [
        // Pure logic: IPC framing, hotkey gestures, levels, WAV, the transcript's post-processing.
        // Everything here is covered by `swift test`.
        .target(name: "KiwiHelperCore"),
        // transcribe.cpp (MIT) for the precise mode's Whisper (T6602, ADR 0003): the release's xcframework, a static
        // libtranscribe with Metal, and its Swift wrapper copied from `bindings/swift` at the same tag (no SwiftPM
        // mirror is published yet).
        .binaryTarget(
            name: "CTranscribe",
            url: "https://github.com/handy-computer/transcribe.cpp/releases/download/v0.4.1/TranscribeCpp.xcframework.zip",
            checksum: "fb5646e564036a6c49659e3efcf72eb567af20da31b8569045c9a08181d35126"
        ),
        .target(
            name: "TranscribeCpp",
            dependencies: ["CTranscribe"],
            exclude: ["LICENSE"],
            linkerSettings: [
                .linkedLibrary("c++"),
                .linkedLibrary("z"),
                .linkedFramework("Accelerate"),
                .linkedFramework("Foundation"),
                .linkedFramework("Metal"),
                .linkedFramework("MetalKit"),
            ]
        ),
        // Local OCR (T2709): Vision for images and scanned pages, PDFKit for a PDF's own text. No model, no network.
        .target(name: "KiwiOCR"),
        // Exportar nota em PDF (T2684): um WKWebView fora da tela, sem janela, imprime o HTML que o app gera.
        .target(name: "KiwiExport"),
        // The sidecar the Bun app starts with `--socket <path>`.
        .executableTarget(
            name: "kiwi-helper",
            dependencies: ["KiwiHelperCore", "KiwiOCR", "KiwiExport", "TranscribeCpp", .product(name: "FluidAudio", package: "FluidAudio")],
            exclude: ["Info.plist"],
            linkerSettings: [
                // Embeds Info.plist (NSMicrophoneUsageDescription) so macOS can ask for the mic.
                .unsafeFlags(["-Xlinker", "-sectcreate", "-Xlinker", "__TEXT", "-Xlinker", "__info_plist",
                              "-Xlinker", "Sources/kiwi-helper/Info.plist"]),
            ]
        ),
        // Dev tool that plays the Bun side: listens on the socket, starts kiwi-helper, prints what arrives.
        .executableTarget(name: "kiwi-ipc-probe", dependencies: ["KiwiHelperCore"]),
        .testTarget(name: "KiwiHelperCoreTests", dependencies: ["KiwiHelperCore"]),
        .testTarget(name: "KiwiOCRTests", dependencies: ["KiwiOCR"]),
        .testTarget(name: "KiwiExportTests", dependencies: ["KiwiExport"]),
    ]
)
