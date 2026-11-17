// Portado de OpenWhispr/resources/macos-globe-listener.swift @ 38a23c0 (MIT). Mudanças: só a peça que fala com o
// macOS; a lógica (guardar, trocar, devolver, a queda) é o `GlobeKeyOwner` do KiwiHelperCore, testado com uma falsa.
//
// L6 (T5457): o `TISUpdateFnUsageType` é o que os Ajustes chamam: grava a preferência e avisa o sistema, que passa a
// valer na hora (escrever a preferência direto só vale no próximo login).

import CoreFoundation
import Darwin
import Foundation
import KiwiHelperCore

final class SystemFnUsage: FnUsageStore {
    private typealias Get = @convention(c) () -> Int32
    private typealias Update = @convention(c) (Int32) -> Void
    private static let domain = "com.apple.HIToolbox" as CFString
    private static let key = "AppleFnUsageType" as CFString

    private static let entryPoints: (get: Get, update: Update)? = {
        guard let carbon = dlopen("/System/Library/Frameworks/Carbon.framework/Carbon", RTLD_LAZY),
              let get = dlsym(carbon, "TISGetFnUsageType"),
              let update = dlsym(carbon, "TISUpdateFnUsageType")
        else { return nil }
        return (unsafeBitCast(get, to: Get.self), unsafeBitCast(update, to: Update.self))
    }()

    func get() -> Int32? { Self.entryPoints?.get() }
    func update(_ value: Int32) { Self.entryPoints?.update(value) }

    // O CFPreferencesCopyAppValue guarda o domínio dos outros em cache pela vida do processo: sincroniza antes.
    func rawValueExists() -> Bool {
        CFPreferencesSynchronize(Self.domain, kCFPreferencesCurrentUser, kCFPreferencesAnyHost)
        return CFPreferencesCopyValue(Self.key, Self.domain, kCFPreferencesCurrentUser, kCFPreferencesAnyHost) != nil
    }

    func clearRawValue() {
        CFPreferencesSetValue(Self.key, nil, Self.domain, kCFPreferencesCurrentUser, kCFPreferencesAnyHost)
        CFPreferencesSynchronize(Self.domain, kCFPreferencesCurrentUser, kCFPreferencesAnyHost)
    }
}
