// O texto de uma imagem, pelo Vision do macOS (spec #14415, T14423): local, sem rede. Uma linha por bloco de texto.
// A guarda de privacidade (`push-guard.ts`) lê os prints novos com ele antes do push.
//
//   swift scripts/ocr.swift <imagem>
import Foundation
import ImageIO
import Vision

guard CommandLine.arguments.count == 2 else {
    FileHandle.standardError.write("usage: swift ocr.swift <imagem>\n".data(using: .utf8)!)
    exit(2)
}
let url = URL(fileURLWithPath: CommandLine.arguments[1])
// O Vision recusa uma imagem com um lado de até 2 px (T16071: um png de 2×2048 quebrava a guarda). Nela não cabe texto:
// sai sem nenhuma linha, como uma imagem sem texto.
if let source = CGImageSourceCreateWithURL(url as CFURL, nil),
   let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
   let width = props[kCGImagePropertyPixelWidth] as? Int,
   let height = props[kCGImagePropertyPixelHeight] as? Int,
   min(width, height) <= 2 {
    exit(0)
}
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.recognitionLanguages = ["pt-BR", "en-US"]
request.usesLanguageCorrection = false
let handler = VNImageRequestHandler(url: url, options: [:])
do {
    try handler.perform([request])
} catch {
    FileHandle.standardError.write("ocr: \(error.localizedDescription)\n".data(using: .utf8)!)
    exit(1)
}
for observation in request.results ?? [] {
    if let text = observation.topCandidates(1).first?.string { print(text) }
}
