// L23: as palavras mais frequentes do português falado e escrito (artigos, preposições, pronomes, conjunções, os
// verbos e advérbios de todo dia). Uma troca a partir delas é gramática ou estilo, não um termo: aprender viraria
// regra para todo ditado depois (review do #266). Sem acento e em minúscula: compare com `fold`.

export const COMMON_WORDS: ReadonlySet<string> = new Set(
  `a o as os um uma uns umas de do da dos das no na nos nas ao aos à as em e ou mas mais menos que se nao sim
   por pelo pela pelos pelas para pra pro com sem sob sobre entre ate desde contra durante apos antes depois
   eu tu ele ela nos vos eles elas voce voces me te lhe lhes mim ti si comigo contigo conosco
   meu minha meus minhas teu tua teus tuas seu sua seus suas nosso nossa nossos nossas dele dela deles delas
   este esta estes estas esse essa esses essas aquele aquela aqueles aquelas isto isso aquilo
   quem qual quais quanto quanta quantos quantas quando onde como porque porque porem pois logo entao assim
   tambem ja ainda so apenas muito muita muitos muitas pouco pouca poucos poucas todo toda todos todas tudo nada
   algum alguma alguns algumas nenhum nenhuma outro outra outros outras mesmo mesma mesmos mesmas cada
   bem mal aqui ali la ca agora hoje ontem amanha sempre nunca talvez quase tanto tanta tao demais
   ser sou es e somos sao era eram foi foram fui sera serao seria seja sejam sendo sido
   estar estou esta estamos estao estava estavam esteve estive estara estaria esteja estejam estando estado
   ter tenho tem temos tinha tinham teve tive tera teria tenha tenham tendo tido
   haver ha havia houve havera haja
   fazer faco faz fazemos fazem fazia fez fiz fara faria faca facam feito fazendo
   ir vou vai vamos vao ia foi fomos iria va vamo indo ido
   poder posso pode podemos podem podia pude pode podera poderia possa possam
   dizer digo diz dizemos dizem disse disseram dito dizendo
   dar dou da damos dao deu dei dado dando
   ver vejo ve vemos veem viu vi visto vendo veja
   saber sei sabe sabemos sabem sabia soube saiba
   querer quero quer queremos querem queria quis queira
   ficar fico fica ficamos ficam ficou fiquei fique
   vir venho vem vimos vem veio vindo venha
   falar falo fala falamos falam falou falei fale
   passar passo passa passou passei
   achar acho acha achamos acham achou achei
   deixar deixo deixa deixou deixei
   precisar preciso precisa precisamos precisam precisou
   pegar pego pega pegou peguei
   mandar mando manda mandou mandei mande
   olhar olho olha olhou olhei
   coisa coisas vez vezes dia dias ano anos hora horas tempo gente pessoa pessoas casa trabalho parte lado
   forma jeito caso nome conta mundo vida semana mes meses minuto minutos segundo
   bom boa bons boas grande grandes novo nova novos novas melhor pior primeiro primeira ultimo ultima certo certa
   oi ola tchau obrigado obrigada valeu por favor beleza ok
   um dois tres quatro cinco seis sete oito nove dez cem mil`.split(/\s+/).filter(Boolean),
);
