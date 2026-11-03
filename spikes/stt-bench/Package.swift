// swift-tools-version:5.10
import PackageDescription

// Spike for T51: WhisperKit vs Parakeet (FluidAudio) vs transcribe.cpp (Cohere, Whisper) on PT-BR/EN dictation. Not shipped.
let package = Package(
    name: "stt-bench",
    platforms: [.macOS(.v14)],
    dependencies: [
        .package(url: "https://github.com/argmaxinc/argmax-oss-swift.git", from: "0.9.0"),
        .package(url: "https://github.com/FluidInference/FluidAudio.git", from: "0.17.0"),
        // transcribe.cpp (MIT), the same build VoiceInk @ 19546d2 uses for Cohere Transcribe; it also runs Whisper.
        .package(url: "https://github.com/Beingpax/Transcribe-cpp-swift.git", exact: "0.2.0-dev.856d7c1"),
        // The sidecar's own post-processing (T256), to measure the dictionary and aliases on each engine's text.
        .package(path: "../../native"),
    ],
    targets: [
        .executableTarget(
            name: "stt-bench",
            dependencies: [
                .product(name: "WhisperKit", package: "argmax-oss-swift"),
                .product(name: "FluidAudio", package: "FluidAudio"),
                .product(name: "TranscribeCpp", package: "transcribe-cpp-swift"),
                .product(name: "KiwiHelperCore", package: "native"),
            ]
        ),
    ]
)
