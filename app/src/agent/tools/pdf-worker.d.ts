// O worker do PDF.js, importado no main para rodar sem um worker de verdade (spec #11549): só o que o files.ts usa.
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}
