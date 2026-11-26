import { describe, expect, test } from "bun:test";
import { numberWords, ordinalWords, yearWords } from "./fala-en.ts";
import { cortarFrases, FRASE_MAX, frasesComLingua, frasesParaFala, porExtenso, semMarkdown, textoParaFala } from "./fala.ts";

describe("porExtenso (T26709)", () => {
  test("os números em pt-BR, com o 'e' onde se fala", () => {
    const casos: [number, string][] = [
      [0, "zero"],
      [7, "sete"],
      [16, "dezesseis"],
      [21, "vinte e um"],
      [100, "cem"],
      [101, "cento e um"],
      [999, "novecentos e noventa e nove"],
      [1000, "mil"],
      [1005, "mil e cinco"],
      [1200, "mil e duzentos"],
      [1234, "mil duzentos e trinta e quatro"],
      [21000, "vinte e um mil"],
      [1_000_000, "um milhão"],
      [2_000_100, "dois milhões e cem"],
      [1_200_000, "um milhão e duzentos mil"],
      [3_000_000_000, "três bilhões"],
    ];
    for (const [n, s] of casos) expect(porExtenso(n)).toBe(s);
  });

  test("no feminino, menos os milhões", () => {
    expect(porExtenso(2, true)).toBe("duas");
    expect(porExtenso(21, true)).toBe("vinte e uma");
    expect(porExtenso(200, true)).toBe("duzentas");
    expect(porExtenso(2_000_000, true)).toBe("dois milhões");
  });

  test("fora do alcance é erro", () => {
    expect(() => porExtenso(-1)).toThrow();
    expect(() => porExtenso(1.5)).toThrow();
    expect(() => porExtenso(1e12)).toThrow();
  });
});

