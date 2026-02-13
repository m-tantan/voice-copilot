"""speak.py - Offline TTS for Copilot CLI voice mode.

Usage: python speak.py "Text to speak"
       echo "Text to speak" | python speak.py
       python speak.py --clean "Markdown **text** with `code`"
       python speak.py --voice kristin "Use Piper neural voice"
       python speak.py --voice amy "Use Amy neural voice"
       python speak.py --voice zira "Use Windows SAPI voice (fallback)"
"""
import sys
import re
import os
import subprocess
import tempfile
from pathlib import Path

# Piper binary and models directory (relative to this script)
SCRIPT_DIR = Path(__file__).parent
PIPER_EXE = SCRIPT_DIR / "piper" / "piper" / "piper.exe"
PIPER_MODELS_DIR = SCRIPT_DIR / "piper" / "models"
DEFAULT_VOICE = "amy"  # Best neural voice


def clean_for_speech(text: str) -> str:
    """Strip markdown, code blocks, file paths, and technical noise for clear speech."""
    cleaned = text
    # Remove code blocks entirely — don't read code aloud
    cleaned = re.sub(r'```[\s\S]*?```', ' code block omitted. ', cleaned)
    # Remove inline code but keep the word
    cleaned = re.sub(r'`([^`]+)`', r'\1', cleaned)
    # Remove markdown formatting
    cleaned = cleaned.replace('**', '').replace('__', '')
    cleaned = re.sub(r'(?<!\w)\*(?!\s)', '', cleaned)  # italic *
    cleaned = re.sub(r'(?<!\s)\*(?!\w)', '', cleaned)
    # Remove markdown headers
    cleaned = re.sub(r'^#+\s*', '', cleaned, flags=re.MULTILINE)
    # Remove markdown links [text](url) → text
    cleaned = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', cleaned)
    # Remove bullet points
    cleaned = re.sub(r'^\s*[-•]\s*', '', cleaned, flags=re.MULTILINE)
    cleaned = re.sub(r'^\s*\d+\.\s*', '', cleaned, flags=re.MULTILINE)
    # Simplify file paths for speech
    cleaned = re.sub(r'[A-Z]:\\[\w\\.-]+', 'file path', cleaned)
    cleaned = re.sub(r'/[\w/.-]+\.\w+', 'file path', cleaned)
    # Clean up whitespace
    cleaned = re.sub(r'\n+', '. ', cleaned)
    cleaned = re.sub(r'\s+', ' ', cleaned)
    cleaned = re.sub(r'\.\s*\.', '.', cleaned)  # double periods
    return cleaned.strip()


def speak_piper(text: str, voice: str = DEFAULT_VOICE):
    """Speak using Piper neural TTS (much more natural than SAPI)."""
    model_path = PIPER_MODELS_DIR / f"{voice}.onnx"
    if not PIPER_EXE.exists() or not model_path.exists():
        return False

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp_path = tmp.name

    try:
        result = subprocess.run(
            [str(PIPER_EXE), "--model", str(model_path),
             "--length_scale", "0.75", "--sentence_silence", "0.15",
             "--output_file", tmp_path],
            input=text.encode("utf-8"),
            capture_output=True, timeout=30
        )
        if result.returncode != 0:
            return False
        # Play the WAV file synchronously
        import winsound
        winsound.PlaySound(tmp_path, winsound.SND_FILENAME)
    except Exception as e:
        print(f"[speak] Piper error: {e}", file=sys.stderr)
        return False
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
    return True


def speak_sapi(text: str):
    """Speak using pyttsx3 / Windows SAPI (fallback)."""
    import pyttsx3
    engine = pyttsx3.init()
    voices = engine.getProperty('voices')
    for v in voices:
        if 'zira' in v.name.lower():
            engine.setProperty('voice', v.id)
            break
    engine.setProperty('rate', 170)
    engine.setProperty('volume', 1.0)
    engine.say(text)
    engine.runAndWait()
    engine.stop()


def speak(text: str, clean: bool = False, voice: str = DEFAULT_VOICE):
    if not text or not text.strip():
        return
    if clean:
        text = clean_for_speech(text)

    # Try Piper neural voice first, fall back to SAPI
    if voice != "zira" and speak_piper(text, voice):
        return
    speak_sapi(text)


if __name__ == "__main__":
    clean = '--clean' in sys.argv
    # Parse --voice flag
    voice = DEFAULT_VOICE
    args = []
    skip_next = False
    for i, a in enumerate(sys.argv[1:], 1):
        if skip_next:
            skip_next = False
            continue
        if a == '--voice' and i < len(sys.argv) - 1:
            voice = sys.argv[i + 1]
            skip_next = True
        elif a == '--clean':
            continue
        else:
            args.append(a)

    if args:
        speak(" ".join(args), clean=clean, voice=voice)
    elif not sys.stdin.isatty():
        speak(sys.stdin.read(), clean=clean, voice=voice)
    else:
        print("Usage: python speak.py [--clean] [--voice kristin|amy|zira] 'text'")
        print(f"\nAvailable Piper voices in {PIPER_MODELS_DIR}:")
        if PIPER_MODELS_DIR.exists():
            for f in PIPER_MODELS_DIR.glob("*.onnx"):
                print(f"  - {f.stem}")
        print("  - zira (Windows SAPI fallback)")
