# Agent Instructions

## Project Overview
Voice-enabled web app: Flask backend + vanilla JS frontend for hands-free Copilot interactions.

## Stack
- **Backend**: Flask (app.py, port 5000)
- **STT**: faster-whisper (Whisper base model)
- **TTS**: pyttsx3 (Windows SAPI)
- **AI**: github-copilot-sdk with persistent sessions

## Key Files
- `app.py` - All backend routes (/api/transcribe, /api/speak, /api/chat, /api/health)
- `static/app.js` - Frontend JS with Web Audio API
- `templates/index.html` - UI template

## Dev Commands
```bash
# Activate venv
.\.venv\Scripts\Activate.ps1

# Run server
python app.py

# Run tests (server must be running)
pytest test_app.py -v
```

## Architecture Notes
- Async Copilot calls run on a persistent background event loop (threading + asyncio)
- Models lazy-load on first request
- TTS falls back to browser speech if pyttsx3 fails

## Voice Mode (Copilot CLI)
When the user says "voice mode on" or "enable voice mode", activate voice mode for the session:
- After EVERY response, run: `python C:\SOC\mobile\speak.py --clean "your spoken summary here"`
- The summary should be a CONVERSATIONAL version of your response — as if you're explaining it to someone who can't see the screen
- Include WHAT you did, WHAT the result was, and any next steps
- Don't mention file paths, code syntax, or markdown — the --clean flag strips those anyway
- Keep it under 3 sentences for simple answers, up to 5 for complex ones
- When the user says "voice mode off" or "disable voice mode", stop calling speak.py
- The wake word for voice input is "Coco" — the background listener (`voice_listener.py`) handles this

## When Editing
- Keep voice processing local (privacy-first)
- Maintain multi-turn session state in `_copilot_session`
- Test with `pytest test_app.py` after changes
