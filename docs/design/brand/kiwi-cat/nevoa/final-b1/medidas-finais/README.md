# Medidas finais B1 — inteira, repouso 2/s

WebKit headless, 640 × 800 / DPR 1; CPU em % de um núcleo, somando os cinco processos próprios. Cada execução aquece 10 s e mede 60 s por prazo monotônico, sem gravador nem outros testes simultâneos. Todos os brutos foram preservados.

| Rodada | Média CPU | P95 CPU | Duração efetiva |
| --- | --- | --- | --- |
| 1 | 2.598% | 4.025% | 60.056s |
| 2 | 3.013% | 4.977% | 60.081s |
| 3 | 3.080% | 4.031% | 60.074s |

**Média das três: 2.897%. Critério absoluto <3%: passou.** 2 rodada(s) isolada(s) em ou acima de 3%; o aceite usa a média das três (#8651). P95 descreve os pulsos de 1 s e não substitui a média.

| Estado | FPS 1 | FPS 2 | FPS 3 |
| --- | --- | --- | --- |
| repouso | 2.000 | 2.000 | 2.000 |
| dormindo | 2.000 | 2.000 | 2.000 |
| acordou | 59.994 | 60.026 | 59.987 |
| ouvindo | 59.987 | 60.019 | 60.000 |
| thinking | 59.981 | 60.095 | 60.000 |
| agindo | 60.006 | 59.987 | 60.026 |
| pronto | 59.981 | 59.987 | 60.038 |
| erro | 60.013 | 60.006 | 60.000 |

FPS usa intervalos reais entre desenhos. CPU dos demais estados é diagnóstico de 3 s após 1 s de estabilização; os números completos estão no resumo e nos brutos. A [base parada da matriz anterior](../medidas-demanda/README.md) está preservada e não foi subtraída do critério absoluto.

CPU por processo (% de um núcleo):

| Rodada | Browser | Página | GPU | Rede | Launcher |
| --- | --- | --- | --- | --- | --- |
| 1 | 0.500 | 1.515 | 0.583 | 0.000 | 0.000 |
| 2 | 0.566 | 1.748 | 0.682 | 0.017 | 0.000 |
| 3 | 0.583 | 1.764 | 0.716 | 0.017 | 0.000 |

Commit medido: cba984acce9f97ee6908a1fdcc533936ac84da11. Fontes e hashes no resumo. Os números valem só para a demonstração, **não para o WKWebView do app**. A gravação visual é outra execução.
