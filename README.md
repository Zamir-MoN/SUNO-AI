# 🌟 Aetheria // Real-Time Conversational Voice AI & ChatGPT Assistant

> **Production-grade AI Assistant** featuring real-time hands-free Live Voice conversation (interactive 3D neural orb, multi-mic selector, live audio level meter, ultra-low latency streaming), dual persona modes (ChatGPT 4o & Empathic AI Therapist), emotional wellness radar, and local system tool execution.

---

## ✨ Key Features

- 🎙️ **Live Voice Mode (Hands-Free)**:
  - Real-time Web Speech recognition + dual audio channel monitoring.
  - Interactive 3D Canvas dynamic neural glowing aura orb (60 FPS).
  - Hardware microphone selector (`🎙️ Default Mic`) and live visual decibel meter.
  - Natural streaming Text-to-Speech audio replies with barge-in interruption.
- ⚡ **Multi-Engine Intelligence**:
  - **Google Gemini 1.5 / Flash Latest**: Lightning-fast cloud inference with streaming SSE tokens.
  - **Local Ollama Brain (`qwen3:4b-instruct`)**: 100% offline, privacy-first, zero-cost fallback.
  - **OpenAI GPT-4o Mini**: Seamless integration option via settings.
- 🧠 **Psychological Sentiment & Emotion Radar**:
  - Detects anxiety, stress, sadness, anger, joy, and calm.
  - Tailored emotional grounding advice (e.g. 4-7-8 breathing techniques).
- 💻 **Cross-Platform Access**:
  - Modern web application at `http://localhost:3000`.
  - Native Windows desktop HUD (`app_gui.py`).
- 🛠️ **System Action Tools**:
  - Open applications, inspect CPU/RAM performance, and execute PC actions.

---

## 🚀 Quick Start (For Anyone Sharing or Cloning)

### Prerequisites
- **Node.js** (v18 or higher): [Download Node.js](https://nodejs.org/)
- **Python** (v3.10+ optional for desktop HUD): [Download Python](https://www.python.org/)
- *(Optional)* **Ollama** for offline AI: [Download Ollama](https://ollama.ai/)

---

### Step 1: Install Dependencies

Open your terminal in the project folder and run:

```bash
# 1. Install Node.js backend dependencies
npm install

# 2. (Optional) Install Python desktop dependencies
pip install -r requirements.txt
```

---

### Step 2: Configure Environment

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Edit `.env` to customize your settings:
```env
PORT=3000
GEMINI_API_KEY=your_gemini_api_key_here
```
*(Note: You can also paste your API key directly inside the web app's Settings modal at any time).*

---

### Step 3: Run the Project

#### Option A: 1-Click Launch (Windows)
Double-click:
👉 **`start.bat`**

This will automatically start the server and open `http://localhost:3000` in your default browser.

#### Option B: Terminal Launch
```bash
npm start
```
Then visit:
👉 **`http://localhost:3000`**

---

## 📁 Project Architecture

```text
├── server.js               # Node.js + Express + WebSocket streaming server
├── public/                 # Modern web client
│   ├── index.html          # ChatGPT layout + Live Voice overlay + 3D Orb canvas
│   ├── style.css           # Premium dark theme styling + animations + HUD design
│   ├── app.js              # Chat feed controller, SSE stream reader, settings
│   └── voice-live.js       # Live Voice manager, VAD, mic meter, SpeechRecognition loop
├── app_gui.py              # Native desktop GUI interface (Tkinter)
├── assistant.py            # Local assistant logic and brain coordinator
├── tool_dispatcher.py      # System tool execution (apps, CPU/RAM, processes)
├── voice_engine.py         # Local offline TTS / STT pipeline
├── package.json            # Node.js manifest & dependencies
├── requirements.txt        # Python package dependencies
├── .env.example            # Environment variables template
└── README.md               # Documentation & sharing guide
```

---

## 🤝 Contributing & Sharing

1. Fork or clone this repository.
2. Create a new branch: `git checkout -b feature/awesome-feature`
3. Commit your modifications: `git commit -m 'Add awesome feature'`
4. Push to the branch: `git push origin feature/awesome-feature`
5. Open a Pull Request!
