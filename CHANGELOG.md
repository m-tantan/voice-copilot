# Changelog

## [0.3.0] — 2026-02-13 — Coco: CLI-First Voice Assistant

### Added
- **Coco voice listener** (`voice_listener.py`) — standalone offline voice assistant for Copilot CLI
- Wake word detection: say "Coco" to activate
- Live transcription: words appear in terminal input as you speak (~2s updates)
- Dispatch word "fire" submits prompt to Copilot CLI
- Two-tone beep feedback (800Hz → 1200Hz) on wake word detection
- `speak.py` — offline TTS output with pyttsx3 (Windows SAPI, Zira voice)
- `--clean` flag strips markdown, code blocks, and file paths for natural speech
- Colorful ASCII art banner on startup
- Auto sample rate detection and resampling (native → 16kHz for Whisper)
- Direct numpy float32 input to faster-whisper (no temp WAV files)

### Changed
- Upgraded Whisper model from `base` to `small` for better accuracy
- Primary workflow is now CLI-direct (no browser required)
- Web UI (`app.py`) remains as an optional alternative
- Dispatch words simplified to only "fire"

### Removed
- `piper-tts` dependency (broken on Windows, replaced by pyttsx3)
- Stale HTML test files (`wow.html`, `index.html`)

---

## [0.2.0] — 2026-02-12 — Web UI Enhancements

### Added
- Session ID display with long-press to copy
- First-run experience modal
- Auto-retry on session/model errors
- Health check interval reduced to 5 seconds

### Changed
- Stop word restricted to "stop listening"
- Session resets only on fatal errors

---

## [0.1.0] — 2026-02-11 — Initial Release

### Added
- Flask backend with Copilot SDK integration
- Browser-based voice UI with wake word "GitHub"
- Local STT via faster-whisper (Whisper base model)
- Local TTS via pyttsx3
- Multi-turn conversation sessions
- Push-to-talk and wake word recording modes
