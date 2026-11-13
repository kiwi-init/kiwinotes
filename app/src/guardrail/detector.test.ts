// O detector de segredos (spec #9690): a bateria dos dois lados, lado a lado. Os segredos que precisam ser pegos e os
// textos de trabalho que precisam passar inteiros. Nenhum segredo de verdade: os tokens são montados aqui, no formato
// certo e com caracteres sorteados de uma semente fixa (e nenhum token inteiro fica escrito no código, para o
// secret scanning do GitHub não confundir).

import { describe, expect, test } from "bun:test";

import { detect, mask, placeholder, scan, secretKey, type Finding, type SecretKind } from "./detector.ts";

// ------------------------------------------------------------------------------------------------- os exemplos

let seed = 9690;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const UPPER_DIGITS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0234567";
/** Uma sequência sorteada que mistura maiúscula, minúscula e número, como um token. */
function chars(n: number, alphabet = ALNUM): string {
  for (;;) {
    let s = "";
    for (let i = 0; i < n; i++) s += alphabet[Math.floor(rnd() * alphabet.length)];
    if (alphabet !== ALNUM || (/\d/.test(s) && /[A-Z]/.test(s) && /[a-z]/.test(s))) return s;
  }
}
const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

const T = {
  aws: ["AK", "IA"].join("") + chars(16, UPPER_DIGITS),
  github: ["gh", "p_"].join("") + chars(36),
  githubPat: ["github", "_pat_"].join("") + chars(22) + "_" + chars(59),
  gitlab: ["gl", "pat-"].join("") + chars(20),
  anthropic: ["sk", "-ant-api03-"].join("") + chars(93),
  openai: ["sk", "-proj-"].join("") + chars(48),
  stripe: ["sk", "_live_"].join("") + chars(24),
  slack: ["xo", "xb-"].join("") + "1234567890-1234567890123-" + chars(24),
  slackHook: ["https://hooks.", "slack.com/services/"].join("") + "T0" + chars(8) + "/B0" + chars(8) + "/" + chars(24),
  google: ["AI", "za"].join("") + chars(35),
  googleOauth: ["GOC", "SPX-"].join("") + chars(28),
  jwt: [b64url({ alg: "HS256", typ: "JWT" }), b64url({ sub: "1234567890", name: "Ana", iat: 1516239022 }), chars(43)].join("."),
  npm: ["np", "m_"].join("") + chars(36),
  bearer: chars(40),
  random: chars(40),
};
const PEM_BODY = Array.from({ length: 6 }, () => chars(64)).join("\n");
const PRIVATE_KEY = `-----BEGIN ${"PRIVATE"} KEY-----\n${PEM_BODY}\n-----END ${"PRIVATE"} KEY-----`;

/** Os trechos de um texto: o tipo, o veredito e o valor. */
const found = (text: string) => detect(text).map((f) => ({ kind: f.kind, verdict: f.verdict, value: text.slice(f.start, f.end) }));

/** Espera um só trecho, com esse valor e esse tipo, como segredo. */
function caught(text: string, value: string, kind: SecretKind) {
  expect(found(text)).toEqual([{ kind, verdict: "secret", value }]);
}

// ------------------------------------------------------------------------------------------------- o que segura

