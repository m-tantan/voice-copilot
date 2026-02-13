# Agent Instructions

## Project Overview
Coco — offline voice assistant for the GitHub Copilot CLI. Runs as a background listener that types voice-transcribed prompts directly into the terminal.

## Stack
- **Voice Listener**: `voice_listener.py` (sounddevice + faster-whisper, whisper-small)
- **TTS**: `speak.py` (pyttsx3 / Windows SAPI, Zira voice)
- **Optional Web UI**: Flask (`app.py`, port 5000)
- **AI**: GitHub Copilot CLI (talks via typed input in the terminal)

## Key Files
- `voice_listener.py` — Core Coco process: wake word → live transcription → dispatch
- `speak.py` — Offline TTS called after Copilot responds (`--clean` strips markdown)
- `app.py` — Flask backend for optional browser-based UI
- `static/app.js` — Frontend JS (web UI mode only)
- `templates/index.html` — UI template (web UI mode only)

## Dev Commands
```bash
# Activate venv
.\.venv\Scripts\Activate.ps1

# Start Coco (main workflow)
python voice_listener.py

# Start web UI (alternative workflow)
python app.py

# Run tests (server must be running)
pytest test_app.py -v
```

## Architecture Notes
- Coco uses `sd.InputStream` callback to accumulate audio in a thread-safe buffer
- Every ~2s, the latest chunk is grabbed, resampled 44100→16000Hz, and transcribed
- New words are appended to the terminal input via `keyboard.write()`
- Wake word "Coco" detected in transcription output (not a separate model)
- Dispatch word "fire" triggers Enter key to submit the prompt
- Whisper model lazy-loads on first wake detection (~2s, cached after)

## Voice Mode (Copilot CLI)
When the user says "voice mode on" or "enable voice mode", activate voice mode for the session:
- After EVERY response, run: `python C:\SOC\mobile\speak.py --clean "your spoken summary here"`
- The summary should be a CONVERSATIONAL version of your response
- Include WHAT you did, WHAT the result was, and any next steps
- Don't mention file paths, code syntax, or markdown — the --clean flag strips those anyway
- Keep it under 3 sentences for simple answers, up to 5 for complex ones
- When the user says "voice mode off" or "disable voice mode", stop calling speak.py

## When Editing
- Keep all voice processing local (privacy-first, no cloud APIs)
- Coco is the primary workflow; web UI is optional/secondary
- Test voice_listener.py changes by running it and speaking
- Test speak.py changes: `python speak.py --clean "test message"`
