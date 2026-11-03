#!/bin/sh
# Cria, uma vez só, a identidade de assinatura local do Kiwi Notes no Keychain de login (T1074).
#
# Por quê: assinado ad hoc, o "designated requirement" do app é o cdhash, que muda a cada build, e o macOS (TCC) trata
# cada build como um app novo: Acessibilidade, Monitoramento de Entrada e Microfone voltam a pedir. Assinado com esta
# identidade, o requirement vira `identifier "app.kiwinotes.desktop" and certificate leaf = H"…"`, igual em todo
# build, e a permissão fica.
#
# O que faz: um certificado autoassinado de assinatura de código (EKU codeSigning, 10 anos), com a chave gerada aqui e
# importada direto no Keychain. Nada sai do Mac, não pede Apple ID e não marca o certificado como confiável (o
# codesign e o TCC não precisam disso). A chave privada só existe numa pasta temporária (0700) até o import.
#
# Diálogos: nenhum do macOS. O `security set-key-partition-list` pede a senha do seu login no próprio terminal, para o
# codesign usar a chave sem perguntar. Se você pular (Ctrl-C ali), o 1º build abre o diálogo
# "codesign quer assinar usando a chave…": clique em "Permitir Sempre".
#
# Uso (pela pessoa, no terminal):   app/scripts/make-signing-identity.sh
# Desfazer:                          app/scripts/make-signing-identity.sh --remove
# Outro keychain (testes):           app/scripts/make-signing-identity.sh [--remove] <arquivo.keychain-db>
set -eu

NAME="${KIWI_SIGN_NAME:-Kiwi Notes Local Signing}"
remove=0
if [ "${1:-}" = "--remove" ]; then
  remove=1
  shift
fi
KEYCHAIN="${1:-$HOME/Library/Keychains/login.keychain-db}"
# O openssl do sistema (LibreSSL): o .p12 de um OpenSSL 3 ou 4 (Homebrew) não entra no Keychain ("MAC verification
# failed").
OPENSSL=/usr/bin/openssl

if [ "$remove" = 1 ]; then
  if security find-certificate -c "$NAME" "$KEYCHAIN" >/dev/null 2>&1; then
    security delete-identity -c "$NAME" "$KEYCHAIN"
    echo "Apaguei \"$NAME\" de $KEYCHAIN. O próximo build volta a ser ad hoc."
  else
    echo "\"$NAME\" não está em $KEYCHAIN: nada a apagar."
  fi
  exit 0
fi

if security find-certificate -c "$NAME" "$KEYCHAIN" >/dev/null 2>&1; then
  echo "\"$NAME\" já está em $KEYCHAIN: nada a fazer."
  security find-identity -p codesigning "$KEYCHAIN" | grep "\"$NAME\"" || true
  exit 0
fi

umask 077
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

cat > "$tmp/cert.cnf" <<EOF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $NAME
[ext]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
subjectKeyIdentifier = hash
EOF

"$OPENSSL" req -x509 -newkey rsa:2048 -nodes -days 3650 -config "$tmp/cert.cnf" \
  -keyout "$tmp/key.pem" -out "$tmp/cert.pem" 2>/dev/null
# Uma senha só para o arquivo .p12, que é apagado logo depois do import.
pass=$("$OPENSSL" rand -hex 16)
"$OPENSSL" pkcs12 -export -name "$NAME" -inkey "$tmp/key.pem" -in "$tmp/cert.pem" \
  -out "$tmp/id.p12" -passout "pass:$pass"
security import "$tmp/id.p12" -k "$KEYCHAIN" -P "$pass" -T /usr/bin/codesign >/dev/null
echo "Criei \"$NAME\" em $KEYCHAIN."

echo "Agora o macOS pede a senha do seu login (a do Mac), aqui no terminal, para o codesign usar a chave sem perguntar:"
# Só a chave desta identidade (-l): as outras chaves do Keychain ficam como estão.
if [ -n "${KIWI_KEYCHAIN_PASSWORD:-}" ]; then
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s -l "$NAME" -k "$KIWI_KEYCHAIN_PASSWORD" "$KEYCHAIN" >/dev/null
else
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s -l "$NAME" "$KEYCHAIN" >/dev/null ||
    echo "Sem a senha: no 1º build, clique em \"Permitir Sempre\" no diálogo do codesign."
fi

security find-identity -p codesigning "$KEYCHAIN" | grep "\"$NAME\"" || true
echo "Pronto. O próximo \`bun run build\` assina com ela. Ele aparece como CSSMERR_TP_NOT_TRUSTED, e isso é esperado:"
echo "o certificado é só deste Mac."