describe("o detector segura os segredos (spec #9690)", () => {
  test("tokens e chaves pelo formato", () => {
    const cases: [string, SecretKind][] = [
      [T.aws, "aws"],
      [T.github, "github"],
      [T.githubPat, "github"],
      [T.gitlab, "gitlab"],
      [T.anthropic, "anthropic"],
      [T.openai, "openai"],
      [T.stripe, "stripe"],
      [T.slack, "slack"],
      [T.slackHook, "slack-webhook"],
      [T.google, "google"],
      [T.googleOauth, "google"],
      [T.jwt, "jwt"],
      [T.npm, "npm"],
    ];
    for (const [token, kind] of cases) {
      caught(`Usei ${token} no deploy de ontem.`, token, kind);
      // Sozinho na linha, entre crases e entre aspas também.
      caught(token, token, kind);
      caught(`\`${token}\``, token, kind);
      caught(`"${token}"`, token, kind);
    }
  });

  test("a chave privada inteira, também dentro do JSON de uma conta de serviço", () => {
    caught(`a chave:\n${PRIVATE_KEY}\nfim`, PRIVATE_KEY, "private-key");
    const escaped = PRIVATE_KEY.replace(/\n/g, "\\n");
    const json = `{\n  "type": "service_account",\n  "private_key": "${escaped}\\n",\n  "client_email": "sa-legacy@prj-x.iam.gserviceaccount.com"\n}`;
    expect(found(json).map((f) => f.kind)).toEqual(["private-key"]);
    expect(found(json)[0]!.value).toBe(escaped);
  });

  test("o cabeçalho Authorization, Bearer e Basic, e os cabeçalhos de chave", () => {
    caught(`Authorization: Bearer ${T.bearer}`, T.bearer, "bearer");
    caught(`curl -H "authorization: bearer ${T.bearer}" https://api.exemplo.com`, T.bearer, "bearer");
    caught("Authorization: Basic dXN1YXJpbzpzZW5oYTEyMw==", "dXN1YXJpbzpzZW5oYTEyMw==", "basic");
    caught(`x-api-key: ${T.random}`, T.random, "auth-header");
  });

  test("endereços com usuário e senha, de qualquer tipo: só a senha é o segredo", () => {
    caught("https://ana:Kiwi%232024@intranet.exemplo.local/painel", "Kiwi%232024", "url-password");
    caught("DATABASE: postgres://app:S3nh4Forte@db.prd.interno:5432/kiwi", "S3nh4Forte", "url-password");
    caught("mongodb+srv://admin:Gato2024!@cluster0.exemplo.net/", "Gato2024!", "url-password");
    caught(`git clone https://${T.github}@github.com/kiwi-init/kiwinotes`, T.github, "github");
    caught(`https://bucket.s3.amazonaws.com/a.pdf?X-Amz-Signature=${T.random}&X-Amz-Expires=300`, T.random, "url-token");
    caught(`https://api.exemplo.com/v1?access_token=${T.random}`, T.random, "url-token");
  });

  test("senhas pelo contexto, em português e em inglês", () => {
    caught("senha: Kiwi#2024", "Kiwi#2024", "password");
    caught("Senha do roteador: Gato2024!", "Gato2024!", "password");
    caught("a senha do wifi é Gato2024!", "Gato2024!", "password");
    caught("A senha da VPN é 'abacaxi'", "abacaxi", "password");
    caught("minha senha é 98765432", "98765432", "password");
    caught("password=hunter22", "hunter22", "config");
    caught("the password is Tr0ub4dor&3", "Tr0ub4dor&3", "password");
    caught("My password was: CorrectHorse9", "CorrectHorse9", "password");
    caught("token: a1b2c3d4e5f6", "a1b2c3d4e5f6", "password");
    caught("api key = 9f8e7d6c5b4a", "9f8e7d6c5b4a", "password");
    caught("chave de API: Zz91-kQ", "Zz91-kQ", "password");
    caught("mysql --user=app --password=S3nh4Forte db", "S3nh4Forte", "password");
  });

  test("as linhas de configuração: .env, export, YAML, JSON e código", () => {
    caught("DB_PASSWORD=Ki-wi_2024", "Ki-wi_2024", "config");
    caught("export AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCY", "wJalrXUtnFEMIK7MDENGbPxRfiCY", "config");
    caught("GITHUB_TOKEN=abc", "abc", "config");
    caught("STRIPE_API_KEY='qualquer coisa'", "qualquer coisa", "config");
    caught("client_secret: abcdef", "abcdef", "config");
    caught('  "apiKey": "abcdef123"', "abcdef123", "config");
    caught("- db_password: segredo", "segredo", "config");
    caught("const config = { authToken: 'xyz' }", "xyz", "config");
    caught('SENHA_DO_BANCO="tem espaço"', "tem espaço", "config");
  });

  test("CPF e cartão válidos; os parecidos que não são válidos passam", () => {
    caught("Paciente: Ana Souza, CPF 529.982.247-25", "529.982.247-25", "cpf");
    caught("cpf: 52998224725", "52998224725", "cpf");
    caught("cartão 4111 1111 1111 1111, validade 12/29", "4111 1111 1111 1111", "card");
    caught("Mastercard 5555-5555-5555-4444", "5555-5555-5555-4444", "card");
    caught("número do cartão: 4111111111111111", "4111111111111111", "card");
    for (const ok of ["CPF 529.982.247-26", "CPF 111.111.111-11", "cartão 4111 1111 1111 1112", "cartão 1234 5678 9012 3456"]) expect(found(ok)).toEqual([]);
  });

  test("dúvida: uma sequência aleatória solta, e um rótulo de senha com uma palavra comum", () => {
    expect(found(`guarde isto: ${T.random}`)).toEqual([{ kind: "random", verdict: "doubt", value: T.random }]);
    expect(found("senha: trocar")).toEqual([{ kind: "password", verdict: "doubt", value: "trocar" }]);
    expect(found("Password: correcthorsebattery")).toEqual([{ kind: "password", verdict: "doubt", value: "correcthorsebattery" }]);
  });
});

// ------------------------------------------------------------------------------------------------- o que passa

