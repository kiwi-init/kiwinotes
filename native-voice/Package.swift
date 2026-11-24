// swift-tools-version:6.0
// O processo da voz do gato (ADR 0014, T26732): o Qwen3-TTS no MLX, fora do helper. O `kiwi-voice` só se constrói com o
// `xcodebuild` (o SwiftPM da linha de comando não compila os shaders Metal do MLX); o `KiwiVoiceCore`, a lógica pura do
// protocolo, não depende do MLX e roda no `swift test`.
import PackageDescription

let package = Package(
    name: "KiwiVoice",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "kiwi-voice", targets: ["kiwi-voice"]),
        .library(name: "KiwiVoiceCore", targets: ["KiwiVoiceCore"]),
    ],
    dependencies: [
        // A versão fixa do ADR 0014: v0.2.1, commit ff174ab2 (MIT), que traz o mlx-swift 0.33.0.
        .package(url: "https://github.com/Blaizzy/mlx-audio-swift.git", revision: "ff174ab2e961aa7516dedecf273be54c24b6426d"),
    ],
    targets: [
        .target(name: "KiwiVoiceCore"),
        .executableTarget(
            name: "kiwi-voice",
            dependencies: [
                "KiwiVoiceCore",
                .product(name: "MLXAudioTTS", package: "mlx-audio-swift"),
                .product(name: "MLXAudioCore", package: "mlx-audio-swift"),
            ]
        ),
        .testTarget(name: "KiwiVoiceCoreTests", dependencies: ["KiwiVoiceCore"]),
    ],
    // O modo 5 da linguagem, como o mlx-audio-swift: o modelo não é Sendable e vive dentro do actor.
    swiftLanguageModes: [.v5]
)
