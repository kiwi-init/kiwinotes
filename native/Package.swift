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
    ],
    dependencies: [
        // Parakeet on the Neural Engine (ADR 0003, ADR 0004). A fixed release, not VoiceInk's `main`.
        .package(url: "https://github.com/FluidInference/FluidAudio.git", exact: "0.18.2"),
    ],
    targets: [
        // Pure logic: IPC framing, hotkey gestures, levels, WAV, the transcript's post-processing.
        // Everything here is covered by `swift test`.
        .target(name: "KiwiHelperCore"),
        // The sidecar the Bun app starts with `--socket <path>`.
        .executableTarget(
            name: "kiwi-helper",
            dependencies: ["KiwiHelperCore", .product(name: "FluidAudio", package: "FluidAudio")],
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
    ]
)