describe("textoParaFala (T26709)", () => {
  const casos: [string, string][] = [
    // Números, decimais, negativos e intervalos.
    ["Faltam 2 dias.", "Faltam dois dias."],
    ["São 1.234 notas.", "São mil duzentas e trinta e quatro notas."],
    ["Subiu 3,5 pontos.", "Subiu três vírgula cinco pontos."],
    ["Ficou em -4.", "Ficou em menos quatro."],
    ["De 10-20 pessoas.", "De dez a vinte pessoas."],
    // Dinheiro e porcentagem.
    ["Custa R$ 1.234,50.", "Custa mil duzentos e trinta e quatro reais e cinquenta centavos."],
    ["Custa R$1,00.", "Custa um real."],
    ["Custa R$ 0,99.", "Custa noventa e nove centavos."],
    ["O orçamento é R$ 2.000.000.", "O orçamento é dois milhões de reais."],
    ["Custa US$ 30.", "Custa trinta dólares."],
    ["Cresceu 15%.", "Cresceu quinze por cento."],
    ["Caiu -2,5%.", "Caiu menos dois vírgula cinco por cento."],
    // Datas e horas.
    ["Até 24/11/2026.", "Até vinte e quatro de novembro de dois mil e vinte e seis."],
    ["Até 2026-03-01.", "Até primeiro de março de dois mil e vinte e seis."],
    ["Em 5/7.", "Em cinco de julho."],
    ["Às 14h30.", "Às catorze e trinta."],
    ["Às 9h.", "Às nove horas."],
    ["Às 13:00.", "Às treze horas."],
    ["Às 1:00.", "Às uma hora."],
    ["Às 21:00.", "Às vinte e uma horas."],
    ["Às 12:00.", "Às meio-dia."],
    ["Às 0:00.", "Às meia-noite."],
    ["Às 08:05.", "Às oito e cinco."],
    // Unidades, ordinais e graus.
    ["Faltam 3 km.", "Faltam três quilômetros."],
    ["O arquivo tem 1 MB.", "O arquivo tem um megabyte."],
    ["Leva 40 min.", "Leva quarenta minutos."],
    ["O 1º item e a 2ª lista.", "O primeiro item e a segunda lista."],
    ["Fez 25°C.", "Fez vinte e cinco graus."],
    // Siglas e símbolos.
    ["O PDF e o CSV.", "O pê dê efe e o cê esse vê."],
    ["A ONU e o PIX.", "A ONU e o pix."],
    // Lidas como palavra, não soletradas (T27958): "ongue", não "ó ene gê".
    ["A ONG doou.", "A ong doou."],
    ["Duas ONGs e o SUS.", "Duas ongs e o sus."],
    ["O MEC e o CPF.", "O mec e o cê pê efe."],
    ["ATENÇÃO aqui.", "atenção aqui."],
    ["Faça HOJE, é a META.", "Faça hoje, é a meta."],
    ["O HTML e a IA.", "O agá tê eme ele e a i a."],
    // O gênero do número (rodada 1 do T26709).
    ["Você tem 2 reuniões amanhã.", "Você tem duas reuniões amanhã."],
    ["Achei 1 nota e 21 tarefas.", "Achei uma nota e vinte e uma tarefas."],
    ["A reunião dura 1 hora.", "A reunião dura uma hora."],
    ["São 2 pessoas em 2 semanas e 2 páginas.", "São duas pessoas em duas semanas e duas páginas."],
    ["Faltam 2 dias e 2 problemas.", "Faltam dois dias e dois problemas."],
    ["Li 200 mensagens.", "Li duzentas mensagens."],
    ["De 1 a 2 dias.", "De um a dois dias."],
    ["Dura 2,5 horas.", "Dura dois vírgula cinco horas."],
    // O ponto entre números que não é milhar.
    ["A versão 3.5 saiu.", "A versão três ponto cinco saiu."],
    ["O IP 192.168.0.1 caiu.", "O i pê cento e noventa e dois ponto cento e sessenta e oito ponto zero ponto um caiu."],
    ["Ana & Beto.", "Ana e Beto."],
    ["2 + 2 = 4.", "dois mais dois igual a quatro."],
    ["Escreva para ana@exemplo.com.", "Escreva para ana arroba exemplo ponto com."],
    ["Veja o #12.", "Veja o número doze."],
    ["O Sr. Silva e a Dra. Ana.", "O senhor Silva e a doutora Ana."],
    // Um número longo demais é dígito por dígito.
    ["O código é 1234567890123.", "O código é um dois três quatro cinco seis sete oito nove zero um dois três."],
  ];
  for (const [de, para] of casos) test(JSON.stringify(de), () => expect(textoParaFala(de)).toBe(para));

  test("Markdown, links, código e emoji nunca são falados", () => {
    const t = textoParaFala(
      [
        "## Resumo",
        "Li a **nota** _Ideias_ e o ~~rascunho~~ [Plano](Projetos/Plano.md) 🎉.",
        "```ts",
        "const segredo = 1;",
        "```",
        "- Primeiro ponto",
        "- [ ] Tarefa aberta",
        "> Uma citação",
        "| A | B |",
        "|---|---|",
        "Mais em https://exemplo.com/pagina e em [[Pasta/Outra nota]] e [[Plano|o plano]], sem `rodar()`.",
        "![figura](imagem.png)",
      ].join("\n"),
    );
    expect(t).toBe("Resumo. Li a nota Ideias e o rascunho Plano. Primeiro ponto. Tarefa aberta. Uma citação. A, B. Mais em e em Outra nota e o plano, sem.");
    for (const nunca of ["**", "`", "http", "segredo", "rodar", "🎉", "[", "]", "(", "#", "|", ">", "figura", "imagem"]) expect(t).not.toContain(nunca);
  });

  test("o raciocínio e as chamadas de ferramenta não são falados", () => {
    expect(textoParaFala("<thinking>vou ler a nota</thinking>Pronto.<tool_call>{\"fazer\":\"ler\"}</tool_call> Anotei.")).toBe("Pronto. Anotei.");
  });

  test("um texto só de código ou de link fica vazio", () => {
    expect(textoParaFala("```\nnada\n```")).toBe("");
    expect(textoParaFala("https://exemplo.com")).toBe("");
    expect(frasesParaFala("`so codigo`")).toEqual([]);
  });

  test("semMarkdown deixa o texto das ênfases", () => {
    expect(semMarkdown("um *dois* __tres__ ==quatro==")).toBe("um dois tres quatro");
    // Um asterisco solto e um nome_com_sublinhado ficam como estão (o sublinhado sai depois, como símbolo).
    expect(semMarkdown("5 * 3 e nome_com_sublinhado")).toBe("5 * 3 e nome_com_sublinhado");
  });
});

