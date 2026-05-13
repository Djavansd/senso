# Senso

Senso e um app web para gestao de servicos, clientes, orcamentos, agenda e financeiro.

O projeto hoje e um app estatico: as telas ficam em HTML dentro de `public/`, os comportamentos principais ficam em JavaScript, e os dados sao salvos no navegador e sincronizados com Firebase/Firestore quando o usuario esta autenticado.

## Estrutura do projeto

```text
senso/
  firebase/
    firestore.rules
  public/
    index.html
    manifest.json
    assets/
      icons/
    css/
      style.css
    js/
      app.js
      auth-guard.js
      firebase-config.js
      core/
        plans.js
        profile.js
      domains/
        mecanica/
          domain.js
    pages/
      agenda.html
      clientes.html
      configuracoes.html
      financeiro.html
      login.html
      nossos-servicos.html
      novo-cliente.html
      orcamento.html
      orcamentos.html
      pagamento-app.html
      resumo.html
      servico.html
  vercel.json
```

## Arquivos principais

- `public/index.html`: tela inicial/dashboard do app.
- `public/css/style.css`: estilos globais compartilhados pelas telas.
- `public/js/app.js`: logica principal do app, incluindo clientes, servicos, orcamentos, financeiro, configuracoes, armazenamento local e sincronizacao.
- `public/js/auth-guard.js`: controle de login, sessao do usuario e protecao das paginas.
- `public/js/firebase-config.js`: configuracao do projeto Firebase.
- `public/js/core/plans.js`: regras de plano, limites e leitura de dados do usuario no Firestore.
- `public/js/core/profile.js`: perfil ativo do app.
- `public/js/domains/mecanica/domain.js`: textos e configuracao do dominio de mecanica.
- `firebase/firestore.rules`: regras de seguranca do Firestore.
- `vercel.json`: configuracao de deploy na Vercel.

## Telas

- `agenda.html`: agenda de servicos.
- `clientes.html`: lista e gerenciamento de clientes.
- `novo-cliente.html`: cadastro de cliente.
- `servico.html`: cadastro/edicao de servico ou ordem de servico.
- `orcamentos.html`: lista de orcamentos.
- `orcamento.html`: visualizacao/impressao/exportacao de orcamento.
- `financeiro.html`: controle financeiro.
- `resumo.html`: resumo mensal.
- `configuracoes.html`: dados da empresa, cores, logo e ajustes do app.
- `pagamento-app.html`: tela relacionada ao pagamento/plano do app.
- `login.html`: entrada e cadastro de usuarios.
- `nossos-servicos.html`: pagina de servicos oferecidos.

## Dados e armazenamento

O app usa dois caminhos principais para dados:

- `localStorage`: guarda dados localmente no navegador.
- Firebase/Firestore: sincroniza os dados por usuario quando existe login ativo.

No `app.js`, a estrutura base dos dados possui:

- `clientes`
- `servicos`
- `financeiro`
- `orcamentos`

No Firestore, os dados do app ficam abaixo de:

```text
users/{uid}/appData/{profileId}
```

Tambem existe o documento:

```text
users/{uid}
```

Esse documento guarda dados do usuario, autorizacao e informacoes de plano.

## Login e seguranca

O app usa Firebase Authentication.

O arquivo `auth-guard.js` protege as paginas e redireciona usuarios nao autenticados para `login.html`.

As regras do Firestore ficam em `firebase/firestore.rules`. Elas controlam:

- leitura apenas pelo proprio usuario;
- criacao inicial de usuario com `autorizado == false`;
- bloqueio de acesso quando `autorizado == false`;
- limites de plano para clientes e servicos;
- bloqueio de escrita em colecoes sensiveis como `billingAlerts`.

## Planos e limites

O arquivo `public/js/core/plans.js` controla a leitura do plano do usuario.

Pelo comportamento atual, o plano basico mensal possui limites:

- ate 50 clientes ativos;
- ate 150 servicos.

Planos Pro ou pagamento a vista podem liberar limites maiores.

## Como rodar localmente

Como o projeto e estatico, da para abrir `public/index.html` no navegador.

Para testar de forma mais parecida com producao, e melhor servir a pasta `public/` com um servidor local, porque algumas funcoes do navegador funcionam melhor via HTTP.

Exemplo com Node:

```bash
npx serve public
```

Depois, abrir a URL mostrada no terminal.

## Deploy

O projeto esta preparado para deploy na Vercel.

O arquivo `vercel.json` define:

- `public: true`;
- URLs limpas;
- sem barra final obrigatoria;
- cabecalho `Cache-Control` com `no-store`, para evitar cache antigo durante alteracoes.

## Cuidados antes de alterar

Antes de fazer mudancas grandes:

1. Conferir o estado do Git:

```bash
git status
```

2. Criar um commit de backup:

```bash
git add .
git commit -m "Backup before changes"
```

3. Subir para o GitHub:

```bash
git push origin main
```

Assim, se algo quebrar, fica mais facil voltar para uma versao segura.

## Ideias futuras

Algumas evolucoes possiveis:

- documentar melhor o formato de cada item em `clientes`, `servicos`, `financeiro` e `orcamentos`;
- separar mais a criacao de orcamentos por itens, quantidade e valor unitario;
- adicionar comandos por voz com IA para criar orcamentos;
- criar testes automaticos para as funcoes mais importantes;
- criar uma rotina de backup/exportacao dos dados do usuario.

