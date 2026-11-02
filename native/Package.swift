// swift-tools-version:5.10
import PackageDescription

let package = Package(
    name: "KiwiHelper",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "kiwi-helper", targets: ["kiwi-helper"]),
        .executable(name: "kiwi-ipc-probe", targets: ["kiwi-ipc-probe"]),
    ],
    targets: [
        // Pure logic: IPC framing, hotkey gestures, levels, WAV. Everything here is covered by `swift test`.
        .target(name: "KiwiHelperCore"),
        // The sidecar the Bun app starts with `--socket <path>`.
        .executableTarget(
            name: "kiwi-helper",
            dependencies: ["KiwiHelperCore"],
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
