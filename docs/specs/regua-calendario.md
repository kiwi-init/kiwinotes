# A régua do Calendário

Esta régua diz o que a aba Calendário tem de fazer para chegar ao nível do Teams, do Calendário do Mac e do Google Agenda, ou passar deles. É a régua do spec #34706 do Kiwi (T34732), pedido pelo harry em #34705 e #34706. A referência é o **comportamento** dessas três apps, não a aparência: o Kiwi segue o desenho dele.

## Como ler

Cada linha diz o que as referências fazem e o que o Kiwi faz hoje. A última coluna diz como está a linha:

- **cumpre:** já vale hoje, na `main` de onde saiu o branch (7b6354e6);
- **falta A**, **falta B** ou **falta C** (com a task): ainda não vale, e a parte com essa letra no spec #34706 fecha a linha. A é a tela, B é editar à mão e C é o Kiwi no Calendário;
- **falta: T<n>:** ainda não vale, e a task que a régua pediu ao lead fecha a linha;
- **n/a:** não se aplica, e a linha diz o porquê.

Quando uma parte fecha uma linha, o mesmo PR troca a linha para "cumpre" e diz qual teste ou roteiro prova isso.

Fontes das referências:
- [Google Agenda, atalhos de teclado](https://support.google.com/calendar/answer/37034);
- [Calendário do Mac, atalhos](https://support.apple.com/guide/calendar/keyboard-shortcuts-ical002/mac);
- [Teams, atalhos](https://support.microsoft.com/en-us/office/keyboard-shortcuts-for-microsoft-teams-2e8e2a70-e8d8-4a19-949b-4c36dd5292d2);
- o uso das três apps.

## 1. Teclado e atalhos

| # | Comportamento | Nas referências | No Kiwi hoje | Estado |
|---|---|---|---|---|
| 1.1 | Ir para hoje pela tecla | Google `t`, Mac ⌘T, Teams ⌘T | só o botão "Hoje" | falta: T34762 |
| 1.2 | Período anterior e próximo pela tecla | Google `k`/`j`, Mac ⌘← e ⌘→, Teams ⌥⌘← e ⌥⌘→ | só os botões ‹ e › | falta: T34762 |
| 1.3 | Trocar a vista pela tecla | Google `d` `w` `m` `a` (ou 1 a 5), Mac ⌘1 a ⌘4, Teams ⌃⌘1 a ⌃⌘5 | só os botões das vistas. O lead decidiu (#34756): teclas simples, como no Google Agenda (D, W, M, A e Y), sem ⌘ e só fora de campo de texto | falta: T34762 |
| 1.4 | Novo item pela tecla | Google `c`, Mac ⌘N, Teams ⌘N | só o botão "+ Novo" | falta: T34762 |
| 1.5 | Ir para uma data | Google `g`, Mac ⇧⌘T | não há | falta: T34762 |
| 1.6 | Apagar o item escolhido com Delete, com Desfazer | Google Delete e `z`, Mac Delete e ⌘Z | não dá para apagar | falta B (T34745) |
| 1.7 | Andar entre os itens pelo teclado | Mac: Tab e as setas | Tab anda entre os itens, e Enter ou espaço abre o painel largo. As setas não andam, nem entre os itens nem entre os dias (confirmado pela snug-puma, #34801) | falta: T34765 (as setas) |
| 1.8 | Mover o item pelo teclado | Mac: ⌃⌥↑ e ⌃⌥↓ andam 15 min, e ⌃⌥← e ⌃⌥→ andam um dia | não há | falta: T34765 |
| 1.9 | Esc fecha e Enter confirma | nas três | Esc fecha o painel largo, o "+ Novo" e o seletor de projetos. Enter cria no "+ Novo" | cumpre |
| 1.10 | A lista dos atalhos | Google e Teams: `?` | não há | falta: T34762 |
| 1.11 | Buscar itens | Google `/`, Mac ⌘F | o ⌘K da aba é o pedido ao Kiwi, e não há busca de itens no Calendário | falta: T34778 |
| 1.12 | Desfazer a última mudança (mover, esticar, editar) | Google `z`, Mac ⌘Z | não há | falta: T34767 (a parte B só faz o Desfazer do apagar) |

## 2. Arrastar e redimensionar

| # | Comportamento | Nas referências | No Kiwi hoje | Estado |
|---|---|---|---|---|
| 2.1 | Arrastar move o item em passos de 15 min, também para outro dia, com a prévia junto | nas três | `moveItem` em passos de 15 min, entre colunas, com a prévia | cumpre |
| 2.2 | Esticar o fim pela borda de baixo | nas três | o puxador `kn-cal-resize`, de 15 em 15 min | cumpre |
| 2.3 | Esticar o começo pela borda de cima | Google e Mac | não há | falta B (T34748) |
| 2.4 | Clicar num horário vazio cria ali | nas três (Google: o rascunho rápido) | não há | falta B (T34748) |
| 2.5 | Arrastar no vazio marca o início e o fim | Google e Mac | não há | falta B (T34748) |
| 2.6 | Arrastar no Mês troca o dia | nas três | o arrastar no Mês troca o dia | cumpre |
| 2.7 | Arrastar entre a faixa do dia todo e as horas | Google e Mac | o item fica como estava, dia todo ou com hora | falta: T34765 |
| 2.8 | Esc no meio do arrastar desiste | Google | soltar sempre grava | falta: T34765 |

## 3. A linha do agora e a rolagem

| # | Comportamento | Nas referências | No Kiwi hoje | Estado |
|---|---|---|---|---|
| 3.1 | A linha do agora, que anda sozinha | nas três | a linha vermelha anda a cada minuto, e o "hoje" muda à meia-noite | cumpre |
| 3.2 | Abrir já rolado para perto da hora atual | nas três | abre 2 h antes do agora, e começa às 7:00 no mínimo | cumpre |
| 3.3 | Hoje destacado na cabeça e no Mês | nas três | `data-today` na cabeça do dia, na coluna e na célula do Mês | cumpre |
| 3.4 | O "Hoje" também rola até a hora atual | Google e Mac | só rola quando muda de semana. Se a pessoa já está na semana de hoje, a grade fica onde estava | falta: T34768 |

## 4. Trackpad e pinça

| # | Comportamento | Nas referências | No Kiwi hoje | Estado |
|---|---|---|---|---|
| 4.1 | Rolar a grade com dois dedos | nas três | a rolagem do próprio sistema | cumpre |
| 4.2 | Deslizar dois dedos para o lado troca o período | Mac | não há | falta: T34768 |
| 4.3 | A pinça (ou ⌘+ e ⌘−) muda a altura da hora | Mac: ⌘+ e ⌘− mudam o texto. A regra do trackpad do harry (#21198) pede a pinça | a altura da hora é fixa (`HOUR_PX` = 48) | falta: T34768 |

## 5. Estados vazios, carregamento e erros

| # | Comportamento | Nas referências | No Kiwi hoje | Estado |
|---|---|---|---|---|
| 5.1 | Sem itens, a grade vazia, e a lista diz que não há nada | nas três | a grade vazia, e a Agenda mostra o `agendaEmpty` | cumpre |
| 5.2 | Carregando, sem piscar quando a pessoa troca de período | nas três | "Carregando" só na 1ª vez. Na troca de período, os itens velhos ficam até os novos chegarem | cumpre |
| 5.3 | Erro ao ler, com "Tentar de novo" | Google | a mensagem e o botão | cumpre |
| 5.4 | Erro ao gravar avisa e volta ao que vale | nas três | o aviso (o conflito tem texto próprio) e a releitura | cumpre |
| 5.5 | Um título que não dá para gravar diz o motivo | nas três | o motivo debaixo do campo (#493, no #506) | cumpre |

## 6. Acessibilidade

| # | Comportamento | Nas referências | No Kiwi hoje | Estado |
|---|---|---|---|---|
| 6.1 | Cada item focável, com o nome lido | nas três | `role="button"` com o tipo e o título | cumpre |
| 6.2 | A hora no nome lido do item | Google e Mac leem a hora | o leitor de tela ouve só o tipo e o título | falta: T34771 |
| 6.3 | O foco visível | nas três | o `:focus-visible` com a cor do tipo | cumpre |
| 6.4 | As vistas e os botões com nome | nas três | as vistas num `radiogroup`, e cada botão de ícone com `aria-label` | cumpre |
| 6.5 | Respeitar o "reduzir movimento" | Mac | a `@media (prefers-reduced-motion)` tira as animações | cumpre |

## 7. Português e inglês

| # | Comportamento | Nas referências | No Kiwi hoje | Estado |
|---|---|---|---|---|
| 7.1 | Todos os textos nas duas línguas | nas três | `calendar.pt` e `calendar.en`, com o `calendar-ui-check` nas duas | cumpre |
| 7.2 | A hora no formato do sistema (12 h ou 24 h) | Mac e Google seguem o sistema | sempre 24 h, também em inglês | falta: T34771 |
| 7.3 | O 1º dia da semana segue a região ou o ajuste | nas três | sempre segunda-feira | falta: T34771 |

## 8. Claro e escuro

| # | Comportamento | Nas referências | No Kiwi hoje | Estado |
|---|---|---|---|---|
| 8.1 | A tela segue o tema | nas três | as cores vêm dos tokens do tema, e as cores dos tipos são fixas | cumpre |
| 8.2 | O escuro tem roteiro e print | n/a (é a nossa prova) | o `calendar-cascade-check` roda no claro e no escuro, mas sai com a cascata (T34737, PR #535). O `calendar-ui`, o `calendar-line-jump` e o `calendar-narrow` rodam só no claro | falta: T34789, que leva o passo do escuro do cascade para o roteiro que o substitui (lead, #34809) |

## 9. Janela estreita

| # | Comportamento | Nas referências | No Kiwi hoje | Estado |
|---|---|---|---|---|
| 9.1 | Na Semana estreita, as cabeças dos dias não se sobrepõem | nas três | conferido pelo `calendar-narrow-check` (#495) | cumpre |
| 9.2 | Com o painel largo aberto, a grade ocupa o espaço que sobra (ponto 1) | Google e Teams | fica uma faixa vazia entre a grade e o painel | falta A (T34741) |
| 9.3 | O painel largo nunca cobre o Kiwi nem o balão (ponto 8) | n/a (é do Kiwi) | o painel fica por cima do Kiwi | falta A (T34741) |
| 9.4 | Na janela estreita, o painel lateral cede espaço para a grade | Google e Teams recolhem o painel lateral | o painel do Kiwi tem largura fixa (`--cal-side`). A 760 px, ele fica com uns 290 px, e a Semana com uns 400 px (snug-puma, #34801) | falta A (T34741, lead #34834) |

## 10. Os itens na grade

| # | Comportamento | Nas referências | No Kiwi hoje | Estado |
|---|---|---|---|---|
| 10.1 | Itens no mesmo horário ficam lado a lado e dividem a coluna (ponto 9) | Teams e Google | lado a lado: cada grupo de sobreposição tem as colunas dele, e o item se estica pelas colunas livres (`layoutDay`, T34737, PR #535) | cumpre: o `model.test` e o `calendar-ui.test`, e o passo 3a do `calendar-ui-check` (o Dia e a Semana, em pt e en) |
| 10.2 | "+N" quando não cabem, no Dia e na Semana | Google e Teams | as colunas que não cabem (44 px no mínimo) viram um "+N", que abre a lista dentro da grade, com o cartão e o arrastar (`fitColumns`, T34737, PR #535) | cumpre: o `model.test` e o passo 3a do `calendar-ui-check` (a Semana e o Dia estreito a 600 px) |
| 10.3 | "+N" no Mês | nas três | até 3 itens por dia, depois o "+n" | cumpre |
| 10.4 | Um item de vários dias, numa barra só | nas três | o teto é de 24 h (#449), e o item de mais de um dia não existe | falta: T34781. O lead decidiu que entra (#34756) |
| 10.5 | Vários calendários com cor, para mostrar e esconder | nas três | o filtro por tipo e por projeto, que fica salvo (T32408) | cumpre |
| 10.6 | Atualiza sozinho quando a fonte muda | Google e Mac (e Google `r`, Mac ⌘R) | relê quando a nota muda (`onChanged`) | cumpre |
| 10.7 | A vista do Ano | Mac ⌘4, e Google | não há | falta: T34785. O lead decidiu que entra (#34756) |
| 10.8 | A faixa do dia todo tem um teto, com o "+N" | Google | até 3 itens por dia; com mais, 2 e o "+N", que abre a faixa inteira, e o "Mostrar menos" fecha (`allDayFit`, T34737, PR #536) | cumpre: o `model.test` ("a faixa do dia todo") e o `calendar-ui.test`, e o passo 4f do `calendar-ui-check` |
| 10.9 | Criar um item de um tipo ou projeto escondido pelo filtro avisa | Google mostra o item criado mesmo assim | o item é criado, mas não aparece, e nada avisa (snug-puma, #34801) | falta B (T34748, lead #34834) |

## 11. Editar e criar

| # | Comportamento | Nas referências | No Kiwi hoje | Estado |
|---|---|---|---|---|
| 11.1 | Mudar a data, o início, o fim e o "dia todo" por campos, no cartão (ponto 3) | nas três | só arrastando | falta B (T34745) |
| 11.2 | Mudar o título, o tipo, o projeto, o aviso, a repetição e o texto, no cartão (ponto 4) | nas três | só o aviso, o Feito e o "adiar 1 dia" | falta B (T34745) |
| 11.3 | Apagar pelo cartão, com Desfazer | nas três | não há | falta B (T34745) |
| 11.4 | Aviso com qualquer antecedência | nas três | o `🔔` aceita minutos, horas e dias até 30 dias (`🔔 50m`, `🔔 2h`, `🔔 3d`), na nota, nos avisos, no cartão e na ferramenta do Kiwi (`bun/calendar.test.ts`, "a linha lê e escreve 🔔 50m…" e "criar e mudar com o aviso livre"; `calendar-ui-check` 3b, pt e en) | cumpre |
| 11.5 | A repetição mensal, anual, nos dias úteis ou a que a pessoa montar | nas três | só a diária e a semanal | falta: T34775 |
| 11.6 | Duplicar um item | Google (Duplicar) e Mac (copiar e colar) | não há | falta: T34767 |
| 11.7 | O "+ Novo" já pede o aviso e a repetição | nas três | só o título, o tipo, o projeto, o dia, o início e o fim (snug-puma, #34801) | falta: T34748 o aviso e T34775 a repetição (lead #34834) |
| 11.8 | O "+ Novo" aceita um fim depois da meia-noite (22:00–01:00) | nas três | o botão fica desligado quando o fim é antes do começo (`end > time`), embora o main aceite (#480) | falta: T34781 (lead #34834) |

## 12. O Kiwi no Calendário (onde o Kiwi tem de ser melhor)

| # | Comportamento | Nas referências | No Kiwi hoje | Estado |
|---|---|---|---|---|
| 12.1 | "Me lembra às 10h e me avisa 50 min antes" vira um lembrete às 10:00 com o aviso 50 min antes (ponto 2) | n/a (só o Kiwi tem) | um item só, às 10:00, com o aviso de 50 min; o Kiwi lê a hora, a duração, o intervalo e o aviso do pedido e manda a linha com o cartão (`calendar-pedido.test.ts`; `calendar-tools.test.ts`, "o aviso de 50 min"; `service.test.ts`, "frases variadas de hora e aviso", com o agente falso) | cumpre |
| 12.2 | O mesmo pedido repetido não duplica o item | n/a | o mesmo título na mesma hora é o mesmo item; com outro aviso, muda o aviso dele (`calendar-tools.test.ts`, "o mesmo pedido de novo não cria outro item"; `service.test.ts`, "o mesmo pedido duas vezes não duplica") | cumpre |
| 12.3 | O Kiwi apaga e muda os itens, e a pessoa desfaz pela Atividade (ponto 6) | n/a | o `calendar_delete` apaga os itens do Kiwi e os da pessoa, e o Desfazer da Atividade traz a linha de volta; a reunião gravada não se apaga (`calendar-tools.test.ts`, "apaga a linha pelo id"; `bun/calendar.test.ts`, "a linha sai e o resto da nota fica"; `service.test.ts`, "apagar tira a linha, e o Desfazer da Atividade a traz de volta") | cumpre |
| 12.4 | A barra de cima aceita texto, tem a animação dela e mostra a resposta (ponto 7) | n/a | é só um botão que abre o Kiwi da tela | falta C (T34755) |

## 13. Animações e desempenho

| # | Comportamento | Nas referências | No Kiwi hoje | Estado |
|---|---|---|---|---|
| 13.1 | Abrir e fechar o detalhe com animação | Mac e Teams | o painel largo cresce do item e volta para ele (550 e 600 ms), e o item pisca | cumpre |
| 13.2 | A troca de período com transição | Mac (desliza) | a grade troca de uma vez | falta: T34768 |
| 13.3 | Com 500 itens, a tela abre, rola e arrasta sem travar | nas três | não há teste nem medida | falta: T34789 |

## Os bugs da varredura (T34758)

A varredura da snug-puma achou estes bugs. Cada um se corrige no PR da parte do dono, com `Refs #n`, e quem fecha a issue é o PR único, o #525. O lead repartiu no #34802, e o #527 vem primeiro.

| Issue | O bug | Gravidade | A task |
|---|---|---|---|
| #527 | Trocar o título de um item apaga o resto da linha da nota (`[[links]]`, outras tags) | P1 | T34745 |
| #528 | Dar hora a um item de dia todo responde ok, e nada muda | P2 | T34753 |
| #529 | Trocar o tipo de reunião ou foco para pendência dá `E_CONFLICT` | P2 | T34745 |
| #530 | O Adiar numa vez de uma repetição move a série inteira | P2 | T34737, num PR à parte |
| #531 | No "+ Novo", a hora vazia aparece como 12:30, e o item sai de dia todo | P2 | T34748 |
| #532 | As Ligações listam uma repetição uma vez por dia | P3 | T34737, num PR à parte |
| #533 | No Mês e na Agenda, o item que passa da meia-noite mostra o começo no dia seguinte | P3 | T34781 |
| #534 | O Sim de uma sugestão do Kiwi que falha ao gravar some por 7 dias | P3 | T34753 |

## n/a

- **O fuso horário de cada item:** o Kiwi é local, num fuso só, o do Mac.
- **Convidados, salas, respostas e entrar na reunião (o Teams):** o Kiwi não tem contas nem rede, pelo ADR 0011.
- **Imprimir (Mac ⌘P):** o Calendário vem das notas, e a nota já se imprime nas Notas.

## As "falta" e as tasks

Cada "falta" tem a task que a fecha. As partes do spec:
- **A, a tela:** T34741 (9.2 e 9.3) e T34737 (10.1 e 10.2);
- **B, editar à mão:** T34745 (1.6 e 11.1 a 11.3) e T34748 (2.3 a 2.5);
- **C, o Kiwi:** T34753 (11.4 e 12.1 a 12.3) e T34755 (12.4).

As que a régua achou e o lead abriu (#34756):
- **T34762:** os atalhos de teclado e a lista do `?` (1.1 a 1.5 e 1.10);
- **T34765:** as setas, o arrastar entre o dia todo e as horas, e o Esc (1.7, 1.8, 2.7 e 2.8);
- **T34767:** desfazer e refazer tudo, e duplicar (1.12 e 11.6);
- **T34768:** o "Hoje" rola até o agora, deslizar, a pinça e a transição (3.4, 4.2, 4.3 e 13.2);
- **T34771:** o VoiceOver, 12 h ou 24 h e o 1º dia da semana do sistema (6.2, 7.2 e 7.3);
- **T34775:** as repetições novas (11.5);
- **T34778:** buscar itens (1.11);
- **T34781:** os itens de vários dias (10.4);
- **T34785:** a vista do Ano (10.7);
- **T34789:** os roteiros no escuro e o teste de 500 itens (8.2 e 13.3).

As linhas que a snug-puma achou (#34801) entraram em tasks que já existiam (lead, #34834):
- 9.4, o painel lateral cede espaço na janela estreita: T34741;
- 10.8, o teto da faixa do dia todo: T34737, no PR à parte do #530 e do #532;
- 10.9, avisar ao criar um item escondido pelo filtro: T34748;
- 11.7, o aviso e a repetição no "+ Novo": T34748 (o aviso) e T34775 (a repetição);
- 11.8, o fim depois da meia-noite no "+ Novo": T34781.
