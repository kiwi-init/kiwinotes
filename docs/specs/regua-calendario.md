# A régua do Calendário

Esta régua diz o que a aba Calendário tem de fazer para chegar ao nível do Teams, do Calendário do Mac e do Google Agenda, ou passar deles. É a régua do spec #34706 do Kiwi (T34732), pedido pelo harry em #34705 e #34706. A referência é o **comportamento** dessas três apps, não a aparência: o Kiwi segue o desenho dele.

## Como ler

Cada linha diz o que as referências fazem e o que o Kiwi faz hoje. A última coluna diz como está a linha:

- **cumpre:** já vale hoje, na `main` de onde saiu o branch (7b6354e6);
- **falta A**, **falta B** ou **falta C:** ainda não vale, e a parte com essa letra no spec #34706 fecha a linha. A é a tela, B é editar à mão e C é o Kiwi no Calendário;
- **falta, sem parte:** ainda não vale, e nenhuma parte do spec cobre a linha. Essas linhas estão também na lista do fim, para o lead abrir as tasks;
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
| 1.1 | Ir para hoje pela tecla | Google `t`, Mac ⌘T, Teams ⌘T | só o botão "Hoje" | falta, sem parte |
| 1.2 | Período anterior e próximo pela tecla | Google `k`/`j`, Mac ⌘← e ⌘→, Teams ⌥⌘← e ⌥⌘→ | só os botões ‹ e › | falta, sem parte |
| 1.3 | Trocar a vista pela tecla | Google `d` `w` `m` `a` (ou 1 a 5), Mac ⌘1 a ⌘4, Teams ⌃⌘1 a ⌃⌘5 | só os botões das vistas. Escolher as teclas é com o lead, porque o ⌘1… pode bater com as abas do Hub | falta, sem parte |
| 1.4 | Novo item pela tecla | Google `c`, Mac ⌘N, Teams ⌘N | só o botão "+ Novo" | falta, sem parte |
| 1.5 | Ir para uma data | Google `g`, Mac ⇧⌘T | não há | falta, sem parte |
| 1.6 | Apagar o item escolhido com Delete, com Desfazer | Google Delete e `z`, Mac Delete e ⌘Z | não dá para apagar | falta B |
| 1.7 | Andar entre os itens pelo teclado | Mac: Tab e as setas | Tab anda entre os itens, e Enter ou espaço abre o painel largo. As setas não andam | falta, sem parte (as setas) |
| 1.8 | Mover o item pelo teclado | Mac: ⌃⌥↑ e ⌃⌥↓ andam 15 min, e ⌃⌥← e ⌃⌥→ andam um dia | não há | falta, sem parte |
| 1.9 | Esc fecha e Enter confirma | nas três | Esc fecha o painel largo, o "+ Novo" e o seletor de projetos. Enter cria no "+ Novo" | cumpre |
| 1.10 | A lista dos atalhos | Google e Teams: `?` | não há | falta, sem parte |
| 1.11 | Buscar itens | Google `/`, Mac ⌘F | o ⌘K da aba é o pedido ao Kiwi, e não há busca de itens no Calendário | falta, sem parte |
| 1.12 | Desfazer a última mudança (mover, esticar, editar) | Google `z`, Mac ⌘Z | não há | falta, sem parte (a parte B só faz o Desfazer do apagar) |

## 2. Arrastar e redimensionar

| # | Comportamento | Nas referências | No Kiwi hoje | Estado |
|---|---|---|---|---|
| 2.1 | Arrastar move o item em passos de 15 min, também para outro dia, com a prévia junto | nas três | `moveItem` em passos de 15 min, entre colunas, com a prévia | cumpre |
| 2.2 | Esticar o fim pela borda de baixo | nas três | o puxador `kn-cal-resize`, de 15 em 15 min | cumpre |
| 2.3 | Esticar o começo pela borda de cima | Google e Mac | não há | falta B |
| 2.4 | Clicar num horário vazio cria ali | nas três (Google: o rascunho rápido) | não há | falta B |
| 2.5 | Arrastar no vazio marca o início e o fim | Google e Mac | não há | falta B |
| 2.6 | Arrastar no Mês troca o dia | nas três | o arrastar no Mês troca o dia | cumpre |
| 2.7 | Arrastar entre a faixa do dia todo e as horas | Google e Mac | o item fica como estava, dia todo ou com hora | falta, sem parte |
| 2.8 | Esc no meio do arrastar desiste | Google | soltar sempre grava | falta, sem parte |

