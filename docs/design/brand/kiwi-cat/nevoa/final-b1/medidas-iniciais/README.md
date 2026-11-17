# CPU e FPS — B1

Demonstração WebKit, 640×800/DPR1, repouso3/s. CPU em % de um núcleo, somando os cinco processos próprios. Cada execução aquece10s e usa prazo monotônico60s; a duração efetiva, incluindo a última consulta, fica em cada JSON. Nenhuma gravação ocorreu durante as medidas.

| Escala | Média1 | Média2 | Média3 | Média das3 | P95 máximo | Média <3% |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 3.530 | 4.162 | 3.845 | 3.846 | 5.091 | não |
| 0.5 | 3.795 | 3.812 | 4.111 | 3.906 | 6.003 | não |
| 0.25 | 3.696 | 3.977 | 4.213 | 3.962 | 5.955 | não |

Base parada: 0.017% / 0.017% / 0.100%; um desenho por execução. Diferenças para a base permanecem no JSON; o critério usa CPU absoluta.
Proposta de escala: nenhuma; precisa otimizar. A preferência pela inteira só vale se sua média passar e as faixas observadas se sobrepuserem. Não é uma declaração de equivalência estatística.

CPU dos estados ativos tem janela diagnóstica de3s; FPS vem dos intervalos reais dos desenhos. P95 descreve pulsos de1s e não substitui a média. Os contadores por processo são da janela inteira: não atribuem a causa de cada pico. Todos os relatórios brutos e hashes foram preservados.
