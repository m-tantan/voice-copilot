# 🎙️ Voice Copilot

A Python-based web application for multi-turn voice interactions with the GitHub Copilot SDK. **Built 100% hands-free using voice commands while driving.**

## Features

- **Voice Recording**: Hold button to record, or use wake words ("GitHub")
- **Wake Word Detection**: Say "GitHub" to start recording hands-free
- **Stop Commands**: Say "stop", "done", "finish" to end recording, or click the button
- **Local STT**: Speech-to-text using faster-whisper (Whisper base model)
- **Local TTS**: Text-to-speech using pyttsx3 (Windows SAPI)
- **Multi-turn Conversations**: Persistent sessions with Copilot SDK
- **File System Access**: Copilot can read/write files in your project
- **Health Monitoring**: Visual indicator shows server and mic status
- **Privacy-first**: All voice processing done locally

## Quick Start

### 1. Clone the repository
```bash
git clone https://github.com/m-tantan/voice-copilot.git
cd voice-copilot
```

### 2. Create and activate virtual environment
```bash
# Windows
python -m venv .venv
.\.venv\Scripts\Activate.ps1

# Linux/Mac
python3 -m venv .venv
source .venv/bin/activate
```

### 3. Install dependencies
```bash
pip install -r requirements.txt
```

### 4. Download the Whisper model (first run only)
The model (~150MB) downloads automatically on first use.

### 5. Start the server
```bash
python app.py
```

### 6. Open in browser
Navigate to **http://localhost:5000**

## Usage

1. **Wake Word**: Say **"GitHub"** to start recording hands-free
2. **Button Recording**: Hold the microphone button to record, release to stop
3. **Stop Recording**: Say "stop", "done", or "finish" - or click the button
4. **Text Input**: Type directly in the chat box and press Enter
5. **Auto-send**: After voice transcription, you have 2 seconds to edit before auto-send

## Health Indicator

The footer shows connection status:
- 🟢 **Green**: Server online, mic working - "Ready • Say GitHub to start"
- 🟡 **Yellow**: Server online, mic permission needed
- 🔴 **Red**: Server offline - run `python app.py`

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Main web interface |
| `/api/transcribe` | POST | Transcribe audio to text |
| `/api/speak` | POST | Convert text to speech |
| `/api/chat` | POST | Send message to Copilot |
| `/api/health` | GET | Health check |

## Tech Stack

- **Backend**: Flask + Python 3.9+
- **STT**: faster-whisper (Whisper base model)
- **TTS**: pyttsx3 (Windows SAPI voices)
- **AI**: github-copilot-sdk
- **Frontend**: Vanilla JS with Web Audio API & Web Speech API

## Project Structure

```
voice-copilot/
├── app.py              # Flask backend
├── requirements.txt    # Python dependencies
├── test_app.py         # Playwright tests
├── LICENSE             # MIT License
├── models/             # Voice models (downloaded on first run)
├── static/
│   ├── app.js          # Frontend JavaScript
│   └── style.css       # Styles
└── templates/
    └── index.html      # Main page
```

## Running Tests

```bash
pip install pytest pytest-playwright
playwright install chromium
pytest test_app.py -v  # Server must be running
```

## Browser Support

- **Chrome/Edge**: Full support (recommended)
- **Firefox**: Recording works, wake word detection limited
- **Safari**: May require permissions prompt

## License

MIT
