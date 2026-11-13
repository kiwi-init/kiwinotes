import AppKit
import Foundation

/// A prova da página do gato no helper (spec #9810), sem ligar o helper de verdade, o mic nem o atalho:
/// `kiwi-helper --cat-probe <pasta> [--backend auto|webgl2|none] [--blocked <url>] [--hold <s>] [--estado <e>]`.
///
/// Usa o mesmo `CatOverlay` do app (a regra sem rede, o `nonPersistent`, a navegação recusada), com a janela fora de
/// todas as telas. Mede a abertura a frio e o tempo do `show` ao primeiro quadro; com `--blocked`, tenta buscar e
/// navegar para a URL (quem roda a prova conta, no servidor dela, que nada chegou). Com `--hold`, deixa o gato visível
/// no `--estado` por esse tempo, para medir a CPU. Uma linha JSON no fim; sai com 1 se alguma conferência falhar.
@MainActor
enum CatOverlayProbe {
    struct Options {
        var dir: String
        var backend = "auto"
        var blocked: String?
        var hold: Double = 0
        var estado = "thinking"
    }

    static func run(_ o: Options) async -> Int32 {
        let overlay = CatOverlay()
        var refused: [String] = []
        overlay.log = { line in
            if line.contains("navigation refused") { refused.append(line) }
            FileHandle.standardError.write(Data("kiwi-helper: \(line)\n".utf8))
        }
        var result: [String: Any] = ["backendAsked": o.backend]
        var ok = true
        func finish() -> Int32 {
            result["ok"] = ok
            let data = (try? JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])) ?? Data("{}".utf8)
            print(String(decoding: data, as: UTF8.self))
            overlay.unload()
            return ok ? 0 : 1
        }

        let start = Date()
        let loaded = AsyncStream<Void> { c in overlay.onLoaded = { c.yield(); c.finish() } }
        if let error = overlay.load(dir: o.dir, query: o.backend == "auto" ? nil : "backend=\(o.backend)") {
            result["error"] = error
            ok = false
            return finish()
        }
        guard await first(of: loaded, timeout: 15) else {
            result["error"] = "load_timeout"
            ok = false
            return finish()
        }
        result["loadMs"] = ms(since: start)
        guard await waitFor("window.kiwiOverlayStats?.ready === true", overlay, timeout: 15) else {
            result["error"] = "ready_timeout"
            result["page"] = (try? await overlay.evaluate("return {state: document.readyState, overlay: typeof window.kiwiOverlay, scripts: [...document.scripts].map(s => s.type + ' ' + s.src), errors: window.__kiwiErrors ?? null}")) ?? NSNull()
            ok = false
            return finish()
        }
        result["coldReadyMs"] = ms(since: start)
        result["backend"] = (try? await overlay.evaluate("return window.kiwiOverlayStats.backend")) ?? NSNull()
        result["origin"] = (try? await overlay.evaluate("return location.protocol")) ?? NSNull()

        // Do `show` ao primeiro quadro apresentado, com a página já pronta: cinco vezes.
        overlay.showOffscreen()
        var frames: [Double] = []
        for _ in 0..<5 {
            _ = try? await overlay.evaluate("window.kiwiOverlayStats.firstFrameMs = null; window.kiwiOverlay.set({estado: 'acordou', visible: true})")
            let shown = Date()
            if await waitFor("window.kiwiOverlayStats.firstFrameMs !== null", overlay, timeout: 3, every: 0.005) {
                let page = (try? await overlay.evaluate("return window.kiwiOverlayStats.firstFrameMs")) as? Double ?? -1
                frames.append(page)
                result["roundTripMs", default: [Double]()] = ((result["roundTripMs"] as? [Double]) ?? []) + [ms(since: shown)]
            } else {
                frames.append(-1)
            }
            _ = try? await overlay.evaluate("window.kiwiOverlay.set({visible: false})")
            try? await Task.sleep(for: .milliseconds(300))
        }
        result["firstFrameMs"] = frames
        if frames.contains(where: { $0 < 0 || $0 > 300 }) { ok = false }

        if let url = o.blocked {
            let fetch = (try? await overlay.evaluate("""
                try { const r = await fetch(\(json(url)), {cache: 'no-store'}); return 'loaded ' + r.status } catch (e) { return 'blocked' }
                """)) as? String ?? "error"
            result["fetch"] = fetch
            if fetch != "blocked" { ok = false }
            let socket = (try? await overlay.evaluate("""
                return await new Promise(done => { try { const ws = new WebSocket(\(json(url.replacingOccurrences(of: "http", with: "ws"))));
                  ws.onopen = () => done('open'); ws.onerror = () => done('blocked'); setTimeout(() => done('blocked'), 2000) } catch (e) { done('blocked') } })
                """)) as? String ?? "error"
            result["websocket"] = socket
            if socket != "blocked" { ok = false }
            _ = try? await overlay.evaluate("location.href = \(json(url))")
            try? await Task.sleep(for: .milliseconds(800))
            let after = (try? await overlay.evaluate("return location.protocol")) as? String ?? "?"
            result["navigation"] = refused.isEmpty ? "allowed" : "refused"
            result["afterNavigation"] = after
            if refused.isEmpty || after != "file:" { ok = false }
        }

        if o.hold > 0 {
            _ = try? await overlay.evaluate("window.kiwiOverlay.set({estado: \(json(o.estado)), visible: true})")
            print(#"{"holding":\#(Int(ProcessInfo.processInfo.processIdentifier))}"#)
            fflush(stdout)
            try? await Task.sleep(for: .seconds(o.hold))
            result["estado"] = (try? await overlay.evaluate("return window.kiwiOverlayStats.estado")) ?? NSNull()
        }
        return finish()
    }

    private static func ms(since date: Date) -> Double { (Date().timeIntervalSince(date) * 10_000).rounded() / 10 }

    private static func json(_ s: String) -> String {
        String(decoding: (try? JSONSerialization.data(withJSONObject: s, options: [.fragmentsAllowed])) ?? Data("\"\"".utf8), as: UTF8.self)
    }

    private static func first(of stream: AsyncStream<Void>, timeout: Double) async -> Bool {
        await withTaskGroup(of: Bool.self) { group in
            group.addTask { for await _ in stream { return true }; return false }
            group.addTask { try? await Task.sleep(for: .seconds(timeout)); return false }
            let r = await group.next() ?? false
            group.cancelAll()
            return r
        }
    }

    private static func waitFor(_ condition: String, _ overlay: CatOverlay, timeout: Double, every: Double = 0.02) async -> Bool {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if (try? await overlay.evaluate("return \(condition)")) as? Bool == true { return true }
            try? await Task.sleep(for: .seconds(every))
        }
        return false
    }
}