## 3. A linha do agora e a rolagem

| # | Comportamento | Nas referências | No Kiwi hoje | Estado |
|---|---|---|---|---|
| 3.1 | A linha do agora, que anda sozinha | nas três | a linha vermelha anda a cada minuto, e o "hoje" muda à meia-noite | cumpre |
| 3.2 | Abrir já rolado para perto da hora atual | nas três | abre 2 h antes do agora, e começa às 7:00 no mínimo | cumpre |
| 3.3 | Hoje destacado na cabeça e no Mês | nas três | `data-today` na cabeça do dia, na coluna e na célula do Mês | cumpre |
| 3.4 | O "Hoje" também rola até a hora atual | Google e Mac | só rola quando muda de semana. Se a pessoa já está na semana de hoje, a grade fica onde estava | falta, sem parte |

## 4. Trackpad e pinça

| # | Comportamento | Nas referências | No Kiwi hoje | Estado |
|---|---|---|---|---|
| 4.1 | Rolar a grade com dois dedos | nas três | a rolagem do próprio sistema | cumpre |
| 4.2 | Deslizar dois dedos para o lado troca o período | Mac | não há | falta, sem parte |
| 4.3 | A pinça (ou ⌘+ e ⌘−) muda a altura da hora | Mac: ⌘+ e ⌘− mudam o texto. A regra do trackpad do harry (#21198) pede a pinça | a altura da hora é fixa (`HOUR_PX` = 48) | falta, sem parte |

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
| 6.2 | A hora no nome lido do item | Google e Mac leem a hora | o leitor de tela ouve só o tipo e o título | falta, sem parte |
| 6.3 | O foco visível | nas três | o `:focus-visible` com a cor do tipo | cumpre |
| 6.4 | As vistas e os botões com nome | nas três | as vistas num `radiogroup`, e cada botão de ícone com `aria-label` | cumpre |
| 6.5 | Respeitar o "reduzir movimento" | Mac | a `@media (prefers-reduced-motion)` tira as animações | cumpre |

## 7. Português e inglês

| # | Comportamento | Nas referências | No Kiwi hoje | Estado |
|---|---|---|---|---|
| 7.1 | Todos os textos nas duas línguas | nas três | `calendar.pt` e `calendar.en`, com o `calendar-ui-check` nas duas | cumpre |
| 7.2 | A hora no formato do sistema (12 h ou 24 h) | Mac e Google seguem o sistema | sempre 24 h, também em inglês | falta, sem parte |
| 7.3 | O 1º dia da semana segue a região ou o ajuste | nas três | sempre segunda-feira | falta, sem parte |

## 8. Claro e escuro

| # | Comportamento | Nas referências | No Kiwi hoje | Estado |
|---|---|---|---|---|
| 8.1 | A tela segue o tema | nas três | as cores vêm dos tokens do tema, e as cores dos tipos são fixas | cumpre |
| 8.2 | O escuro tem roteiro e print | n/a (é a nossa prova) | os 4 roteiros do Calendário só rodam no claro | falta, sem parte |

## 9. Janela estreita

| # | Comportamento | Nas referências | No Kiwi hoje | Estado |
|---|---|---|---|---|
| 9.1 | Na Semana estreita, as cabeças dos dias não se sobrepõem | nas três | conferido pelo `calendar-narrow-check` (#495) | cumpre |
| 9.2 | Com o painel largo aberto, a grade ocupa o espaço que sobra (ponto 1) | Google e Teams | fica uma faixa vazia entre a grade e o painel | falta A |
| 9.3 | O painel largo nunca cobre o Kiwi nem o balão (ponto 8) | n/a (é do Kiwi) | o painel fica por cima do Kiwi | falta A |

## 10. Os itens na grade

| # | Comportamento | Nas referências | No Kiwi hoje | Estado |
|---|---|---|---|---|
| 10.1 | Itens no mesmo horário ficam lado a lado e dividem a coluna (ponto 9) | Teams e Google | em cascata, um por cima do outro | falta A |
| 10.2 | "+N" quando não cabem, no Dia e na Semana | Google e Teams | não há | falta A |
| 10.3 | "+N" no Mês | nas três | até 3 itens por dia, depois o "+n" | cumpre |
| 10.4 | Um item de vários dias, numa barra só | nas três | o teto é de 24 h (#449), e o item de mais de um dia não existe | falta, sem parte. O lead decide se o teto continua |
| 10.5 | Vários calendários com cor, para mostrar e esconder | nas três | o filtro por tipo e por projeto, que fica salvo (T32408) | cumpre |
| 10.6 | Atualiza sozinho quando a fonte muda | Google e Mac (e Google `r`, Mac ⌘R) | relê quando a nota muda (`onChanged`) | cumpre |
| 10.7 | A vista do Ano | Mac ⌘4, e Google | não há | falta, sem parte |

## 11. Editar e criar

| # | Comportamento | Nas referências | No Kiwi hoje | Estado |
|---|---|---|---|---|
| 11.1 | Mudar a data, o início, o fim e o "dia todo" por campos, no cartão (ponto 3) | nas três | só arrastando | falta B |
| 11.2 | Mudar o título, o tipo, o projeto, o aviso, a repetição e o texto, no cartão (ponto 4) | nas três | só o aviso, o Feito e o "adiar 1 dia" | falta B |
| 11.3 | Apagar pelo cartão, com Desfazer | nas três | não há | falta B |
| 11.4 | Aviso com qualquer antecedência | nas três | só "na hora", "10 min", "30 min" e "na véspera" | falta C |
| 11.5 | A repetição mensal, anual, nos dias úteis ou a que a pessoa montar | nas três | só a diária e a semanal | falta, sem parte |
| 11.6 | Duplicar um item | Google (Duplicar) e Mac (copiar e colar) | não há | falta, sem parte |

## 12. O Kiwi no Calendário (onde o Kiwi tem de ser melhor)

| # | Comportamento | Nas referências | No Kiwi hoje | Estado |
|---|---|---|---|---|
| 12.1 | "Me lembra às 10h e me avisa 50 min antes" vira um lembrete às 10:00 com o aviso 50 min antes (ponto 2) | n/a (só o Kiwi tem) | pode virar um item das 9:10 às 10:00, ou dois itens | falta C |
| 12.2 | O mesmo pedido repetido não duplica o item | n/a | duplica | falta C |
| 12.3 | O Kiwi apaga e muda os itens, e a pessoa desfaz pela Atividade (ponto 6) | n/a | só há o `calendar_create` e o `calendar_update`, sem apagar | falta C |
| 12.4 | A barra de cima aceita texto, tem a animação dela e mostra a resposta (ponto 7) | n/a | é só um botão que abre o Kiwi da tela | falta C |

## 13. Animações e desempenho

| # | Comportamento | Nas referências | No Kiwi hoje | Estado |
|---|---|---|---|---|
| 13.1 | Abrir e fechar o detalhe com animação | Mac e Teams | o painel largo cresce do item e volta para ele (550 e 600 ms), e o item pisca | cumpre |
| 13.2 | A troca de período com transição | Mac (desliza) | a grade troca de uma vez | falta, sem parte |
| 13.3 | Com 500 itens, a tela abre, rola e arrasta sem travar | nas três | não há teste nem medida | falta, sem parte |

## n/a

- **O fuso horário de cada item:** o Kiwi é local, num fuso só, o do Mac.
- **Convidados, salas, respostas e entrar na reunião (o Teams):** o Kiwi não tem contas nem rede, pelo ADR 0011.
- **Imprimir (Mac ⌘P):** o Calendário vem das notas, e a nota já se imprime nas Notas.

## As "falta" sem parte (para o lead abrir tasks)

Teclado:
- 1.1 a 1.5: ir para hoje, trocar o período, trocar a vista, criar um item e ir para uma data, tudo pela tecla;
- 1.7 e 1.8: andar entre os itens e mover um item pelas setas;
- 1.10: a lista dos atalhos;
- 1.11: buscar itens;
- 1.12: o Desfazer de mover, esticar e editar.

Arrastar:
- 2.7: arrastar entre o dia todo e as horas;
- 2.8: o Esc desiste do arrastar.

O resto:
- **Rolagem e trackpad:** 3.4 (o "Hoje" rola até a hora atual), 4.2 (deslizar para o lado troca o período) e 4.3 (a pinça muda a altura da hora).
- **Acessibilidade e língua:** 6.2 (a hora no nome lido), 7.2 (12 h ou 24 h, como o sistema) e 7.3 (o 1º dia da semana).
- **Provas:** 8.2 (roteiro e print no escuro) e 13.3 (o teste com 500 itens).
- **Decisões do lead:** 10.4 (itens de vários dias e o teto de 24 h) e 10.7 (a vista do Ano).
- **Criar e editar:** 11.5 (mais tipos de repetição) e 11.6 (duplicar um item).
- **Animação:** 13.2 (a transição da troca de período).
