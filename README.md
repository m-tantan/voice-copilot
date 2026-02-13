# 🔥 Coco — Offline Voice Assistant for Copilot CLI

```
        ██████╗  ██████╗  ██████╗  ██████╗
       ██╔════╝ ██╔═══██╗██╔════╝ ██╔═══██╗
       ██║      ██║   ██║██║      ██║   ██║
       ██║      ██║   ██║██║      ██║   ██║
       ╚██████╗ ╚██████╔╝╚██████╗ ╚██████╔╝
        ╚═════╝  ╚═════╝  ╚═════╝  ╚═════╝
```

Talk to GitHub Copilot CLI — completely hands-free and 100% offline. No browser, no cloud STT, no internet required for voice processing.

## How It Works

1. **Say "Coco"** — wake word activates the listener
2. **Speak your prompt** — words appear live in the terminal as you talk
3. **Say "fire"** — dispatches your prompt to Copilot CLI

Coco runs as a background process alongside the Copilot CLI. It listens through your mic, transcribes speech locally with [faster-whisper](https://github.com/SYSTRAN/faster-whisper), and types the result directly into the focused terminal window. Copilot responds, and `speak.py` reads the answer back to you.

## Quick Start

### 1. Clone and set up
```bash
git clone https://github.com/m-tantan/voice-copilot.git
cd voice-copilot

# Windows
python -m venv .venv
.\.venv\Scripts\Activate.ps1

pip install -r requirements.txt
```

### 2. Start Coco
```bash
python voice_listener.py
```

The Whisper model (~500MB for `small`) downloads automatically on first run.

### 3. Open a second terminal and start Copilot CLI
```bash
gh copilot
```

Focus the Copilot CLI terminal, say **"Coco"**, speak your prompt, and say **"fire"** to submit.

## Features

| Feature | Details |
|---------|---------|
| **Wake word** | "Coco" — distinctive repeated hard K sound for reliable detection |
| **Dispatch word** | "fire" — submits the transcribed prompt |
| **Live transcription** | Words appear in the terminal input as you speak (every ~2s) |
| **Offline STT** | faster-whisper with `small` model — no internet needed |
| **Offline TTS** | `speak.py` uses pyttsx3 / Windows SAPI (Zira voice) |
| **Auto sample rate** | Detects your mic's native rate and resamples to 16kHz for Whisper |
| **Audio feedback** | Two-tone beep (800Hz → 1200Hz) confirms wake word detection |

## Project Structure

```
voice-copilot/
├── voice_listener.py   # Coco: wake word + live transcription + dispatch
├── speak.py            # TTS output (pyttsx3, --clean strips markdown)
├── AGENTS.md           # Copilot agent instructions (voice mode config)
├── requirements.txt    # Python dependencies
├── app.py              # Flask backend (optional web UI mode)
├── static/             # Web UI assets (optional)
├── templates/          # Web UI templates (optional)
├── models/             # Whisper models (auto-downloaded)
└── LICENSE             # MIT
```

### Core Files

- **`voice_listener.py`** — The main Coco process. Continuously listens via `sounddevice`, detects the wake word, streams live transcription chunks, and types into the terminal with `keyboard.write()`.
- **`speak.py`** — Called by Copilot CLI to speak responses aloud. Strips markdown, code blocks, and file paths for natural speech. Usage: `python speak.py --clean "Your message here"`

### Optional Web UI

The Flask app (`app.py`) and frontend (`static/`, `templates/`) provide a browser-based voice interface as an alternative to the CLI workflow. Start with `python app.py` and open `http://localhost:5000`.

## Configuration

Edit the constants at the top of `voice_listener.py`:

```python
WAKE_WORD = "coco"           # What activates the listener
DISPATCH_WORDS = ["fire"]    # What submits the prompt
CHUNK_DURATION = 2.0         # Seconds between transcription updates
SILENCE_THRESHOLD = 300      # RMS below this = silence
SILENCE_TIMEOUT = 20         # Seconds of silence before auto-stop
```

## Requirements

- **Python 3.9+** on Windows
- **Microphone** (any; native sample rate auto-detected)
- **faster-whisper** for offline speech-to-text
- **pyttsx3** for offline text-to-speech
- **sounddevice** + **numpy** for audio capture
- **keyboard** for typing into the terminal

## License

MIT