describe("cortarFrases (T26709)", () => {
  test("por frase, na ordem, para a voz começar antes do fim", () => {
    expect(frasesParaFala("Anotei na nota Ideias. A reunião é às 14h! Quer que eu leia?")).toEqual([
      "Anotei na nota Ideias.",
      "A reunião é às catorze horas!",
      "Quer que eu leia?",
    ]);
  });

  test("o ponto de um número ou de uma abreviação não corta", () => {
    expect(frasesParaFala("São 1.234 notas, Sr. Silva. Pronto.")).toEqual(["São mil duzentas e trinta e quatro notas, senhor Silva.", "Pronto."]);
  });

  test("uma frase longa demais se corta numa pausa, sem passar do máximo", () => {
    const longa = Array.from({ length: 30 }, (_, i) => `parte ${"x".repeat(10)} ${i}`).join(", ") + ".";
    const frases = cortarFrases(textoParaFala(longa));
    expect(frases.length).toBeGreaterThan(1);
    for (const f of frases) expect(f.length).toBeLessThanOrEqual(FRASE_MAX);
    expect(frases.join(" ")).toBe(textoParaFala(longa));
  });

  test("o ponto entre números não corta a frase", () => {
    expect(frasesParaFala("A versão 3.5 saiu. Pronto.")).toEqual(["A versão três ponto cinco saiu.", "Pronto."]);
    expect(frasesParaFala("Saiu a v2026.11.13 hoje.")).toHaveLength(1);
  });

  test("um pedaço sem letra nem número não vira frase", () => {
    expect(cortarFrases("Oi. … !")).toEqual(["Oi."]);
  });
});

