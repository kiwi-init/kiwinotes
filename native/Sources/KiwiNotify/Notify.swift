// A notificação do app (spec #9839, T10525): uma dylib que o processo do app (Bun) carrega por `bun:ffi`.
//
// Quem notifica é o próprio app, e não o helper: o `UNUserNotificationCenter` só funciona dentro de um `.app`, e o
// helper é um executável solto em Resources/app/bin. Carregada no processo do app, a `Bundle.main` é o Kiwi Notes.app.
//
// Regras:
// - Nada aqui pede a permissão sozinho. Só `kiwi_notify_request` chama `requestAuthorization`, e o app só a chama no
//   clique da pessoa em "Ligar as notificações" (Ajustes › Agente). `kiwi_notify_post` sem a permissão não faz nada.
// - O clique na notificação volta pelo delegate que a engine (Electrobun) já registra, como o evento
//   `notification-response` com o id que o app escolheu.
// - Nenhum teste carrega esta dylib: os testes usam um aviso falso (app/src/agent/notice.ts).

import Foundation
import UserNotifications

/// Os status que o app entende. -1 é "não dá": um processo fora de um `.app` (bun test, a CLI headless).
private enum Status: Int32 {
    case unavailable = -1, notDetermined = 0, denied = 1, authorized = 2, provisional = 3
}

private func center() -> UNUserNotificationCenter? {
    // `UNUserNotificationCenter.current()` derruba o processo fora de um `.app` (sem bundle id ou sem a pasta .app).
    guard Bundle.main.bundleIdentifier != nil, Bundle.main.bundleURL.pathExtension == "app" else { return nil }
    return UNUserNotificationCenter.current()
}

/// O status da permissão, lido sem pedir nada. Espera a resposta do sistema até 2 s.
@_cdecl("kiwi_notify_status")
public func kiwiNotifyStatus() -> Int32 {
    guard let center = center() else { return Status.unavailable.rawValue }
    let done = DispatchSemaphore(value: 0)
    var status = Status.unavailable
    center.getNotificationSettings { settings in
        switch settings.authorizationStatus {
        case .notDetermined: status = .notDetermined
        case .denied: status = .denied
        case .authorized: status = .authorized
        case .provisional: status = .provisional
        default: status = .authorized
        }
        done.signal()
    }
    _ = done.wait(timeout: .now() + 2)
    return status.rawValue
}

/// Pede a permissão ao macOS. Só no clique da pessoa. Não espera: o app relê o status depois.
@_cdecl("kiwi_notify_request")
public func kiwiNotifyRequest() -> Int32 {
    guard let center = center() else { return Status.unavailable.rawValue }
    center.requestAuthorization(options: [.alert, .sound]) { _, _ in }
    return 0
}

private func string(_ p: UnsafePointer<CChar>?) -> String { p.map { String(cString: $0) } ?? "" }

/// Mostra a notificação com o id escolhido pelo app (o mesmo id substitui a anterior). Sem a permissão, não faz nada.
@_cdecl("kiwi_notify_post")
public func kiwiNotifyPost(_ id: UnsafePointer<CChar>?, _ title: UnsafePointer<CChar>?, _ body: UnsafePointer<CChar>?) -> Int32 {
    guard let center = center() else { return Status.unavailable.rawValue }
    let status = kiwiNotifyStatus()
    guard status == Status.authorized.rawValue || status == Status.provisional.rawValue else { return status }
    let content = UNMutableNotificationContent()
    content.title = string(title)
    content.body = string(body)
    content.sound = .default
    center.add(UNNotificationRequest(identifier: string(id), content: content, trigger: nil))
    return 0
}

/// Tira a notificação da tela e da Central de Notificações.
@_cdecl("kiwi_notify_remove")
public func kiwiNotifyRemove(_ id: UnsafePointer<CChar>?) {
    guard let center = center() else { return }
    let ids = [string(id)]
    center.removePendingNotificationRequests(withIdentifiers: ids)
    center.removeDeliveredNotifications(withIdentifiers: ids)
}
