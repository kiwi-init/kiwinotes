// swift-tools-version:5.10
import PackageDescription

// Spike da T3245: o Mac recebe o "segurar" da haste do AirPods? Um protótipo que o jow roda. Não vai para o app.
let package = Package(
    name: "airpods-stem",
    platforms: [.macOS(.v14)],
    targets: [
        // Só bytes: os pacotes do AAP e o segurar começa / segurar de novo para. Coberto pelo `swift test`.
        .target(name: "AirPodsStem"),
        .executableTarget(
            name: "kiwi-airpods-probe",
            dependencies: ["AirPodsStem"],
            exclude: ["Info.plist"],
            linkerSettings: [
                .linkedFramework("IOBluetooth"),
                // O NSBluetoothAlwaysUsageDescription: sem ele, o macOS fecha o processo em vez de pedir o Bluetooth.
                .unsafeFlags(["-Xlinker", "-sectcreate", "-Xlinker", "__TEXT", "-Xlinker", "__info_plist",
                              "-Xlinker", "Sources/kiwi-airpods-probe/Info.plist"]),
            ]
        ),
        .testTarget(name: "AirPodsStemTests", dependencies: ["AirPodsStem"]),
    ]
)
