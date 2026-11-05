# 🇧🇷 [Português](README.md) | 🇺🇸 English

<p align="center">
  <img src="docs/assets/brazil_flag.svg" alt="Flag of Brazil" height="200" />
  &nbsp;&nbsp;&nbsp;
  <img src="docs/assets/strawhat_flag.svg" alt="Straw Hat Pirates Jolly Roger" height="200" />
</p>

---

<p align="center">
  <img src="docs/assets/concord_mascot.png" alt="Concord Mascot" width="140" />
</p>

<h1 align="center">CONCORD</h1>

<p align="center">
  <strong>A Sovereign, Self-Hostable Platform for Voice, Video, and Chat.</strong><br>
  <em>Built for autonomy. Engineered for friends. Free from governmental censorship.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Status-Active%20Development-23a55a?style=for-the-badge" alt="Status" />
  <img src="https://img.shields.io/badge/Architecture-Tauri%20v2%20%7C%20Go%20%7C%20LiveKit-5865F2?style=for-the-badge" alt="Tech Stack" />
  <img src="https://img.shields.io/badge/Platform-Windows%20(Desktop)-blue?style=for-the-badge&logo=windows" alt="Platform" />
  <img src="https://img.shields.io/badge/Telemetry-Zero%20%2F%20None-critical?style=for-the-badge" alt="Zero Telemetry" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-23a55a?style=for-the-badge" alt="MIT License" /></a>
</p>

---

> ### 🏴‍☠️ _If they take a tool from our hands, we will build another. If they close a door, we will enter through the window. Freedom cannot be taken from us._

---

## ⚡ Table of Contents

