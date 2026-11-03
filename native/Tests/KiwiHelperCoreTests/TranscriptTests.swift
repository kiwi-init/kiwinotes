import XCTest
@testable import KiwiHelperCore

final class TranscriptTests: XCTestCase {
    /// The benchmark's dictionary (spikes/stt-bench/vocab.txt).
    let work = TranscriptDictionary(["DICOM", "DICOM store", "PACS", "Healthcare API", "StudyInstanceUID", "SOPInstanceUID",
                                     "IAM", "pull request", "storage class", "BigQuery", "backfill", "bucket"].map { DictionaryEntry(term: $0) })

    func testFilterDropsBracketedNoiseAndTags() {
        XCTAssertEqual(TranscriptionOutputFilter.filter("[Música] Bom dia (risos)  pessoal"), "Bom dia pessoal")
        XCTAssertEqual(TranscriptionOutputFilter.filter("<think>hmm</think> Olá"), "Olá")
        XCTAssertEqual(TranscriptionOutputFilter.filter("tipo, eu acho que tipo funciona", fillerWords: ["tipo"]), "eu acho que funciona")
    }

    /// Real misses from the T51 benchmark (Parakeet Ultra on the synthetic PT voice).
    func testPhoneticCorrectionFixesBenchmarkMisses() {
        XCTAssertEqual(TranscriptPostProcessor.process("Abre um pulo recueste com o fixo do storage class.", dictionary: work),
                       "Abre um pull request com o fixo do storage class.")
        XCTAssertEqual(TranscriptPostProcessor.process("Vou checar o Sopinstance UID antes de enviar", dictionary: work),
                       "Vou checar o SOPInstanceUID antes de enviar")
        XCTAssertEqual(TranscriptPostProcessor.process("rodar o backfil no big query", dictionary: work), "rodar o backfill no BigQuery")
        XCTAssertEqual(TranscriptPostProcessor.process("check the helthcare api quota", dictionary: work), "check the Healthcare API quota")
    }

    func testPortugueseWithoutTermsIsLeftAlone() {
        let text = "Não esquece de mandar o relatório para a Juliana hoje, às 10."
        XCTAssertEqual(TranscriptPostProcessor.process(text, dictionary: work), text)
        XCTAssertEqual(TranscriptPostProcessor.process(text, dictionary: .empty), text)
    }

    func testAliasesBecomeTheTerm() {
        let d = TranscriptDictionary([DictionaryEntry(term: "kubectl", aliases: ["cube control", "kube control"])])
        XCTAssertEqual(TranscriptPostProcessor.process("Roda o cube control apply", dictionary: d), "Roda o kubectl apply")
        XCTAssertEqual(TranscriptPostProcessor.process("Kube Control, de novo.", dictionary: d), "kubectl, de novo.")
        XCTAssertEqual(TranscriptPostProcessor.process("o cube controller", dictionary: d), "o cube controller", "whole words only")
    }

    func testLongestAliasWins() {
        let r = WordReplacements([.init(original: "cube", replacement: "Cubo"), .init(original: "cube control", replacement: "kubectl")])
        XCTAssertEqual(r.apply(to: "cube control e cube"), "kubectl e Cubo")
    }

    func testEmptyOrNoiseOnlyGivesEmptyText() {
        XCTAssertEqual(TranscriptPostProcessor.process("", dictionary: work), "")
        XCTAssertEqual(TranscriptPostProcessor.process(" [silêncio] ", dictionary: work), "")
    }

    func testDictionaryEntriesFromConfig() {
        let parsed = DictionaryEntry.parse(["DICOM", ["term": "kubectl", "aliases": ["cube control", 3]], ["aliases": ["x"]], "  ", 7])
        XCTAssertEqual(parsed, [DictionaryEntry(term: "DICOM"), DictionaryEntry(term: "kubectl", aliases: ["cube control"])])
        XCTAssertNil(DictionaryEntry.parse("DICOM"), "not a list")
        XCTAssertEqual(TranscriptDictionary([DictionaryEntry(term: "PACS"), DictionaryEntry(term: "pacs")]).terms, ["PACS"])
    }

    func testSpokenLanguage() {
        XCTAssertEqual(SpokenLanguage.detect("Marca uma reunião com o time de segurança amanhã às 10."), "pt")
        XCTAssertEqual(SpokenLanguage.detect("Can you send me the meeting notes after lunch?"), "en")
        XCTAssertNotEqual(SpokenLanguage.detect("ok"), "mix", "too short to call it a mix")
        XCTAssertEqual(SpokenLanguage.detect(""), "")
        XCTAssertEqual(SpokenLanguage.detect("409"), "")
    }

    func testShortClipsArePaddedToTheModelMinimum() {
        XCTAssertEqual(STTInput.padded([]).count, 0)
        XCTAssertEqual(STTInput.padded([Float](repeating: 0.1, count: 1_000)).count, STTInput.minimumSamples)
        XCTAssertEqual(STTInput.padded([Float](repeating: 0.1, count: 20_000)).count, 20_000)
    }

    func testRescoreGuardKeepsTermsOutOfBackgroundSpeech() {
        // The shape of what the CTC rescoring did to background speech (made-up words, not the recording).
        XCTAssertFalse(VocabularyRescoreGuard.accept(original: "Vai lá.", rescored: "DICOM."))
        XCTAssertFalse(VocabularyRescoreGuard.accept(original: "Tá bom então.", rescored: "Kubectl bom então."))
    }

    /// Review #335: clearly spoken words swapped for terms that don't sound like them.
    func testRescoreGuardRefusesSwapsThatDontSoundAlike() {
        XCTAssertFalse(VocabularyRescoreGuard.accept(
            original: "Roda o cubectuget pods no cluster de homologação e me fala o que deu.",
            rescored: "Roda o PACS pods no DICOM e me fala o que deu."))
        XCTAssertFalse(VocabularyRescoreGuard.accept(original: "eu vou sair agora mesmo", rescored: "DICOM PACS sair BigQuery mesmo"))
        XCTAssertFalse(VocabularyRescoreGuard.accept(original: "vou rodar o script agora", rescored: "vou rodar o agora"), "no deletions")
    }

    /// What it fixed in the T51 benchmark.
    func testRescoreGuardKeepsTermFixes() {
        XCTAssertTrue(VocabularyRescoreGuard.accept(
            original: "Vou rodar o backfield de novo no BigQuery", rescored: "Vou rodar o backfill de novo no BigQuery"))
        XCTAssertTrue(VocabularyRescoreGuard.accept(
            original: "O estudio instância o ide veio vazio no retorno do Kido.",
            rescored: "O estudio instância o ide veio vazio no retorno do QIDO."))
    }
}
