# CPU e FPS — B1

Demonstração WebKit, 640×800/DPR1, repouso3/s. CPU em % de um núcleo, somando os cinco processos próprios. Cada execução aquece10s e usa prazo monotônico60s; a duração efetiva, incluindo a última consulta, fica em cada JSON. Nenhuma gravação ocorreu durante as medidas.

| Escala | Média1 | Média2 | Média3 | Média das3 | P95 máximo | Média <3% |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 3.130 | 3.912 | 3.578 | 3.540 | 5.158 | não |
| 0.5 | 3.530 | 3.529 | 3.196 | 3.418 | 5.044 | não |
| 0.25 | 3.414 | 2.996 | 3.462 | 3.291 | 5.037 | não |

Base parada: 0.050% / 0.017% / 0.017%; um desenho por execução. Diferenças para a base permanecem no JSON; o critério usa CPU absoluta.
Proposta de escala: nenhuma; precisa otimizar. A preferência pela inteira só vale se sua média passar e as faixas observadas se sobrepuserem. Não é uma declaração de equivalência estatística.

CPU dos estados ativos tem janela diagnóstica de3s; FPS vem dos intervalos reais dos desenhos. P95 descreve pulsos de1s e não substitui a média. Os contadores por processo são da janela inteira: não atribuem a causa de cada pico. Todos os relatórios brutos e hashes foram preservados.
