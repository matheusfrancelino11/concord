# 🇺🇸 [English](README.en.md) | 🇧🇷 Português

<p align="center">
  <img src="docs/assets/brazil_flag.svg" alt="Bandeira do Brasil" height="200" />
  &nbsp;&nbsp;&nbsp;
  <img src="docs/assets/strawhat_flag.svg" alt="Bandeira dos Piratas do Chapéu de Palha" height="200" />
</p>

---

<p align="center">
  <img src="docs/assets/concord_mascot.png" alt="Mascote Concord" width="140" />
</p>

<h1 align="center">CONCORD</h1>

<p align="center">
  <strong>Uma Plataforma Soberana, Auto-Hospedável, para Voz, Vídeo e Chat.</strong><br>
  <em>Construída para a autonomia. Projetada para amigos. Livre de censura governamental.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Status-Desenvolvimento%20Ativo-23a55a?style=for-the-badge" alt="Status" />
  <img src="https://img.shields.io/badge/Arquitetura-Tauri%20v2%20%7C%20Go%20%7C%20LiveKit-5865F2?style=for-the-badge" alt="Stack Tecnológica" />
  <img src="https://img.shields.io/badge/Plataforma-Windows%20(Desktop)-blue?style=for-the-badge&logo=windows" alt="Plataforma" />
  <img src="https://img.shields.io/badge/Telemetria-Zero%20%2F%20Nenhuma-critical?style=for-the-badge" alt="Sem Telemetria" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/Licen%C3%A7a-MIT-23a55a?style=for-the-badge" alt="Licença MIT" /></a>
</p>

---

> ### 🏴‍☠️ _Se tirarem uma ferramenta de nossas mãos, construímos outra. Se fecharem uma porta, entramos pela janela. A liberdade não pode ser tomada de nós._

---

## ⚡ Sumário

