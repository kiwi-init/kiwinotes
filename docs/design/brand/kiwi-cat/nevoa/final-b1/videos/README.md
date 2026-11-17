# Vídeos finais para distribuição

Dez MP4, 640 × 800, 30 fps, sem áudio, sem escala ou retiming. Os seis
clipes curtos acima de 300 KB foram recomprimidos para 160–239 KB. Os três
repousos curtos já estavam em 127–141 KB; o de 60 s já estava em 1,03 MB.
Esses quatro arquivos permaneceram idênticos aos originais.

Os PNGs individuais e os binários dos estudos históricos foram retirados;
a folha de contato e todos os relatórios JSON permanecem. A escolha do
movimento B está no #8693 e a da textura B1 no #8754 do Kiwi Channels.

Compressão dos seis clipes maiores, a partir de cada original (CRF 18):

```sh
ffmpeg -i original.mp4 -an -c:v libx264 -preset veryslow -crf 22 \
  -threads 2 -pix_fmt yuv420p -movflags +faststart distribuicao.mp4
```

[Conferência da distribuição](verificacao.json): tamanhos, hashes antes e
depois, duração, quadros e comparações dos quadros decodificados. SSIM dos
clipes recomprimidos entre 0,99535 e 0,99618. Também foram inspecionados
lado a lado recortes da névoa laranja e perolada, sem novas faixas de cor
visíveis nesses quadros; o número de SSIM não substitui essa inspeção.

A [conferência original](verificacao-original.json) foi preservada sem
alteração. O [relatório de captura](report.json) registra os desenhos e
hashes dos PNGs produzidos antes da codificação, portanto não muda com a
recompressão. O vídeo de 60 s tem 120 desenhos distintos.

Para não recriar PNGs redundantes, o script só salva um still individual
quando `KIWI_FOG_STILLS=1`. A folha de contato vem dos MP4 distribuídos.
Nenhum número de desempenho foi medido durante captura ou compressão.