describe("a fala em inglês (T31029, harry #31028)", () => {
  test("os números em inglês, com hífen e sem 'and'", () => {
    const casos: [number, string][] = [
      [0, "zero"],
      [13, "thirteen"],
      [21, "twenty-one"],
      [105, "one hundred five"],
      [1234, "one thousand two hundred thirty-four"],
      [60_000, "sixty thousand"],
      [2_000_100, "two million one hundred"],
      [3_000_000_000, "three billion"],
    ];
    for (const [n, s] of casos) expect(numberWords(n)).toBe(s);
    expect(() => numberWords(1e12)).toThrow();
  });

  test("ordinais e anos como se falam", () => {
    expect([1, 2, 3, 5, 12, 20, 24, 100].map(ordinalWords)).toEqual(["first", "second", "third", "fifth", "twelfth", "twentieth", "twenty-fourth", "one hundredth"]);
    expect([2026, 2005, 2010, 1999, 1905, 1900].map(yearWords)).toEqual(["twenty twenty-six", "two thousand five", "twenty ten", "nineteen ninety-nine", "nineteen oh five", "nineteen hundred"]);
  });

  test("a frase do harry: o disco em inglês não fala português", () => {
    expect(textoParaFala("The disk has 60 TB free.")).toBe("The disk has sixty terabytes free.");
  });

  test("números, datas, horas, dinheiro, porcentagens, unidades e siglas", () => {
    const casos: [string, string][] = [
      ["It costs $1,250.50.", "It costs one thousand two hundred fifty dollars and fifty cents."],
      ["The budget is $2 million.", "The budget is two million dollars."],
      ["It was R$ 12 and US$ 1.", "It was twelve reais and one dollar."],
      ["Sales are up 12.5% this week.", "Sales are up twelve point five percent this week."],
      ["The meeting is on 11/24/2026.", "The meeting is on November twenty-fourth, twenty twenty-six."],
      ["It was on 24/11/2026.", "It was on November twenty-fourth, twenty twenty-six."],
      ["The meeting is on 2026-11-03.", "The meeting is on November third, twenty twenty-six."],
      ["See you on Nov 3rd.", "See you on November third."],
      ["The call is at 2:30 PM.", "The call is at two thirty P M."],
      ["The call is at 14:05.", "The call is at two oh five P M."],
      ["It starts at 9am and ends at 12:00.", "It starts at nine A M and ends at noon."],
      ["Call at 9 a.m. tomorrow.", "Call at nine A M tomorrow."],
      ["It has been there since 1999.", "It has been there since nineteen ninety-nine."],
      ["Pages 10-20 are done.", "Pages ten to twenty are done."],
      ["It is -4°C outside.", "It is minus four degrees Celsius outside."],
      ["The file has 2.5 GB and 1 MB.", "The file has two point five gigabytes and one megabyte."],
      ["She came 1st and he came 22nd.", "She came first and he came twenty-second."],
      ["Open the PDF and the HTML.", "Open the P D F and the H T M L."],
      ["It is OK, NASA said so.", "It is okay, NASA said so."],
      ["Ana & Bruno, see #12.", "Ana and Bruno, see number twelve."],
      ["Version 2026.11.13 is out.", "Version two thousand twenty-six dot eleven dot thirteen is out."],
      ["Mr. Silva, e.g. the boss.", "mister Silva, for example the boss."],
    ];
    for (const [entrada, saida] of casos) expect(textoParaFala(entrada, "en"), entrada).toBe(saida);
  });

  test("o português continua como era", () => {
    expect(textoParaFala("O disco tem 60 TB livres.")).toBe("O disco tem sessenta terabytes livres.");
    expect(textoParaFala("Anotei 2 reuniões às 14h30.")).toBe("Anotei duas reuniões às catorze e trinta.");
    expect(textoParaFala("Custa R$ 12,50.")).toBe("Custa doze reais e cinquenta centavos.");
  });

  test("cada frase na língua dela, e a sem pista fica com a vizinha", () => {
    expect(frasesComLingua("Anotei 2 reuniões. The disk has 60 TB free. OK. Pronto, são 3 notas.")).toEqual([
      { frase: "Anotei duas reuniões.", lingua: "pt" },
      { frase: "The disk has sixty terabytes free.", lingua: "en" },
      { frase: "okay.", lingua: "en" },
      { frase: "Pronto, são três notas.", lingua: "pt" },
    ]);
    expect(frasesComLingua("42.")).toEqual([{ frase: "quarenta e dois.", lingua: "pt" }]);
    expect(frasesComLingua("42.", "en")).toEqual([{ frase: "forty-two.", lingua: "en" }]);
    expect(frasesComLingua("OK. I saved the note.").map((f) => f.lingua)).toEqual(["en", "en"]);
  });

  test("frações simples e a meia-noite e meia (warm-newt #31080)", () => {
    expect(textoParaFala("Mix 1/2 cup and 3/4 cup, 2/3 of it.", "en")).toBe("Mix one half cup and three quarters cup, two thirds of it.");
    expect(textoParaFala("It ends at 0:30.", "en")).toBe("It ends at twelve thirty A M.");
    expect(textoParaFala("See you on 4/3.", "en")).toBe("See you on April third.");
  });

  test("um número enorme nunca derruba a fala, em nenhum formato e em nenhuma língua (warm-newt #31080)", () => {
    expect(textoParaFala("The total is $1,000,000,000,000 now.", "en")).toBe("The total is one zero zero zero zero zero zero zero zero zero zero zero zero dollars now.");
    expect(textoParaFala("O total é R$ 1.234.567.890.123 agora.", "pt")).toBe("O total é um dois três quatro cinco seis sete oito nove zero um dois três reais agora.");
    expect(textoParaFala("O total é US$ 1.234.567.890.123 agora.", "pt")).toEndWith("dólares agora.");
    const enorme = ["1234567890123", "1,234,567,890,123", "1.234.567.890.123", "99999999999999999999"];
    const formatos = ["$#", "US$ #", "R$ #", "€#", "#%", "#°C", "# km", "# GB", "-#", "#.5", "#,5", "#st", "#º", "#h", "# x 2", "## de", "#-#"];
    for (const n of enorme)
      for (const f of formatos)
        for (const lingua of ["pt", "en"] as const) {
          const texto = `Total ${f.replaceAll("#", n)} hoje.`;
          expect(() => textoParaFala(texto, lingua), `${lingua}: ${texto}`).not.toThrow();
        }
  });

  test("uma abreviação com ponto não troca a língua no meio da frase", () => {
    expect(frasesParaFala("Call Dr. Ana at 9am.")).toEqual(["Call doctor Ana at nine A M."]);
  });
});
