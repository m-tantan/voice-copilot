"""speak.py - Offline TTS for Copilot CLI voice mode.

Usage: python speak.py "Text to speak"
       echo "Text to speak" | python speak.py
       python speak.py --clean "Markdown **text** with `code`"
"""
import sys
import re
import pyttsx3


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


def speak(text: str, clean: bool = False):
    if not text or not text.strip():
        return
    if clean:
        text = clean_for_speech(text)
    engine = pyttsx3.init()
    # Use Zira (female voice) — clearer for spoken responses
    voices = engine.getProperty('voices')
    for v in voices:
        if 'zira' in v.name.lower():
            engine.setProperty('voice', v.id)
            break
    engine.setProperty('rate', 170)  # Slightly slower for clarity
    engine.setProperty('volume', 1.0)
    engine.say(text)
    engine.runAndWait()
    engine.stop()


if __name__ == "__main__":
    clean = '--clean' in sys.argv
    args = [a for a in sys.argv[1:] if a != '--clean']
    if args:
        speak(" ".join(args), clean=clean)
    elif not sys.stdin.isatty():
        speak(sys.stdin.read(), clean=clean)
    else:
        print("Usage: python speak.py [--clean] 'text to speak'")