- [O Manifesto](#-o-manifesto)
- [Nossa Filosofia](#-nossa-filosofia)
- [O Projeto](#-o-projeto)
- [Arquitetura e Stack Tecnológica](#-arquitetura-e-stack-tecnológica)
- [Por Que Open Source?](#-por-que-open-source)
- [Como Executar Localmente](#-como-executar-localmente)
- [Guia de Self-Hosting (Deploy em Produção)](#-guia-de-self-hosting-deploy-em-produção)
- [Como Contribuir](#-como-contribuir)
- [Licença](#-licença)
- [Aviso Legal e Propriedade Intelectual](#-aviso-legal-e-propriedade-intelectual)
- [Encerramento](#-encerramento)

---

## 🏴‍☠️ O Manifesto

**O Concord nasceu de um ato de rebeldia digital.**

Vivemos em um país em que a comunicação online se tornou refém do governo. Eles determinam quem tem o direito de falar, quem é banido, quais arquivos podem ser compartilhados e quais restrições artificiais são impostas à convivência cotidiana entre amigos. Quando uma dessas plataformas centrais sai do ar, altera suas políticas repentinamente ou se torna inacessível por decisões estatais, comunidades inteiras simplesmente desaparecem de um dia para o outro.

Nós nos recusamos a aceitar essa dependência.

**Nenhum governo, empresa ou instituição deveria ter o poder absoluto de determinar quais ferramentas as pessoas podem utilizar para se comunicar livremente.**

Quando a nossa necessidade de compartilhar tela, conversar em chamadas de voz e passar tempo com nosso círculo de amigos foi ameaçada, nós não cruzamos os braços. Nós construímos a nossa própria ferramenta soberana e independente.

Este projeto existe para demonstrar uma verdade: **O governo só tem capacidade de opressão, quando a população aceita ser oprimida.**

### Por que a bandeira dos Piratas do Chapéu de Palha?

A bandeira dos Piratas do Chapéu de Palha que estampa o topo do projeto não é um enfeite visual, é uma declaração. No universo de _One Piece_, a Jolly Roger do bando de Luffy não simboliza roubos ou crueldade, ela representa a liberdade absoluta, a lealdade inabalável entre amigos e a coragem de olhar nos olhos de um Governo Mundial autoritário e declarar: **"Vocês não são donos do nosso destino."**

No ambiente digital, erguemos essa mesma bandeira para lembrar a cada desenvolvedor e comunidade que a sua **liberdade** pertence a você. Você tem o direito inalienável de construir suas próprias ferramentas, hospedar seus próprios servidores e falar livremente o quê e com quem você quiser.

---

## 🧭 Nossa Filosofia

1. **Liberdade de Expressão Intransigente:** Sem filtros algorítmicos opacos, sem vigilância corporativa e sem venda de dados para anunciantes.
2. **Self-Hosting como Direito Fundamental:** A verdadeira autonomia só existe quando você pode rodar sua própria infraestrutura em uma VPS básica ou em um computador comum na sua sala.
3. **Conhecimento Técnico Compartilhado:** Em vez de esconder segredos industriais, documentamos toda a arquitetura, desde roteamento WebRTC SFU até máquinas de estado WebSocket—para que novos programadores aprendam na prática a construir sistemas distribuídos.
4. **Resiliência por Descentralização:** O código está aqui para você clonar, modificar, traduzir ou reimplementar em redes privadas. O conhecimento, uma vez descentralizado, jamais pode ser confiscado.

---

## 🛠️ O Projeto

O Concord é um aplicativo de comunicação desktop completo, rápido e leve, desenvolvido sob medida para grupos de amigos e equipes independentes.

### 📸 Interface do Aplicativo

<p align="center">
  <img src="docs/assets/screenshot_screenshare.png" alt="Concord — Compartilhamento de Tela Ao Vivo" width="100%" />
  <br>
  <em>Compartilhamento de tela ao vivo com indicadores de transmissão e detecção de voz em tempo real</em>
</p>

| Canais de Voz e Servidores | Amigos e Mensagens Diretas (DMs) |
| :---: | :---: |
| <img src="docs/assets/screenshot_voice.png" alt="Concord — Canal de Voz" width="100%" /> | <img src="docs/assets/screenshot_friends.png" alt="Concord — Amigos e Mensagens Diretas" width="100%" /> |

### O Que Está Efetivamente Implementado e Funcional Hoje

Diferente de projetos que são apenas conceitos ou maquetes visuais, o Concord conta com todas as suas 7 etapas fundamentais concluídas e em uso operacional diário:

- **🎙️ Canais de Voz em Tempo Real (WebRTC SFU):**
  - Áudio de alta fidelidade via codec Opus roteado por uma unidade seletiva de encaminhamento (SFU).
  - Detecção local de atividade de voz (VAD) contínua com medidor visual VU (anel verde ao falar sem cortes).
  - Modo _Pressionar para Falar_ (Push-to-Talk) configurável com captura de atalho do teclado.
  - Cancelamento de eco nativo, supressão de ruído e controle automático de ganho (AGC).
  - Controle individual de volume por usuário (de 0% a 200%) e opção de mutar participantes localmente.
- **🖥️ Compartilhamento de Tela e Janelas em Alta Definição (Theater Mode):**
  - Captura fluida da tela inteira ou janela específica com suporte ao áudio do sistema operacional no Windows.
  - Galeria multi-transmissão: assista a múltiplos amigos transmitindo ao mesmo tempo ou expanda em destaque total (Modo Cinema).
  - Configurações de transmissão: resolução selecionável (720p / 1080p / 1440p) e taxa de quadros (30 / 60 FPS).
- **💬 Mensagens de Texto em Tempo Real e Mensagens Diretas (DMs):**
  - Canais de texto persistentes com formatação rica em Markdown, upload de imagens com pré-visualização e respostas citadas.
  - Edição de mensagens em tempo real, exclusão imediata e reações com emojis.
  - Mensagens diretas privadas (DMs) de 1 para 1 com indicadores de mensagens não lidas.
- **⚡ Gateway em Tempo Real (WebSocket):**
  - Protocolo Gateway bidirecional com heartbeat para evitar conexões fantasmas.
  - Indicadores instantâneos de digitação (_"Alice está digitando..."_), presença dinâmica dos membros (_Disponível_, _Ausente_, _Não Perturbe_, _Invisível_).
  - Reconexão automática transparente e retomada de sessão em caso de instabilidade na rede.
- **🛡️ Administração de Servidores e Permissões:**
  - Gerador de identificadores únicos de 64 bits padrão Snowflake (com época própria do Concord).
  - Controle de acesso baseado em cargos (_roles_) com campos de bits (_bitfields_) para permissões granulares (`ADMINISTRATOR`, `MANAGE_GUILD`, `MUTE_MEMBERS`, etc.).
  - Criação rápida de links de convite (`/invite/:code`) e personalização de permissões por canal.
- **💻 Experiência Desktop Nativa (Tauri v2 + Rust):**
  - Integração com o Windows: ícone na bandeja do sistema (System Tray), permitindo minimizar e manter chamadas ativas em segundo plano.
  - Concessão nativa de permissões de microfone e reparo automático de bloqueios acidentais.
  - Sistema de atualização remota automática criptograficamente assinado com chaves Ed25519 (Minisign),permitindo lançar patches para todos os usuários com 1 clique.

---

## 🏗️ Arquitetura e Stack Tecnológica

O Concord substitui os tradicionais clientes pesados baseados puramente em Electron por um núcleo nativo hiper-eficiente em Rust/Tauri e um backend concorrente em Go:

```mermaid
flowchart TD
    subgraph Client ["Cliente Concord (Desktop)"]
        UI["React 19 + TypeScript\nTailwind CSS + Zustand"]
        Tauri["Tauri v2 Shell\nRust Core + WebView2"]
        LiveKitClient["LiveKit Client SDK\n(Áudio e Vídeo WebRTC)"]
        UI <--> Tauri
        UI <--> LiveKitClient
    end

    subgraph Edge ["Borda / Proxy Reverso"]
        Caddy["Caddy 2 Web Server\n(HTTPS Automático / TLS)"]
    end

    subgraph Backend ["Infraestrutura Concord"]
        GoAPI["Go REST API & Gateway\n(Roteador Chi + Hub WebSocket)"]
        LiveKitServer["LiveKit SFU Server\n(Selective Forwarding Unit)"]
        Postgres[("PostgreSQL 17\n(Modelo de Dados Snowflake)")]
        Storage[("Uploads e Updates\nVolume em Disco")]
    end

    Client -- "HTTPS / WSS (API & Gateway)" --> Caddy
    Client -- "WebRTC UDP (Voz e Tela)" --> LiveKitServer
    Caddy --> GoAPI
    GoAPI --> Postgres
    GoAPI --> Storage
    GoAPI -- "Geração de Tokens e Sync" --> LiveKitServer
```

### Tecnologias Utilizadas

| Camada                      | Tecnologia                                                                            | Função no Sistema                                                   |
| --------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **Desktop Shell**           | [Tauri v2](https://tauri.app/) (Rust)                                                 | Ciclo de vida da janela, bandeja do sistema, áudio nativo e updater |
| **Interface (UI)**          | [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)        | Arquitetura reativa de componentes modulares                        |
| **Estilização**             | [Tailwind CSS](https://tailwindcss.com/) + [Radix UI](https://www.radix-ui.com/)      | Paleta Dark Theme, menus de contexto e modais acessíveis            |
| **Gerenciamento de Estado** | [Zustand](https://zustand.docs.pmnd.rs/)                                              | Stores globais com persistência local e zero overhead               |
| **Backend API**             | [Go (Golang)](https://go.dev/) 1.22+                                                  | Servidor REST e gateway WebSocket concorrente e seguro em memória   |
| **Roteador HTTP**           | [chi v5](https://github.com/go-chi/chi)                                               | Roteamento HTTP idiomático e ultrarrápido em Go                     |
| **Banco de Dados**          | [PostgreSQL 17](https://www.postgresql.org/) + [pgx v5](https://github.com/jackc/pgx) | Persistência relacional robusta com pool de conexões otimizado      |
| **Servidor de Mídia**       | [LiveKit SFU](https://livekit.io/)                                                    | Roteador WebRTC de baixa latência para voz e transmissão de tela    |
| **Proxy Reverso**           | [Caddy 2](https://caddyserver.com/)                                                   | Emissão automática de certificados SSL/TLS, HTTP/2 e WebSocket      |

---

## 💡 Por Que Open Source?

O Concord é open source porque **segredos geram centralização, enquanto a transparência constrói liberdade**.

1. **Auditabilidade Total:** Você não precisa confiar cegamente em arquivos binários pré-compilados. Qualquer pessoa pode inspecionar cada linha em Go e Rust para comprovar que não há telemetria secreta, mineradores ou portas dos fundos.
2. **Aprendizado Técnico:** Implementar áudio, vídeo e transmissão de tela em tempo real muitas vezes parece um bicho de sete cabeças. Esta base de código serve como uma referência aberta de como conectar WebSockets em Go, SFUs WebRTC e clientes em Tauri v2.
3. **Evolução Colaborativa:** Encontrou um bug? Quer adicionar criptografia de ponta a ponta ou suporte a novas plataformas? O código está aberto para seus forks e pull requests.
4. **Sobrevivência do Projeto:** Mesmo se o criador original parar de manter o repositório, o software continuará vivo e funcionando nos computadores de qualquer um que o tenha clonado.

---

## 🚀 Como Executar Localmente

Siga o passo a passo abaixo para rodar a stack completa do Concord no seu computador de desenvolvimento.

### Requisitos Prévios

- **Go:** versão 1.22 ou superior ([Download](https://go.dev/dl/))
- **Node.js:** versão 20.x ou superior com `npm` ([Download](https://nodejs.org/))
- **Rust e Cargo:** toolchain estável ([Instalar via rustup](https://rustup.rs/))
- **PostgreSQL:** instância local rodando na porta 5432 ou via Docker
- **LiveKit Server:** (Opcional para chamadas locais, [LiveKit CLI](https://docs.livekit.io/home/cli/cli-setup/))

### 1. Clonar o Repositório

```bash
git clone https://github.com/seu-usuario/concord.git
cd concord
```

### 2. Configurar e Iniciar o Backend

```bash
cd concord

# Copiar arquivo de exemplo de ambiente
cp .env.example .env

# Configure o .env com a string de conexão do seu PostgreSQL:
# DATABASE_URL=postgres://concord:concord@127.0.0.1:5432/concord?sslmode=disable
# JWT_SECRET=sua_chave_secreta_aleatoria_aqui

# Baixar módulos e iniciar o servidor (as migrações rodam sozinhas ao subir)
go run cmd/server/main.go
```

_O backend em Go estará ouvindo em `http://127.0.0.1:8080`._

### 3. Iniciar o Cliente Desktop

Abra um segundo terminal:

```bash
cd concord-client

# Instalar dependências da interface
npm install

# Iniciar o Concord em modo de desenvolvimento (hot-reload ativado)
npm run tauri dev
```

### 4. Compilar os Instaladores de Produção

Para gerar os executáveis finais para Windows (`.exe` e `.msi`):

```bash
cd concord-client
npm run tauri build
```

_Os instaladores gerados ficarão salvos em `concord-client/src-tauri/target/release/bundle/`._

---

## 🌐 Guia de Self-Hosting (Deploy em Produção)

Deseja hospedar o Concord para seus amigos em um servidor próprio (VPS na nuvem)? O repositório já vem com a orquestração via Docker Compose pronta para uso.

### Infraestrutura Recomendada

- **Servidor:** 2 vCPUs, 4GB de RAM (ex: Oracle Cloud Always Free, Hetzner, DigitalOcean ou Linode).
- **Sistema Operacional:** Ubuntu 22.04 LTS / 24.04 LTS ou Debian 12.
- **Portas Liberadas no Firewall:**
  - `80/TCP` e `443/TCP` (Caddy HTTP/HTTPS)
  - `7880/TCP` (LiveKit API)
  - `50000-50100/UDP` (Tráfego de Voz e Vídeo WebRTC)

### Deploy com Docker Compose

1. No servidor, clone o repositório:

   ```bash
   git clone https://github.com/seu-usuario/concord.git
   cd concord/deploy
   ```

2. Configure suas variáveis de ambiente:

   ```bash
   cp .env.example .env
   # Defina seu domínio (ex: concord.seudominio.com), senhas do banco e segredos do LiveKit
   ```

3. Inicie os contêineres:
   ```bash
   docker compose up -d --build
   ```

O Caddy cuidará automaticamente da criação e renovação dos certificados SSL/TLS da Let's Encrypt para o seu domínio, e seu servidor estará no ar!

---

## 🤝 Como Contribuir

O Concord cresce com a contribuição de programadores, designers e entusiastas da liberdade digital.

1. **Faça um Fork:** Clique em `Fork` no topo desta página do GitHub.
2. **Crie uma Branch para a sua Funcionalidade:**
   ```bash
   git checkout -b feature/minha-melhoria
   ```
3. **Faça Commit das Alterações:**
   ```bash
   git commit -m "feat: adicionar atalho para silenciar entrada de voz"
   ```
4. **Envie para o seu Repositório:**
   ```bash
   git push origin feature/minha-melhoria
   ```
5. **Abra um Pull Request:** Explique a motivação da mudança, os testes executados e o impacto na arquitetura.

Certifique-se de manter a coerência do código, não adicionar rastreadores de terceiros e rodar os testes (`go test ./...` e `npm run build`).

---

## ⚖️ Licença

Este projeto é distribuído sob a **[Licença MIT](LICENSE)** (Permissiva).

Você tem total liberdade para usar, estudar, clonar, modificar, auto-hospedar e distribuir o código com o mínimo de burocracia, mantendo apenas os avisos de direitos autorais e permissão originais.

---

## 📜 Aviso Legal e Propriedade Intelectual

- **Referência a One Piece:** O uso da bandeira dos Piratas do Chapéu de Palha é uma homenagem cultural e filosófica com finalidade simbólica de celebração da liberdade digital e cooperação entre pares. Este projeto **não** possui filiação oficial, patrocínio ou vínculo comercial com Eiichiro Oda, Shueisha, Toei Animation ou suas afiliadas.
- **Referência ao Discord:** _Discord_ é uma marca registrada da Discord Inc. O Concord é um software independente, desenvolvido do zero para fins educacionais e de uso comunitário privado, sem qualquer afiliação ou respaldo da Discord Inc.

---

## ⚓ Encerramento

> _Ferramentas podem ser proibidas. Servidores podem ser bloqueados. Plataformas podem se corromper._  
> _Mas o conhecimento compartilhado livremente entre pessoas é indestrutível._  
> **_Icem as velas, construam suas próprias ferramentas e nunca peçam permissão para se comunicar._**

<p align="center">
  <img src="docs/assets/strawhat_flag.svg" alt="Vetor Jolly Roger" width="180" />
</p>
<p align="center">
  <strong>Concord — Liberdade para se Comunicar.</strong>
</p>
