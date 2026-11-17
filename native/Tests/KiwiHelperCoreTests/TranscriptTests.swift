import XCTest
@testable import KiwiHelperCore

final class TranscriptTests: XCTestCase {
    /// The benchmark's dictionary (spikes/stt-bench/vocab.txt, in commit 2d5493a2; see docs/arquivo.md).
    let work = TranscriptDictionary(["ORBIT", "ORBIT store", "SILO", "Atlas API", "RecordUID", "ItemUID",
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
        XCTAssertEqual(TranscriptPostProcessor.process("Vou checar o Item UID antes de enviar", dictionary: work),
                       "Vou checar o ItemUID antes de enviar")
        XCTAssertEqual(TranscriptPostProcessor.process("rodar o backfil no big query", dictionary: work), "rodar o backfill no BigQuery")
        XCTAssertEqual(TranscriptPostProcessor.process("check the atlass api quota", dictionary: work), "check the Atlas API quota")
    }

    /// harry's dictionary and Parakeet's text from his first real test (#589, T591).
    let harry = TranscriptDictionary(["kubectl", "ORBIT", "SILO", "Atlas API", "homologação"].map { DictionaryEntry(term: $0) })

    func testHarrysMissesT591() {
        XCTAssertEqual(TranscriptPostProcessor.process("Roda o cubectl getpods no cluster de homologação e me fala o que deu.", dictionary: harry),
                       "Roda o kubectl getpods no cluster de homologação e me fala o que deu.")
        XCTAssertEqual(TranscriptPostProcessor.process("cubectl apply", dictionary: harry), "kubectl apply")
        // Too far from the spelling for the phonetic correction: that is what the aliases are for.
        let daikon = "O Daikon Store está sem acesso no Rafker API."
        XCTAssertEqual(TranscriptPostProcessor.process(daikon, dictionary: harry), daikon)
        let withAliases = TranscriptDictionary([DictionaryEntry(term: "ORBIT", aliases: ["Daikon"]),
                                                DictionaryEntry(term: "Atlas API", aliases: ["Rafker API"])])
        XCTAssertEqual(TranscriptPostProcessor.process(daikon, dictionary: withAliases), "O ORBIT Store está sem acesso no Atlas API.")
    }

    /// An alias also catches a near form of itself: what the person says changes from one take to the next.
    func testAliasesAreMatchedBySoundToo() {
        let d = TranscriptDictionary([DictionaryEntry(term: "ORBIT store", aliases: ["Daikon Store"]),
                                      DictionaryEntry(term: "kubectl", aliases: ["cube control"])])
        XCTAssertEqual(TranscriptPostProcessor.process("o Daikon Stor caiu", dictionary: d), "o ORBIT store caiu")
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
        XCTAssertEqual(TranscriptPostProcessor.process("Sobe o or bit novo", dictionary: work), "Sobe o ORBIT novo")
        XCTAssertEqual(TranscriptPostProcessor.process("O se lo ligado não respondeu", dictionary: work), "O SILO ligado não respondeu")
        // Review #2097: the connective's neighbor is a word of its own, not a piece of the term.
        XCTAssertEqual(TranscriptPostProcessor.process("Eu dei com ele no corredor.", dictionary: work), "Eu dei com ele no corredor.")
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
        let parsed = DictionaryEntry.parse(["ORBIT", ["term": "kubectl", "aliases": ["cube control", 3]], ["aliases": ["x"]], "  ", 7])
        XCTAssertEqual(parsed, [DictionaryEntry(term: "ORBIT"), DictionaryEntry(term: "kubectl", aliases: ["cube control"])])
        XCTAssertNil(DictionaryEntry.parse("ORBIT"), "not a list")
        XCTAssertEqual(TranscriptDictionary([DictionaryEntry(term: "SILO"), DictionaryEntry(term: "silo")]).terms, ["SILO"])
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

    /// The rescore guard with every word heard unsure, so each test sees one rule at a time.
    private func unsure(original: String, swaps: [VocabularyRescoreGuard.Swap]) -> String {
        VocabularyRescoreGuard.apply(original: original, confidence: Array(repeating: 0.5, count: original.split(separator: " ").count),
                                     swaps: swaps)
    }

    /// T1973, #2139: the CTC only swaps what the main model heard unsure. The confidences are the ones Parakeet gave
    /// on the battery's sentences (`say`, the lowest token of each word).
    func testRescoreOnlyTouchesWhatTheModelHeardUnsure() {
        typealias S = VocabularyRescoreGuard.Swap
        XCTAssertEqual(VocabularyRescoreGuard.apply(
            original: "O or bitu Sailo caiu de novo.", confidence: [0.99, 0.48, 0.36, 0.65, 1, 1, 1],
            swaps: [S(from: "Sailo", to: "SILO", margin: 0.39), S(from: "bitu", to: "ORBIT", margin: 0.63)]),
            "O ORBIT SILO caiu de novo.")
        XCTAssertEqual(VocabularyRescoreGuard.apply(
            original: "Anota isso no Q e notes.", confidence: [1, 1, 1, 0.76, 0.71, 0.74],
            swaps: [S(from: "e notes.", to: "Kiwi Notes", margin: 1.77)]),
            "Anota isso no Kiwi Notes.")
        // Heard sure: every rule but this one lets "selo" become SILO.
        let selo = [S(from: "selo", to: "SILO", margin: 0.84)]
        XCTAssertEqual(unsure(original: "O selo dele chegou.", swaps: selo), "O SILO dele chegou.")
        XCTAssertEqual(VocabularyRescoreGuard.apply(original: "O selo dele chegou.", confidence: [1, 1, 1, 1], swaps: selo),
                       "O selo dele chegou.")
        XCTAssertEqual(VocabularyRescoreGuard.apply(original: "Meu selo ficou longe.", confidence: [1, 1, 1, 1],
                                                    swaps: [S(from: "selo", to: "SILO", margin: 0.54)]),
                       "Meu selo ficou longe.")
        XCTAssertEqual(VocabularyRescoreGuard.apply(original: "O or bitu Sailo caiu de novo.", confidence: [1, 1],
                                                    swaps: [S(from: "Sailo", to: "SILO", margin: 0.39)]),
                       "O or bitu Sailo caiu de novo.", "confidences that don't line up with the words: no swap")
    }

    func testWordConfidenceIsTheLowestTokenOfEachWord() {
        XCTAssertEqual(VocabularyRescoreGuard.wordConfidence(tokens: [
            (" O", 0.99), (" de", 0.48), (" con", 0.36), ("du", 0.8), (" Pa", 0.65), ("x", 0.74), (" caiu", 1), (".", 0.9),
        ]), [0.99, 0.48, 0.36, 0.65, 1])
        // "Tem alguma coisa de comer.": the model was unsure of the period, not of "comer" (T1973).
        let comer = VocabularyRescoreGuard.wordConfidence(tokens: [
            (" T", 0.83), ("em", 0.99), (" alg", 1), ("uma", 1), (" co", 1), ("isa", 1), (" de", 1), (" comer", 1), (".", 0.71),
        ])
        XCTAssertEqual(comer, [0.83, 1, 1, 1, 1])
        XCTAssertEqual(VocabularyRescoreGuard.apply(original: "Tem alguma coisa de comer.", confidence: comer,
                                                    swaps: [.init(from: "de comer.", to: "ORBIT", margin: 0.49)]),
                       "Tem alguma coisa de comer.")
        XCTAssertEqual(VocabularyRescoreGuard.wordConfidence(tokens: [("Eu", 1), (" dei", 0.7)]), [1, 0.7], "the first token opens a word")
    }

    func testRescoreGuardKeepsTermsOutOfBackgroundSpeech() {
        // The shape of what the CTC rescoring did to background speech (made-up words, not the recording).
        typealias S = VocabularyRescoreGuard.Swap
        XCTAssertEqual(unsure(original: "Vai lá.", swaps: [S(from: "Vai lá", to: "ORBIT", margin: 2)]), "Vai lá.")
        XCTAssertEqual(unsure(original: "Tá bom então.", swaps: [S(from: "Tá", to: "Kubectl", margin: 2)]),
                       "Tá bom então.")
    }

    /// Review #335: clearly spoken words swapped for terms that don't sound like them.
    func testRescoreGuardRefusesSwapsThatDontSoundAlike() {
        typealias S = VocabularyRescoreGuard.Swap
        let sentence = "Roda o cubectuget pods no cluster de homologação e me fala o que deu."
        XCTAssertEqual(unsure(original: sentence, swaps: [
            S(from: "cubectuget", to: "SILO", margin: 2), S(from: "cluster de homologação", to: "ORBIT", margin: 2),
        ]), sentence)
        XCTAssertEqual(unsure(original: "vou rodar o script agora", swaps: [S(from: "script", to: "", margin: 2)]),
                       "vou rodar o script agora", "no deletions")
    }

    /// What it fixed in the T51 benchmark.
    func testRescoreGuardKeepsTermFixes() {
        typealias S = VocabularyRescoreGuard.Swap
        XCTAssertEqual(unsure(original: "Vou rodar o backfield de novo no BigQuery",
                                                    swaps: [S(from: "backfield", to: "backfill", margin: 1)]),
                       "Vou rodar o backfill de novo no BigQuery")
        XCTAssertEqual(unsure(original: "O registro veio vazio no retorno do Faind.",
                                                    swaps: [S(from: "Faind.", to: "FIND", margin: 1)]),
                       "O registro veio vazio no retorno do FIND.")
    }

    /// T1973: what the rescoring did to the battery's sentences, swap by swap, with the CTC margins it reported (the
    /// CTC model is English, so on Portuguese the right swap and a wrong one come in the same answer).
    func testRescoreAppliesOnlyTheSwapsThatPass() {
        typealias S = VocabularyRescoreGuard.Swap
        XCTAssertEqual(unsure(
            original: "O or bitu Sailo caiu de novo.",
            swaps: [S(from: "Sailo", to: "SILO", margin: 0.39), S(from: "caiu de novo.", to: "Kiwi Notes", margin: 0.08),
                    S(from: "bitu", to: "ORBIT", margin: 0.63)]),
            "O ORBIT SILO caiu de novo.", "\"bitu\" alone doesn't sound like ORBIT; \"or bitu\" does")
        XCTAssertEqual(unsure(
            original: "Anota isso no Q e notes.",
            swaps: [S(from: "e notes.", to: "Kiwi Notes", margin: 1.77), S(from: "Anota isso no Q", to: "ORBIT", margin: 0.12)]),
            "Anota isso no Kiwi Notes.", "\"Q e notes\" sounds closer to Kiwi Notes than \"e notes\"")
        XCTAssertEqual(unsure(original: "Abre o github, por favor.", swaps: [S(from: "github,", to: "GitHub", margin: 1)]),
                       "Abre o GitHub, por favor.", "the punctuation around the stretch stays")
    }

    func testRescoreApplyKeepsTheTextWhenNothingPasses() {
        typealias S = VocabularyRescoreGuard.Swap
        XCTAssertEqual(unsure(original: "Vai lá.", swaps: [S(from: "Vai lá.", to: "ORBIT", margin: 2)]), "Vai lá.")
        XCTAssertEqual(unsure(original: "eu vou sair agora mesmo",
                                                    swaps: [S(from: "eu vou", to: "ORBIT SILO", margin: 2), S(from: "agora", to: "BigQuery", margin: 0.1)]),
                       "eu vou sair agora mesmo", "agora ~ BigQuery by sound, but the CTC barely prefers it")
        XCTAssertEqual(unsure(original: "Tá bom então, pode ir.", swaps: [S(from: "Tá", to: "Kubectl", margin: 2)]),
                       "Tá bom então, pode ir.")
        XCTAssertEqual(unsure(original: "manda o cilo pro cilo agora", swaps: [S(from: "nada", to: "SILO", margin: 2)]),
                       "manda o cilo pro cilo agora", "a stretch that isn't in the text changes nothing")
        // Review #2097: what the rescorer proposed on sentences without any term (the margins it reported).
        XCTAssertEqual(unsure(original: "She packs her bags.", swaps: [S(from: "bags.", to: "SILO", margin: 0.71)]),
                       "She packs her bags.", "bags and SILO share the sound key, not the opening letter")
        XCTAssertEqual(unsure(original: "Eu dei com ele no corredor.", swaps: [S(from: "Eu dei com", to: "ORBIT", margin: 0.15)]),
                       "Eu dei com ele no corredor.")
        XCTAssertEqual(unsure(original: "A paz voltou.", swaps: [S(from: "paz voltou.", to: "SILO", margin: 0.98)]), "A paz voltou.")
        XCTAssertEqual(unsure(original: "O pacote chegou.", swaps: [S(from: "O pacote", to: "SILO", margin: 1.34)]), "O pacote chegou.")
        XCTAssertEqual(unsure(original: "A reunião de amanhã.",
                                                    swaps: [S(from: "de amanhã.", to: "ORBIT", margin: 1.76), S(from: "A reunião", to: "SILO", margin: 0.44)]),
                       "A reunião de amanhã.")
    }
}