- [The Manifesto](#-the-manifesto)
- [Our Philosophy](#-our-philosophy)
- [The Project](#-the-project)
- [Architecture and Tech Stack](#-architecture-and-tech-stack)
- [Why Open Source?](#-why-open-source)
- [How to Run Locally](#-how-to-run-locally)
- [Self-Hosting Guide (Production Deploy)](#-self-hosting-guide-production-deploy)
- [How to Contribute](#-how-to-contribute)
- [License](#-license)
- [Legal and Intellectual Property Notice](#-legal-and-intellectual-property-notice)
- [Closing Words](#-closing-words)

---

## 🏴‍☠️ The Manifesto

**Concord was born from an act of digital rebellion.**

We live in a country where online communication has become hostage to the government. They dictate who has the right to speak, who gets banned, which files can be shared, and which artificial restrictions are imposed on everyday social interactions between friends. When one of these centralized platforms goes dark, changes its policies abruptly, or becomes inaccessible due to state decisions, entire communities simply vanish overnight.

We refuse to accept this dependence.

**No government, corporation, or institution should hold absolute power over the tools people use to communicate freely.**

When our daily need to screen share, talk in voice calls, and spend time with our circle of friends was threatened, we did not sit idly by. We built our own sovereign and independent tool.

This project exists to prove a truth: **The government only has the capacity to oppress when the population accepts being oppressed.**

### Why the Straw Hat Pirates flag?

The Straw Hat Pirates flag featured at the top of the project is not a visual decoration—it is a declaration. In the universe of _One Piece_, the Jolly Roger of Luffy's crew does not symbolize plunder or cruelty; it represents absolute freedom, unshakeable loyalty among friends, and the courage to look into the eyes of an authoritarian World Government and declare: **"You do not own our destiny."**

In the digital environment, we raise this same flag to remind every developer and community that your **freedom** belongs to you. You have the inalienable right to build your own tools, host your own servers, and speak freely about whatever and with whomever you choose.

---

## 🧭 Our Philosophy

1. **Uncompromising Freedom of Expression:** No opaque algorithmic filters, no corporate surveillance, and no selling of data to advertisers.
2. **Self-Hosting as a Fundamental Right:** True autonomy only exists when you can run your own infrastructure on a basic VPS or an everyday computer in your living room.
3. **Shared Technical Knowledge:** Instead of hiding industrial secrets, we document the entire architecture, from WebRTC SFU routing to WebSocket state machines—so that new programmers learn in practice how to build distributed systems.
4. **Resilience Through Decentralization:** The code is here for you to clone, modify, translate, or reimplement in private networks. Knowledge, once decentralized, can never be confiscated.

---

## 🛠️ The Project

Concord is a complete, fast, and lightweight desktop communication app, custom-built for groups of friends and independent teams.

### 📸 Application Interface

<p align="center">
  <img src="docs/assets/screenshot_screenshare.png" alt="Concord — Live Screen Sharing" width="100%" />
  <br>
  <em>Live screen sharing with stream indicators and real-time voice activity detection</em>
</p>

| Voice Channels & Servers | Friends & Direct Messages (DMs) |
| :---: | :---: |
| <img src="docs/assets/screenshot_voice.png" alt="Concord — Voice Channel" width="100%" /> | <img src="docs/assets/screenshot_friends.png" alt="Concord — Friends and Direct Messages" width="100%" /> |

### What Is Actually Implemented and Functional Today

Unlike projects that are merely concepts or visual mockups, Concord has all of its 7 fundamental milestones completed and in daily operational use:

- **🎙️ Real-Time Voice Channels (WebRTC SFU):**
  - High-fidelity audio via Opus codec routed through a selective forwarding unit (SFU).
  - Continuous local voice activity detection (VAD) with visual VU meter (green ring when speaking without clipping).
  - Configurable Push-to-Talk mode with keyboard hotkey capture.
  - Native echo cancellation, noise suppression, and automatic gain control (AGC).
  - Per-user volume control (from 0% to 200%) and local mute option for participants.
- **🖥️ High-Definition Screen and Window Sharing (Theater Mode):**
  - Fluid capture of full screen or specific application window with Windows system audio support.
  - Multi-stream gallery: watch multiple friends streaming simultaneously or expand into full spotlight (Theater Mode).
  - Stream settings: selectable resolution (720p / 1080p / 1440p) and frame rate (30 / 60 FPS).
- **💬 Real-Time Text Messaging and Direct Messages (DMs):**
  - Persistent text channels with rich Markdown formatting, image uploads with preview, and quoted replies.
  - Real-time message editing, immediate deletion, and emoji reactions.
  - Private 1-on-1 direct messages (DMs) with unread message indicators.
- **⚡ Real-Time Gateway (WebSocket):**
  - Bidirectional Gateway protocol with heartbeats to prevent ghost connections.
  - Instant typing indicators (_"Alice is typing..."_), dynamic member presence (_Online_, _Idle_, _Do Not Disturb_, _Invisible_).
  - Seamless automatic reconnection and session resumption during network instability.
- **🛡️ Server Administration and Permissions:**
  - Unique 64-bit Snowflake ID generator (with Concord's custom epoch).
  - Role-based access control with bitfields for granular permissions (`ADMINISTRATOR`, `MANAGE_GUILD`, `MUTE_MEMBERS`, etc.).
  - Instant invite link creation (`/invite/:code`) and per-channel permission overrides.
- **💻 Native Desktop Experience (Tauri v2 + Rust):**
  - Windows integration: system tray icon allowing minimizing while keeping active calls running in the background.
  - Native microphone permission granting and automatic repair of accidental system blocks.
  - Cryptographically signed auto-updater using Ed25519 keys (Minisign), allowing rolling out patches to all users with 1 click.

---

## 🏗️ Architecture and Tech Stack

Concord replaces traditional heavy Electron-based desktop clients with a hyper-efficient native core in Rust/Tauri and a concurrent backend in Go:

```mermaid
flowchart TD
    subgraph Client ["Concord Client (Desktop)"]
        UI["React 19 + TypeScript\nTailwind CSS + Zustand"]
        Tauri["Tauri v2 Shell\nRust Core + WebView2"]
        LiveKitClient["LiveKit Client SDK\n(WebRTC Audio & Video)"]
        UI <--> Tauri
        UI <--> LiveKitClient
    end

    subgraph Edge ["Edge / Reverse Proxy"]
        Caddy["Caddy 2 Web Server\n(Automatic HTTPS / TLS)"]
    end

    subgraph Backend ["Concord Infrastructure"]
        GoAPI["Go REST API & Gateway\n(Chi Router + WebSocket Hub)"]
        LiveKitServer["LiveKit SFU Server\n(Selective Forwarding Unit)"]
        Postgres[("PostgreSQL 17\n(Snowflake Data Model)")]
        Storage[("Uploads and Updates\nDisk Volume")]
    end

    Client -- "HTTPS / WSS (API & Gateway)" --> Caddy
    Client -- "WebRTC UDP (Voice and Screen)" --> LiveKitServer
    Caddy --> GoAPI
    GoAPI --> Postgres
    GoAPI --> Storage
    GoAPI -- "Token Generation and Sync" --> LiveKitServer
```

### Technologies Used

| Layer                   | Technology                                                                            | System Function                                                 |
| ----------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **Desktop Shell**       | [Tauri v2](https://tauri.app/) (Rust)                                                 | Window lifecycle, system tray, native audio, and updater        |
| **User Interface (UI)** | [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)        | Reactive architecture of modular components                     |
| **Styling**             | [Tailwind CSS](https://tailwindcss.com/) + [Radix UI](https://www.radix-ui.com/)      | Dark Theme palette, accessible context menus, and modals        |
| **State Management**    | [Zustand](https://zustand.docs.pmnd.rs/)                                              | Global stores with local persistence and zero overhead          |
| **Backend API**         | [Go (Golang)](https://go.dev/) 1.22+                                                  | REST server and concurrent, memory-safe WebSocket gateway       |
| **HTTP Router**         | [chi v5](https://github.com/go-chi/chi)                                               | Idiomatic and ultra-fast HTTP routing in Go                     |
| **Database**            | [PostgreSQL 17](https://www.postgresql.org/) + [pgx v5](https://github.com/jackc/pgx) | Robust relational persistence with optimized connection pooling |
| **Media Server**        | [LiveKit SFU](https://livekit.io/)                                                    | Low-latency WebRTC router for voice and screen sharing          |
| **Reverse Proxy**       | [Caddy 2](https://caddyserver.com/)                                                   | Automatic SSL/TLS certificate issuance, HTTP/2, and WebSockets  |

---

## 💡 Why Open Source?

Concord is open source because **secrets breed centralization, while transparency builds freedom**.

1. **Total Auditability:** You don't need to blindly trust pre-compiled binary files. Anyone can inspect every single line in Go and Rust to prove that there is zero secret telemetry, crypto-miners, or backdoors.
2. **Technical Learning:** Implementing real-time audio, video, and screen sharing often seems daunting. This codebase serves as an open reference for how to connect WebSockets in Go, WebRTC SFUs, and Tauri v2 clients.
3. **Collaborative Evolution:** Found a bug? Want to add end-to-end encryption or support for new platforms? The code is completely open for your forks and pull requests.
4. **Project Survival:** Even if the original creator stops maintaining the repository, the software will remain alive and functional on the computers of anyone who has cloned it.

---

## 🚀 How to Run Locally

Follow the step-by-step instructions below to run the complete Concord stack on your development machine.

### Prerequisites

- **Go:** version 1.22 or higher ([Download](https://go.dev/dl/))
- **Node.js:** version 20.x or higher with `npm` ([Download](https://nodejs.org/))
- **Rust and Cargo:** stable toolchain ([Install via rustup](https://rustup.rs/))
- **PostgreSQL:** local instance running on port 5432 or via Docker
- **LiveKit Server:** (Optional for local calls, [LiveKit CLI](https://docs.livekit.io/home/cli/cli-setup/))

### 1. Clone the Repository

```bash
git clone https://github.com/your-username/concord.git
cd concord
```

### 2. Configure and Start Backend

```bash
cd concord

# Copy environment example file
cp .env.example .env

# Configure .env with your PostgreSQL connection string:
# DATABASE_URL=postgres://concord:concord@127.0.0.1:5432/concord?sslmode=disable
# JWT_SECRET=your_random_secret_key_here

# Download modules and start server (migrations run automatically on boot)
go run cmd/server/main.go
```

_The Go backend will be listening on `http://127.0.0.1:8080`._

### 3. Start Desktop Client

Open a second terminal:

```bash
cd concord-client

# Install frontend dependencies
npm install

# Start Concord in development mode (hot-reload enabled)
npm run tauri dev
```

### 4. Build Production Installers

To generate final Windows executables (`.exe` and `.msi`):

```bash
cd concord-client
npm run tauri build
```

_The generated installers will be saved in `concord-client/src-tauri/target/release/bundle/`._

---

## 🌐 Self-Hosting Guide (Production Deploy)

Want to host Concord for your friends on your own server (cloud VPS)? The repository already comes with Docker Compose orchestration ready out of the box.

### Recommended Infrastructure

- **Server:** 2 vCPUs, 4GB RAM (e.g., Oracle Cloud Always Free, Hetzner, DigitalOcean, or Linode).
- **Operating System:** Ubuntu 22.04 LTS / 24.04 LTS or Debian 12.
- **Firewall Ports Open:**
  - `80/TCP` and `443/TCP` (Caddy HTTP/HTTPS)
  - `7880/TCP` (LiveKit API)
  - `50000-50100/UDP` (WebRTC Voice & Video traffic)

### Deploy with Docker Compose

1. On your server, clone the repository:

   ```bash
   git clone https://github.com/your-username/concord.git
   cd concord/deploy
   ```

2. Configure your environment variables:

   ```bash
   cp .env.example .env
   # Define your domain (e.g., concord.yourdomain.com), database credentials, and LiveKit secrets
   ```

3. Start the containers:
   ```bash
   docker compose up -d --build
   ```

Caddy will automatically handle obtaining and renewing Let's Encrypt SSL/TLS certificates for your domain, and your server will be live!

---

## 🤝 How to Contribute

Concord thrives with the contributions of developers, designers, and advocates for digital freedom.

1. **Fork the Repository:** Click `Fork` at the top of this GitHub page.
2. **Create a Feature Branch:**
   ```bash
   git checkout -b feature/my-improvement
   ```
3. **Commit Your Changes:**
   ```bash
   git commit -m "feat: add shortcut to mute voice input"
   ```
4. **Push to Your Branch:**
   ```bash
   git push origin feature/my-improvement
   ```
5. **Open a Pull Request:** Explain the rationale behind the change, the tests performed, and the impact on architecture.

Please ensure code consistency, avoid adding third-party tracking libraries, and verify tests pass (`go test ./...` and `npm run build`).

---

## ⚖️ License

This project is distributed under the permissive **[MIT License](LICENSE)**.

You have full freedom to use, study, clone, modify, self-host, and distribute the code with minimal bureaucracy, provided the original copyright and permission notices are preserved.

---

## 📜 Legal and Intellectual Property Notice

- **One Piece Reference:** The use of the Straw Hat Pirates flag is a cultural and philosophical tribute intended symbolically to celebrate digital freedom and peer-to-peer cooperation. This project holds **no** official affiliation, endorsement, or commercial relationship with Eiichiro Oda, Shueisha, Toei Animation, or their affiliates.
- **Discord Reference:** _Discord_ is a registered trademark of Discord Inc. Concord is independent, clean-room software created for educational and private community purposes, with no affiliation with or endorsement by Discord Inc.

---

## ⚓ Closing Words

> _Tools can be banned. Servers can be blocked. Platforms can become corrupted._  
> _But knowledge shared freely among people is indestructible._  
> **_Set the sails, build your own tools, and never ask for permission to communicate._**

<p align="center">
  <img src="docs/assets/strawhat_flag.svg" alt="Jolly Roger Vector" width="180" />
</p>
<p align="center">
  <strong>Concord — Freedom to Communicate.</strong>
</p>
