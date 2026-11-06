import XCTest
@testable import KiwiHelperCore

/// A preferência "Ao pressionar 🌐" de mentira (AGENTS.md: nada escreve o AppleFnUsageType real do harry).
private final class FakeFnUsage: FnUsageStore {
    var value: Int32?
    var exists: Bool
    var writes: [Int32] = []
    init(_ value: Int32?, exists: Bool = true) {
        self.value = value
        self.exists = exists
    }
    func get() -> Int32? { value }
    func update(_ v: Int32) {
        value = v
        exists = true
        writes.append(v)
    }
    func rawValueExists() -> Bool { exists }
    func clearRawValue() {
        exists = false
        value = 2
    }
}

final class GlobeKeyTests: XCTestCase {
    private var dir: URL!
    private var marker: URL { dir.appendingPathComponent("globe-preference.json") }

    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("kiwi-globe-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: dir)
    }

    private func savedState() -> GlobePreferenceState? {
        (try? Data(contentsOf: marker)).flatMap { try? JSONDecoder().decode(GlobePreferenceState.self, from: $0) }
    }

    /// Guarda, troca para "Nenhuma ação" e devolve ao sair.
    func testFnAsShortcutTurnsTheGlobeActionOffAndQuitGivesItBack() {
        let store = FakeFnUsage(2) // emojis
        let owner = GlobeKeyOwner(store: store, marker: marker)
        owner.start(fnIsShortcut: true)
        XCTAssertEqual(store.value, 0)
        XCTAssertEqual(savedState(), GlobePreferenceState(originalValue: 2, keyExisted: true), "on disk before the swap")
        owner.restore()
        XCTAssertEqual(store.value, 2)
        XCTAssertNil(savedState())
    }

    /// O valor original vai para o disco antes da troca: sem onde gravar, nada troca.
    func testWithoutSavingHowToUndoNothingChanges() {
        let store = FakeFnUsage(3)
        let owner = GlobeKeyOwner(store: store, marker: URL(fileURLWithPath: "/dev/null/kiwi/globe.json"))
        owner.start(fnIsShortcut: true)
        XCTAssertEqual(store.value, 3)
        XCTAssertTrue(store.writes.isEmpty)
    }

    /// Trocar o atalho para outra tecla devolve; voltar para o Fn troca de novo.
    func testChangingTheShortcutGivesItBackAndBack() {
        let store = FakeFnUsage(1)
        let owner = GlobeKeyOwner(store: store, marker: marker)
        owner.start(fnIsShortcut: true)
        owner.set(fnIsShortcut: false)
        XCTAssertEqual(store.value, 1)
        owner.set(fnIsShortcut: true)
        owner.set(fnIsShortcut: true)
        XCTAssertEqual(store.value, 0)
        XCTAssertEqual(store.writes, [0, 1, 0], "twice on Fn is one swap")
    }

    /// Depois de uma queda: na abertura, a troca que sobrou é desfeita primeiro, com o valor da pessoa.
    func testALeftoverFromACrashIsUndoneFirst() {
        let store = FakeFnUsage(2)
        GlobeKeyOwner(store: store, marker: marker).start(fnIsShortcut: true)
        XCTAssertEqual(store.value, 0)
        // O helper caiu: nada devolveu. Abre de novo, agora sem o Fn como atalho.
        let next = GlobeKeyOwner(store: store, marker: marker)
        next.start(fnIsShortcut: false)
        XCTAssertEqual(store.value, 2, "the person's value, not our 'Nothing'")
        XCTAssertNil(savedState())
        // E com o Fn de novo: troca, e guarda o valor certo (o 2, não o 0 que a queda deixou).
        let again = GlobeKeyOwner(store: store, marker: marker)
        GlobeKeyOwner(store: store, marker: marker).start(fnIsShortcut: true)
        again.start(fnIsShortcut: true)
        XCTAssertEqual(store.value, 0)
        XCTAssertEqual(savedState()?.originalValue, 2)
    }

    /// Se a pessoa escolheu outra ação nos Ajustes com o Kiwi aberto, ou depois de uma queda, a dela ganha.
    func testThePersonsNewChoiceWins() {
        let store = FakeFnUsage(2)
        let owner = GlobeKeyOwner(store: store, marker: marker)
        owner.start(fnIsShortcut: true)
        store.value = 3 // ditar, escolhido nos Ajustes
        owner.restore()
        XCTAssertEqual(store.value, 3)
        XCTAssertNil(savedState())

        owner.start(fnIsShortcut: true)
        store.value = 1 // trocou de novo, e o helper caiu
        GlobeKeyOwner(store: store, marker: marker).start(fnIsShortcut: false)
        XCTAssertEqual(store.value, 1)
        XCTAssertNil(savedState())
    }

    /// Já em "Nenhuma ação", ou sem como ler a preferência: nada a fazer.
    func testNothingToDoWhenAlreadyOffOrUnreadable() {
        let off = FakeFnUsage(0)
        GlobeKeyOwner(store: off, marker: marker).start(fnIsShortcut: true)
        XCTAssertTrue(off.writes.isEmpty)
        XCTAssertNil(savedState())
        let unreadable = FakeFnUsage(nil)
        GlobeKeyOwner(store: unreadable, marker: marker).start(fnIsShortcut: true)
        XCTAssertTrue(unreadable.writes.isEmpty)
    }

    /// Uma chave que não estava gravada (o padrão do macOS) volta a não estar.
    func testADefaultValueGoesBackToBeingTheDefault() {
        let store = FakeFnUsage(2, exists: false)
        let owner = GlobeKeyOwner(store: store, marker: marker)
        owner.start(fnIsShortcut: true)
        XCTAssertTrue(store.exists)
        owner.restore()
        XCTAssertFalse(store.exists)
    }
}
