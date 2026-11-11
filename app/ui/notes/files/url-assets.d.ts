// O `?url` do Vite: o arquivo entra no pack da UI como asset e o import devolve o endereço dele (o worker do pdf.js).
declare module "*?url" {
  const url: string;
  export default url;
}
