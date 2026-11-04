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

    /// harry's dictionary and Parakeet's text from his first real test (#589, T591).
    let harry = TranscriptDictionary(["kubectl", "DICOM", "PACS", "Healthcare API", "homologação"].map { DictionaryEntry(term: $0) })

    func testHarrysMissesT591() {
        XCTAssertEqual(TranscriptPostProcessor.process("Roda o cubectl getpods no cluster de homologação e me fala o que deu.", dictionary: harry),
                       "Roda o kubectl getpods no cluster de homologação e me fala o que deu.")
        XCTAssertEqual(TranscriptPostProcessor.process("cubectl apply", dictionary: harry), "kubectl apply")
        // Too far from the spelling for the phonetic correction: that is what the aliases are for.
        let daikon = "O Daikon Store está sem acesso no Rafker API."
        XCTAssertEqual(TranscriptPostProcessor.process(daikon, dictionary: harry), daikon)
        let withAliases = TranscriptDictionary([DictionaryEntry(term: "DICOM", aliases: ["Daikon"]),
                                                DictionaryEntry(term: "Healthcare API", aliases: ["Rafker API"])])
        XCTAssertEqual(TranscriptPostProcessor.process(daikon, dictionary: withAliases), "O DICOM Store está sem acesso no Healthcare API.")
    }

    /// An alias also catches a near form of itself: what the person says changes from one take to the next.
    func testAliasesAreMatchedBySoundToo() {
        let d = TranscriptDictionary([DictionaryEntry(term: "DICOM store", aliases: ["Daikon Store"]),
                                      DictionaryEntry(term: "kubectl", aliases: ["cube control"])])
        XCTAssertEqual(TranscriptPostProcessor.process("o Daikon Stor caiu", dictionary: d), "o DICOM store caiu")
        XCTAssertEqual(TranscriptPostProcessor.process("roda o cube controle", dictionary: d), "roda o kubectl")
        XCTAssertEqual(TranscriptPostProcessor.process("a loja fechou", dictionary: d), "a loja fechou")
    }

    /// An alias may not swallow a neighboring connective (T711, #706). A term still may: in the T51 clips the connective
    /// is often a piece of the split name, and refusing it there lost more than it saved. So "Cloud de novo" with
    /// "Claude" in the dictionary still becomes "Claude novo", as on main.
    func testAliasesDontSwallowConnectivesT711() {
        let kube = TranscriptDictionary([DictionaryEntry(term: "kubectl", aliases: ["cube control"])])
        XCTAssertEqual(TranscriptPostProcessor.process("o cubo de controle caiu", dictionary: kube), "o cubo de controle caiu")
        XCTAssertEqual(TranscriptPostProcessor.process("roda o cube controle", dictionary: kube), "roda o kubectl")
        // Split names whose piece is a connective, from the T51 synthetic clips.
        XCTAssertEqual(TranscriptPostProcessor.process("Sobe o de com novo", dictionary: work), "Sobe o DICOM novo")
        XCTAssertEqual(TranscriptPostProcessor.process("O PAC se ligado não respondeu", dictionary: work), "O PACS ligado não respondeu")
    }

    /// The first letter may differ only for the K sound (c, k, q); the soft c stays out.
    func testOpeningSoundOnlyForK() {
        let d = TranscriptDictionary(["Sentry", "Kafka", "Kubernetes"].map { DictionaryEntry(term: $0) })
        XCTAssertEqual(TranscriptPostProcessor.process("o century inteiro", dictionary: d), "o century inteiro")
        XCTAssertEqual(TranscriptPostProcessor.process("sobe o cubernetes", dictionary: d), "sobe o Kubernetes")
        XCTAssertEqual(TranscriptPostProcessor.process("a casa e a calça", dictionary: d), "a casa e a calça")
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
        typealias S = VocabularyRescoreGuard.Swap
        XCTAssertEqual(VocabularyRescoreGuard.apply(original: "Vai lá.", swaps: [S(from: "Vai lá", to: "DICOM", margin: 2)]), "Vai lá.")
        XCTAssertEqual(VocabularyRescoreGuard.apply(original: "Tá bom então.", swaps: [S(from: "Tá", to: "Kubectl", margin: 2)]),
                       "Tá bom então.")
    }

    /// Review #335: clearly spoken words swapped for terms that don't sound like them.
    func testRescoreGuardRefusesSwapsThatDontSoundAlike() {
        typealias S = VocabularyRescoreGuard.Swap
        let sentence = "Roda o cubectuget pods no cluster de homologação e me fala o que deu."
        XCTAssertEqual(VocabularyRescoreGuard.apply(original: sentence, swaps: [
            S(from: "cubectuget", to: "PACS", margin: 2), S(from: "cluster de homologação", to: "DICOM", margin: 2),
        ]), sentence)
        XCTAssertEqual(VocabularyRescoreGuard.apply(original: "vou rodar o script agora", swaps: [S(from: "script", to: "", margin: 2)]),
                       "vou rodar o script agora", "no deletions")
    }

    /// What it fixed in the T51 benchmark.
    func testRescoreGuardKeepsTermFixes() {
        typealias S = VocabularyRescoreGuard.Swap
        XCTAssertEqual(VocabularyRescoreGuard.apply(original: "Vou rodar o backfield de novo no BigQuery",
                                                    swaps: [S(from: "backfield", to: "backfill", margin: 1)]),
                       "Vou rodar o backfill de novo no BigQuery")
        XCTAssertEqual(VocabularyRescoreGuard.apply(original: "O estudio instância o ide veio vazio no retorno do Kido.",
                                                    swaps: [S(from: "Kido.", to: "QIDO", margin: 1)]),
                       "O estudio instância o ide veio vazio no retorno do QIDO.")
    }

    /// T1973: what the rescoring did to the battery's sentences, swap by swap, with the CTC margins it reported (the
    /// CTC model is English, so on Portuguese the right swap and a wrong one come in the same answer).
    func testRescoreAppliesOnlyTheSwapsThatPass() {
        typealias S = VocabularyRescoreGuard.Swap
        XCTAssertEqual(VocabularyRescoreGuard.apply(
            original: "O de condu Pax caiu de novo.",
            swaps: [S(from: "Pax", to: "PACS", margin: 0.39), S(from: "caiu de novo.", to: "Kiwi Notes", margin: 0.08),
                    S(from: "condu", to: "DICOM", margin: 0.63)]),
            "O DICOM PACS caiu de novo.", "\"condu\" alone doesn't sound like DICOM; \"de condu\" does")
        XCTAssertEqual(VocabularyRescoreGuard.apply(
            original: "Anota isso no Q e notes.",
            swaps: [S(from: "e notes.", to: "Kiwi Notes", margin: 1.77), S(from: "Anota isso no Q", to: "DICOM", margin: 0.12)]),
            "Anota isso no Kiwi Notes.", "\"Q e notes\" sounds closer to Kiwi Notes than \"e notes\"")
        XCTAssertEqual(VocabularyRescoreGuard.apply(original: "Abre o github, por favor.", swaps: [S(from: "github,", to: "GitHub", margin: 1)]),
                       "Abre o GitHub, por favor.", "the punctuation around the stretch stays")
    }

    func testRescoreApplyKeepsTheTextWhenNothingPasses() {
        typealias S = VocabularyRescoreGuard.Swap
        XCTAssertEqual(VocabularyRescoreGuard.apply(original: "Vai lá.", swaps: [S(from: "Vai lá.", to: "DICOM", margin: 2)]), "Vai lá.")
        XCTAssertEqual(VocabularyRescoreGuard.apply(original: "eu vou sair agora mesmo",
                                                    swaps: [S(from: "eu vou", to: "DICOM PACS", margin: 2), S(from: "agora", to: "BigQuery", margin: 0.1)]),
                       "eu vou sair agora mesmo", "agora ~ BigQuery by sound, but the CTC barely prefers it")
        XCTAssertEqual(VocabularyRescoreGuard.apply(original: "Tá bom então, pode ir.", swaps: [S(from: "Tá", to: "Kubectl", margin: 2)]),
                       "Tá bom então, pode ir.")
        XCTAssertEqual(VocabularyRescoreGuard.apply(original: "manda o pax pro pax agora", swaps: [S(from: "nada", to: "PACS", margin: 2)]),
                       "manda o pax pro pax agora", "a stretch that isn't in the text changes nothing")
    }
}
