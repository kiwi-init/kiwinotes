// swift-tools-version:5.10
import PackageDescription

// Spike for T51: WhisperKit vs Parakeet (FluidAudio) on PT-BR/EN dictation. Not shipped.
let package = Package(
    name: "stt-bench",
    platforms: [.macOS(.v14)],
    dependencies: [
        .package(url: "https://github.com/argmaxinc/argmax-oss-swift.git", from: "0.9.0"),
        .package(url: "https://github.com/FluidInference/FluidAudio.git", from: "0.17.0"),
    ],
    targets: [
        .executableTarget(
            name: "stt-bench",
            dependencies: [
                .product(name: "WhisperKit", package: "argmax-oss-swift"),
                .product(name: "FluidAudio", package: "FluidAudio"),
            ]
        ),
    ]
)