describe("o trabalho passa inteiro (spec #9690, #4717)", () => {
  const passes = (text: string) => expect(found(text)).toEqual([]);

  test("IP, nome de máquina, VPN e intranet", () => {
    passes("Origem 10.20.30.40, destino 192.168.0.15/24, gateway 172.16.0.1 e o IPv6 2001:db8::ff00:42:8329.");
    passes("Servidores: vm-pacs-prd-01.dasa.local, ip-10-0-1-23.ec2.internal e srv-orthanc-hml-02.");
    passes("Antes de testar, conecte na VPN (vpn.dasa.com.br) e abra a intranet: http://intranet.dasa.local/wiki/PACS.");
  });

  test("CSV de trabalho, com unidade, IP e AE title", () => {
    passes(
      [
        "unidade,ip_origem,ip_destino,porta,ae_title,responsavel",
        "CDB Paulista,10.1.2.3,10.4.5.6,104,PACS_CDB,Ana Souza",
        "Delboni Morumbi,10.1.2.7,10.4.5.6,11112,ORTHANC_DLB,Bruno Lima",
        "Lavoisier Santana,10.9.8.7,10.4.5.6,4242,VNA_LAV,Carla Dias",
      ].join("\n"),
    );
  });

  test("nome de pessoa, e-mail, telefone e endereço (decisão do harry no #9690)", () => {
    passes("Falar com Ana Souza (ana.souza@exemplo.com.br, +55 11 98765-4321 ou (11) 3456-7890).");
    passes("Endereço: Av. Paulista, 1000, conj. 52 - Bela Vista, São Paulo - SP, 01310-100.");
    passes("O celular da Ana é 11987654321.");
    // Um celular que, por acaso, tem os dígitos de um CPF válido: sem "CPF" por perto, é telefone.
    passes("O celular do Bruno é 11987654374, e o da Carla, 11 98765-4374.");
    caught("CPF do Bruno: 11987654374", "11987654374", "cpf");
  });

  test("o que parece aleatório e não é segredo: UUID, hash, UID DICOM, recursos do Google Cloud, base64 e endereço", () => {
    passes("request 3f2504e0-4f89-11d3-9a0c-0305e82c3301 e 550e8400-e29b-41d4-a716-446655440000");
    passes("commit 9f2c1e7b4a3d5c6e8f0a1b2c3d4e5f6a7b8c9d0e, sha256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    passes("StudyInstanceUID 1.2.840.113619.2.55.3.604688119.868.1234567890.123 e SOP 1.2.276.0.7230010.3.1.4.8323329.123.1");
    passes(
      "projects/prj-legacy-rdi-prd/locations/southamerica-east1/datasets/legacy/dicomStores/pacs-central, " +
        "gs://prj-legacy-rdi-prd-dicom-raw/2024/03/estudos e sa-legacy-mg@prj-legacy-rdi-prd.iam.gserviceaccount.com",
    );
    passes(`![raio-x](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg${chars(300)})`);
    passes(`O arquivo: https://drive.google.com/file/d/1A2b3C4d5E6f7G8h9I0jK1lM2nO3pQ4rS5t/view?usp=sharing`);
    passes("integrity: sha512-z4PhNX7vuL3xVChQ1m2AB9Yg5AULVxXcg/SpIdNs6c5H0NE8XYXysP+DGNKHfuwvY7kxvUdBeoGlODJ6+SfaPg==");
    passes(`ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI${chars(43)} ana@notebook`);
    passes(`-----BEGIN CERTIFICATE-----\n${PEM_BODY}\n-----END CERTIFICATE-----`);
  });

  test("prosa sobre senhas e tokens, e chaves que não guardam segredo", () => {
    passes("A senha é obrigatória e o token expira em uma hora. Gastei 3 mil tokens.");
    passes("public_key: ssh-rsa curta\nsort_key=abc123\ntoken_type: Bearer\nsecret_name: projects/x/secrets/db\npassword_file: /run/secrets/db");
    passes("DB_PASSWORD=${DB_PASSWORD}\nAPI_KEY=<sua chave>\nGITHUB_TOKEN=***\nSECRET=\nTOKEN=false\npassword: string");
    passes("He was the bearer of bad news. Um sk-learn-pipeline-de-exemplo-com-texto.");
    passes("Pedido 4111111111111111 e exame 1234567890123456, sem cartão por perto.");
    passes("$ sha256sum laudo.pdf\n9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08  laudo.pdf");
  });
});

// ------------------------------------------------------------------------------------------------- o resultado

describe("o resultado do detector", () => {
  const text = `# Deploy\n\nservidor vm-pacs-prd-01 (10.1.2.3)\nsenha: Kiwi#2024\nGITHUB_TOKEN=${T.github}\nguarde: ${T.random}\n`;

  test("cada trecho tem o tipo, a posição, a linha e o veredito; o texto inteiro, um veredito", () => {
    const s = scan(text);
    expect(s.findings.map((f) => [f.kind, f.verdict, f.line, text.slice(f.start, f.end)])).toEqual([
      ["password", "secret", 4, "Kiwi#2024"],
      ["github", "secret", 5, T.github],
      ["random", "doubt", 6, T.random],
    ]);
    expect([s.secrets, s.doubts, s.verdict]).toEqual([2, 1, "secret"]);
    expect(scan(`guarde: ${T.random}`).verdict).toBe("doubt");
    expect(scan("tudo limpo, 10.1.2.3").verdict).toBe("clean");
  });

  test("o mesmo texto dá sempre o mesmo resultado, e os trechos vêm em ordem, sem sobreposição", () => {
    const a = detect(text);
    for (let i = 0; i < 5; i++) expect(detect(text)).toEqual(a);
    const all = detect(`${text}\n${PRIVATE_KEY}\nAuthorization: Bearer ${T.github}\n`);
    for (let i = 1; i < all.length; i++) expect(all[i]!.start).toBeGreaterThanOrEqual(all[i - 1]!.end);
    // O token do GitHub depois do Bearer é um trecho só, do tipo mais específico.
    expect(all.at(-1)!.kind).toBe("github");
  });

  test("a máscara nunca mostra o segredo: só o prefixo público do formato e o tamanho", () => {
    const m = (t: string) => {
      const [f] = detect(t) as [Finding];
      return mask(t, f);
    };
    expect(m(T.github)).toBe("ghp_•••• (40 caracteres)");
    expect(m(`senha: Kiwi#2024`)).toBe("•••• (9 caracteres)");
    expect(m(PRIVATE_KEY)).toStartWith("-----BEGIN PRIVATE KEY-----••••");
    expect(m("CPF 529.982.247-25")).toBe("•••• (14 caracteres)");
    for (const token of Object.values(T)) {
      const f = detect(token)[0];
      if (f) expect(mask(token, f)).not.toContain(token.slice(-8));
    }
  });

  test("as peças: a chave que guarda segredo e o valor que não é segredo", () => {
    for (const k of ["DB_PASSWORD", "client_secret", "apiKey", "API_KEY", "AWS_SECRET_ACCESS_KEY", "authToken", "senha_do_banco", "PRIVATE_KEY"]) expect(secretKey(k)).toBe(true);
    for (const k of ["public_key", "sort_key", "token_type", "secret_name", "password_file", "max_tokens", "monkey", "keyboard", "KEY"]) expect(secretKey(k)).toBe(false);
    for (const v of ["", "true", "None", "${X}", "$X", "<sua chave>", "***", "xxx", "process.env.TOKEN", "string"]) expect(placeholder(v)).toBe(true);
    for (const v of ["hunter22", "Kiwi#2024", "abc"]) expect(placeholder(v)).toBe(false);
  });
});

// ------------------------------------------------------------------------------------------------- o tempo

describe("o detector é rápido (spec #9690)", () => {
  test("uma nota de 800 KB em até 100 ms", () => {
    // Uma nota de trabalho de verdade: prosa, CSV com IPs e unidades, endereços, UIDs e alguns segredos no meio.
    const block = [
      "## Migração do PACS da unidade Paulista\n\nFalar com Ana Souza (ana.souza@exemplo.com.br) antes de mover os estudos.",
      "unidade,ip_origem,ip_destino,porta,ae_title\nCDB Paulista,10.1.2.3,10.4.5.6,104,PACS_CDB\nDelboni,10.1.2.7,10.4.5.6,11112,ORTHANC",
      "StudyInstanceUID 1.2.840.113619.2.55.3.604688119.868.1234567890.123, bucket gs://prj-legacy-rdi-prd-dicom-raw/2024/03",
      `commit 9f2c1e7b4a3d5c6e8f0a1b2c3d4e5f6a7b8c9d0e e o painel https://console.cloud.google.com/healthcare/browser?project=prj-legacy`,
      `senha: Kiwi#2024 e o token ${T.github}, guarde ${T.random}.`,
    ].join("\n\n");
    let note = "";
    while (note.length < 800_000) note += `${block}\n\n`;
    const runs: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      detect(note);
      runs.push(performance.now() - t0);
    }
    const median = runs.sort((a, b) => a - b)[2]!;
    console.log(`[guardrail] nota de ${(note.length / 1000).toFixed(0)} KB: ${median.toFixed(1)} ms (mediana de 5)`);
    // O teto do spec é 100 ms nesta máquina; o runner do CI é mais lento e dividido, então ali a folga é maior.
    expect(median).toBeLessThan(process.env.CI ? 400 : 100);
  });
});
