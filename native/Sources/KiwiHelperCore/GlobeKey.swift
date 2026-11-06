// Portado de OpenWhispr/resources/macos-globe-listener.swift @ 38a23c0 (MIT). Mudanças: a lógica sai para uma classe
// testável, com a preferência injetada (`FnUsageStore`): os testes e o headless nunca tocam no AppleFnUsageType real
// (AGENTS.md, #4871). Na abertura, uma troca que sobrou de uma queda é desfeita antes de qualquer outra coisa.
//
// L6 (T5457, issue #157): com o Kiwi aberto e o Fn como atalho do ditado, o Fn é sempre do ditado (decisão do harry,
// #4756). O macOS roda a ação do 🌐 (Ajustes › Teclado › "Ao pressionar 🌐": emojis, trocar o idioma, ditar) no
// WindowServer, antes de qualquer event tap: não dá para engolir a tecla. O único jeito é deixar a preferência em
// "Nenhuma ação" enquanto o Kiwi usa o Fn, e devolver a da pessoa depois.

import Foundation

/// A preferência "Ao pressionar 🌐" (`AppleFnUsageType` em `com.apple.HIToolbox`): 0 nenhuma ação, 1 trocar a fonte
/// de entrada, 2 emojis, 3 ditar. No app, pelo `TISUpdateFnUsageType` (o mesmo dos Ajustes: vale na hora); nos testes
/// e no headless, uma peça falsa.
public protocol FnUsageStore: AnyObject {
    /// O valor de agora, ou nil se não dá para ler (sem o Carbon): aí nada muda.
    func get() -> Int32?
    func update(_ value: Int32)
    /// A chave está gravada nas preferências (senão o valor é o padrão que o macOS calcula).
    func rawValueExists() -> Bool
    /// Apaga a chave, para o valor voltar a ser o padrão do macOS.
    func clearRawValue()
}

/// O que fica no disco antes da troca: como voltar, mesmo depois de uma queda.
public struct GlobePreferenceState: Codable, Equatable, Sendable {
    public var version: Int
    public var originalValue: Int32
    public var keyExisted: Bool
    public init(version: Int = 1, originalValue: Int32, keyExisted: Bool) {
        self.version = version
        self.originalValue = originalValue
        self.keyExisted = keyExisted
    }
}

public final class GlobeKeyOwner {
    public static let doNothing: Int32 = 0
    private let store: FnUsageStore?
    private let marker: URL?
    private let log: (String) -> Void
    /// A troca que é nossa agora (o valor da pessoa), ou nil.
    public private(set) var owned: GlobePreferenceState?

    public init(store: FnUsageStore?, marker: URL?, log: @escaping (String) -> Void = { _ in }) {
        self.store = store
        self.marker = marker
        self.log = log
    }

    /// Na abertura do helper: desfaz o que sobrou de uma queda e, se o Fn é o atalho, troca de novo.
    public func start(fnIsShortcut: Bool) {
        recoverLeftover()
        restore()
        set(fnIsShortcut: fnIsShortcut)
    }

    /// O atalho do ditado mudou (ou o helper abriu): com o Fn, troca; sem o Fn, devolve.
    public func set(fnIsShortcut: Bool) {
        if fnIsShortcut { apply() } else { restore() }
    }

    /// Adota a marca de uma queda: o valor dela é o da pessoa, não o "Nenhuma ação" que a gente deixou.
    func recoverLeftover() {
        guard owned == nil, let state = readMarker(), let store, let now = store.get() else { return }
        if now == Self.doNothing {
            owned = state
        } else {
            // A pessoa escolheu outra ação depois da queda: a dela ganha.
            removeMarker()
        }
    }

    func apply() {
        guard owned == nil, let store, let original = store.get() else { return }
        guard original != Self.doNothing else { return } // já é "Nenhuma ação": nada a trocar nem a devolver
        let state = GlobePreferenceState(originalValue: original, keyExisted: store.rawValueExists())
        // Primeiro o disco, depois a troca: uma queda no meio sempre sabe como voltar (#4871).
        guard writeMarker(state) else { return log("fn: the 🌐 action stays as it is (couldn't save how to undo)") }
        owned = state
        store.update(Self.doNothing)
        log("fn: the 🌐 action is off while Kiwi uses Fn (was \(original))")
    }

    /// Devolve a preferência da pessoa, se a troca é nossa. Se ela mudou a ação com o Kiwi aberto, a dela fica.
    public func restore() {
        guard let state = owned, let store else { return }
        owned = nil
        if store.get() == Self.doNothing {
            store.update(state.originalValue)
            if !state.keyExisted { store.clearRawValue() }
            log("fn: the 🌐 action is back (\(state.originalValue))")
        } else {
            log("fn: the 🌐 action was changed meanwhile; it stays")
        }
        removeMarker()
    }

    private func readMarker() -> GlobePreferenceState? {
        guard let marker, let data = try? Data(contentsOf: marker) else { return nil }
        guard let state = try? JSONDecoder().decode(GlobePreferenceState.self, from: data), state.version == 1 else {
            removeMarker()
            return nil
        }
        return state
    }

    private func writeMarker(_ state: GlobePreferenceState) -> Bool {
        guard let marker, let data = try? JSONEncoder().encode(state) else { return false }
        do {
            try FileManager.default.createDirectory(at: marker.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: marker, options: .atomic)
            return true
        } catch {
            return false
        }
    }

    private func removeMarker() {
        guard let marker else { return }
        try? FileManager.default.removeItem(at: marker)
    }
}

/// A peça falsa (testes, headless, KIWI_DEBUG): a preferência num arquivo JSON, nunca a real.
public final class FileFnUsageStore: FnUsageStore {
    private let file: URL
    public init(file: URL, initial: Int32? = nil) {
        self.file = file
        if let initial, (try? Data(contentsOf: file)) == nil { write(["value": Int(initial), "exists": true]) }
    }
    private func read() -> [String: Any] {
        guard let data = try? Data(contentsOf: file), let o = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        return o
    }
    private func write(_ o: [String: Any]) {
        try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? JSONSerialization.data(withJSONObject: o).write(to: file, options: .atomic)
    }
    public func get() -> Int32? { (read()["value"] as? Int).map(Int32.init) ?? 2 }
    public func update(_ value: Int32) { write(["value": Int(value), "exists": true]) }
    public func rawValueExists() -> Bool { read()["exists"] as? Bool ?? false }
    public func clearRawValue() { write(["value": 2, "exists": false]) }
}
