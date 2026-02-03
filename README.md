# 🎙️ Voice Copilot

A Python-based web application for multi-turn voice interactions with the GitHub Copilot SDK.

## Features

- **Voice Recording**: Hold button to record, or use wake words ("Copilot", "GitHub")
- **Wake Word Detection**: Continuous listening via Web Speech API
- **Stop Commands**: Say "stop", "done", "finish" to end recording
- **Local STT**: Speech-to-text using faster-whisper (Whisper base model)
- **Local TTS**: Text-to-speech using pyttsx3 (Windows SAPI)
- **Multi-turn Conversations**: Persistent sessions with Copilot SDK
- **Privacy-first**: All voice processing done locally

## Quick Start

```bash
# Navigate to the project
cd mobile

# Activate virtual environment
.\.venv\Scripts\Activate.ps1  # Windows
# source .venv/bin/activate   # Linux/Mac

# Start the server
python app.py
```

Then open http://localhost:5000 in your browser.

## Usage

1. **Button Recording**: Hold the microphone button to record, release to process
2. **Wake Words**: Say "Copilot" or "GitHub" to start recording hands-free
3. **Stop Recording**: Say "stop", "done", or "finish" to end recording
4. **Text Input**: Type directly in the chat box and press Enter or click Send
5. **Voice + Edit**: After voice transcription, you have 2 seconds to edit before auto-send

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Main web interface |
| `/api/transcribe` | POST | Transcribe audio to text (multipart/form-data) |
| `/api/speak` | POST | Convert text to speech (JSON) |
| `/api/chat` | POST | Send message to Copilot (JSON) |
| `/api/health` | GET | Health check |

## Tech Stack

- **Backend**: Flask
- **STT**: faster-whisper (Whisper base model, ~150MB)
- **TTS**: pyttsx3 (Windows SAPI voices)
- **Copilot**: github-copilot-sdk
- **Frontend**: Vanilla JS with Web Audio API & Web Speech API

## Running Tests

```bash
# Install test dependencies
pip install pytest pytest-playwright
playwright install chromium

# Run tests (server must be running)
pytest test_app.py -v
```

## Project Structure

```
mobile/
├── app.py              # Flask backend
├── requirements.txt    # Python dependencies
├── test_app.py         # Playwright tests
├── models/             # Voice models (auto-downloaded)
├── static/
│   ├── app.js          # Frontend JavaScript
│   └── style.css       # Styles
└── templates/
    └── index.html      # Main page
```

## Browser Support

- **Chrome/Edge**: Full support (Web Speech API + Web Audio)
- **Firefox**: Recording works, wake word detection limited
- **Safari**: May require permissions prompt

## License

MIT
