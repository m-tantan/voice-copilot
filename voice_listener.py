"""voice_listener.py - Offline wake word listener for Copilot CLI.

Runs in background, listens for "Coco", records your command,
transcribes it offline via faster-whisper, and types it into the
focused terminal window.

Usage:
    python voice_listener.py          # Start listening
    python voice_listener.py --test   # Test mic + transcription

Requires: sounddevice, numpy, faster-whisper, pyperclip, keyboard
"""
import sys
import time
import wave
import tempfile
import threading
import os
import io
from pathlib import Path

# Force UTF-8 output for detached/background mode
if sys.stdout.encoding != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

import numpy as np
import sounddevice as sd
import pyperclip
import keyboard

# --- Config ---
WAKE_WORD = "coco"
DISPATCH_WORDS = ["fire"]
NATIVE_RATE = None           # Auto-detect from mic (set in main_loop)
WHISPER_RATE = 16000         # Whisper expects 16kHz
CHANNELS = 1
CHUNK_DURATION = 2.0        # seconds per wake word detection chunk
SILENCE_THRESHOLD = 300      # RMS amplitude below which is "silence"
SILENCE_TIMEOUT = 20         # seconds of silence before stopping recording
MAX_RECORD_DURATION = 30     # max seconds for a single utterance
WHISPER_MODEL = "small"      # "small" is much more accurate than "base" (~2x slower but worth it)
MODELS_DIR = Path(__file__).parent / "models"
SOUNDS_DIR = Path(__file__).parent / "static"

# --- State ---
_whisper_model = None
_listening = True


def play_sound(name: str):
    """Play a unique chime using winsound.Beep (distinct from Windows notifications)."""
    try:
        import winsound
        if name == "ting":
            # Two quick ascending tones — unique "Coco heard you" chime
            winsound.Beep(800, 80)
            winsound.Beep(1200, 120)
        elif name == "done":
            # Single low tone — "recording stopped"
            winsound.Beep(600, 150)
        print(f"[COCO] 🔔 {name}")
    except Exception as e:
        print(f"[COCO] ⚠️  Sound error: {e}")


def get_whisper():
    """Lazy-load faster-whisper model (shared with Voice Copilot server)."""
    global _whisper_model
    if _whisper_model is None:
        from faster_whisper import WhisperModel
        print(f"[COCO] Loading Whisper model '{WHISPER_MODEL}'...")
        _whisper_model = WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8")
        print("[COCO] Model loaded.")
    return _whisper_model


def rms(audio: np.ndarray) -> float:
    """Root mean square of audio signal."""
    return float(np.sqrt(np.mean(audio.astype(np.float64) ** 2)))


def resample_to_16k(audio: np.ndarray, orig_rate: int) -> np.ndarray:
    """Resample audio from native rate to 16kHz for Whisper."""
    if orig_rate == WHISPER_RATE:
        return audio
    # Simple linear interpolation resampling
    duration = len(audio) / orig_rate
    target_len = int(duration * WHISPER_RATE)
    indices = np.linspace(0, len(audio) - 1, target_len)
    return np.interp(indices, np.arange(len(audio)), audio.astype(np.float64)).astype(np.int16)


def record_chunk(duration: float) -> np.ndarray:
    """Record at native mic rate for best quality."""
    rate = NATIVE_RATE or 44100
    audio = sd.rec(int(duration * rate), samplerate=rate,
                   channels=CHANNELS, dtype='int16')
    sd.wait()
    return audio.flatten()


def save_wav(audio: np.ndarray, path: str):
    """Save int16 audio array to WAV file (always at 16kHz for Whisper)."""
    with wave.open(path, 'wb') as wf:
        wf.setnchannels(CHANNELS)
        wf.setsampwidth(2)  # int16 = 2 bytes
        wf.setframerate(WHISPER_RATE)
        wf.writeframes(audio.tobytes())


def transcribe(audio: np.ndarray, beam_size: int = 1) -> str:
    """Transcribe audio using faster-whisper. Passes numpy array directly."""
    start = time.time()
    rate = NATIVE_RATE or 44100
    duration_s = len(audio) / rate

    # Resample to 16kHz and convert to float32 [-1, 1] for direct numpy input
    audio_16k = resample_to_16k(audio, rate)
    audio_float = audio_16k.astype(np.float32) / 32768.0

    model = get_whisper()
    segments, _ = model.transcribe(audio_float, beam_size=beam_size,
                                   language="en", vad_filter=True)
    text = " ".join(s.text for s in segments).strip()
    elapsed = time.time() - start
    print(f"[COCO] 📊 {duration_s:.1f}s → {elapsed:.2f}s (beam={beam_size}) → \"{text[:80]}\"")
    return text


def detect_wake_word(audio: np.ndarray) -> bool:
    """Check if audio chunk contains the wake word."""
    level = rms(audio)
    # Skip silent chunks
    if level < SILENCE_THRESHOLD:
        return False
    print(f"[COCO] 🔊 rms={level:.0f} — transcribing chunk...")
    text = transcribe(audio, beam_size=1).lower()
    if text:
        has_wake = WAKE_WORD in text
        marker = "🥥 WAKE!" if has_wake else "  "
        print(f"[COCO] 👂 heard: \"{text}\" {marker}")
        return has_wake
    else:
        print(f"[COCO] 👂 heard: (nothing)")
        return False


def record_utterance() -> str:
    """Sliding window streaming: re-transcribes the last ~8s each cycle for full context.
    
    Unlike isolated chunk transcription, this gives Whisper full sentence context
    so words at boundaries are never lost. The window slides forward as audio grows.
    """
    print("[COCO] 🎙️  Streaming... (say \"fire\" to submit)")
    
    rate = NATIVE_RATE or 44100
    max_window_s = 8.0      # sliding window size in seconds
    max_window_samples = int(max_window_s * rate)
    chunk_lock = threading.Lock()
    current_chunk = []      # Accumulates audio blocks between cycles
    
    def audio_callback(indata, frames, time_info, status):
        if status:
            print(f"[COCO] ⚠️  {status}")
        with chunk_lock:
            current_chunk.append(indata[:, 0].copy())
    
    stream = sd.InputStream(samplerate=rate, channels=CHANNELS, dtype='int16',
                           blocksize=int(rate * 0.25), callback=audio_callback)
    stream.start()
    
    audio_buffer = np.array([], dtype=np.int16)  # Rolling audio window
    committed_text = ""     # Text already typed (won't be revised)
    pending_text = ""       # Latest transcription (may be revised next cycle)
    typed_len = 0           # How many chars typed into terminal
    start_time = time.time()
    chunk_num = 0
    stable_count = 0        # How many cycles pending_text stayed the same
    
    try:
        while True:
            time.sleep(2.0)
            chunk_num += 1
            elapsed = time.time() - start_time
            
            # Grab new audio
            with chunk_lock:
                if not current_chunk:
                    continue
                new_audio = np.concatenate(current_chunk)
                current_chunk.clear()
            
            # Append to rolling buffer
            audio_buffer = np.concatenate([audio_buffer, new_audio])
            
            # Trim to sliding window (keep latest ~8s)
            if len(audio_buffer) > max_window_samples:
                audio_buffer = audio_buffer[-max_window_samples:]
            
            level = rms(new_audio)
            if level < SILENCE_THRESHOLD:
                continue
            
            # Re-transcribe the full window — Whisper gets full sentence context
            text = transcribe(audio_buffer, beam_size=1).strip()
            
            if not text:
                continue
            
            print(f"[COCO] 💬 #{chunk_num}: \"{text}\"")
            
            # Check for dispatch word — last word only
            words = text.rstrip('.,!? ').split()
            last_word = words[-1].lower().strip('.,!? ') if words else ""
            dispatched = last_word in DISPATCH_WORDS
            
            if dispatched:
                clean_text = " ".join(words[:-1]).strip()
            else:
                clean_text = text
            
            # Build full prompt: committed (stable) + new from this window
            # The window transcription covers everything since the last commit
            full_prompt = (committed_text + " " + clean_text).strip() if committed_text else clean_text
            
            print(f"[COCO] 📝 Prompt: \"{full_prompt}\"")
            
            # Check if pending text stabilized (same for 2+ cycles = commit it)
            if clean_text == pending_text and clean_text:
                stable_count += 1
                if stable_count >= 2:
                    # Commit this text — it won't be revised anymore
                    committed_text = full_prompt
                    audio_buffer = np.array([], dtype=np.int16)  # Reset window
                    pending_text = ""
                    stable_count = 0
                    print(f"[COCO] ✅ Committed: \"{committed_text}\"")
            else:
                pending_text = clean_text
                stable_count = 0
            
            # Type new characters into terminal via clipboard (reliable, no dropped keys)
            if len(full_prompt) > typed_len:
                new_chars = full_prompt[typed_len:]
                pyperclip.copy(new_chars)
                time.sleep(0.05)
                keyboard.press('ctrl')
                time.sleep(0.03)
                keyboard.press_and_release('v')
                time.sleep(0.03)
                keyboard.release('ctrl')
                typed_len = len(full_prompt)
            
            if dispatched:
                print(f"[COCO] 🚀 Dispatch!")
                play_sound("done")
                time.sleep(0.1)
                keyboard.press_and_release('enter')
                return full_prompt
            
            if elapsed >= MAX_RECORD_DURATION:
                print("[COCO] ⏱️  Max duration, auto-submitting.")
                play_sound("done")
                keyboard.press_and_release('enter')
                return full_prompt
    
    finally:
        stream.stop()
        stream.close()
    
    return committed_text or pending_text


def type_into_terminal(text: str, submit: bool = True):
    """Paste text into the focused terminal. If submit=True, also press Enter."""
    print(f"[COCO] ⌨️  Pasting: \"{text[:80]}\"" + (" + Enter" if submit else ""))
    pyperclip.copy(text)
    time.sleep(0.1)
    keyboard.press('ctrl')
    time.sleep(0.05)
    keyboard.press_and_release('v')
    time.sleep(0.05)
    keyboard.release('ctrl')
    if submit:
        time.sleep(0.2)
        keyboard.press_and_release('enter')


def clear_terminal_input():
    """Select all text in the input and delete it (Ctrl+A then Delete)."""
    keyboard.press('ctrl')
    time.sleep(0.05)
    keyboard.press_and_release('a')
    time.sleep(0.05)
    keyboard.release('ctrl')
    time.sleep(0.05)
    keyboard.press_and_release('backspace')
    time.sleep(0.1)


def main_loop():
    """Main wake word detection loop."""
    global _listening, NATIVE_RATE

    # Auto-detect mic sample rate
    info = sd.query_devices(kind='input')
    NATIVE_RATE = int(info['default_samplerate'])

    dispatch_display = " / ".join(f'"{w}"' for w in DISPATCH_WORDS)

    C = "\033[36m"    # cyan
    G = "\033[32m"    # green
    Y = "\033[33m"    # yellow
    D = "\033[2m"     # dim
    B = "\033[1m"     # bold
    R = "\033[0m"     # reset

    print()
    print(f"{C}        ██████╗  ██████╗  ██████╗  ██████╗ ")
    print(f"       ██╔════╝ ██╔═══██╗██╔════╝ ██╔═══██╗")
    print(f"       ██║      ██║   ██║██║      ██║   ██║")
    print(f"       ██║      ██║   ██║██║      ██║   ██║")
    print(f"       ╚██████╗ ╚██████╔╝╚██████╗ ╚██████╔╝")
    print(f"        ╚═════╝  ╚═════╝  ╚═════╝  ╚═════╝ {R}")
    print(f"{D}        Offline Voice Assistant for Copilot CLI{R}")
    print()
    print(f"  {G}●{R} Wake word     {B}\"Coco\"{R}")
    print(f"  {G}●{R} Dispatch      {B}{dispatch_display}{R}")
    print(f"  {G}●{R} Mic           {info['name']} @ {NATIVE_RATE}Hz")
    print(f"  {G}●{R} Model         whisper-{WHISPER_MODEL}")
    print()
    print(f"  {Y}Say \"Coco\" → speak your prompt → \"fire\" to submit{R}")
    print(f"  {D}Ctrl+C to stop{R}")
    print()

    # Pre-load model
    get_whisper()
    print(f"  {G}●{R} Ready — listening for wake word...")

    while _listening:
        try:
            # Record a 2-second chunk
            chunk = record_chunk(CHUNK_DURATION)

            # Check for wake word
            if detect_wake_word(chunk):
                print(f"\n[COCO] 🥥 Wake word detected!")
                play_sound("ting")

                # Live-transcribe until dispatch word (typing + enter handled inside)
                prompt = record_utterance()

                if prompt and prompt.strip():
                    print(f"[COCO] ✅ Sent: \"{prompt}\"")
                else:
                    print("[COCO] ❌ No speech captured.")

                # Cooldown to prevent re-triggering on echo
                print("[COCO] 💤 Cooldown 2s...")
                time.sleep(2)
                print("[COCO] ✅ Listening for wake word...")

        except KeyboardInterrupt:
            break
        except Exception as e:
            print(f"[COCO] ⚠️  Error: {e}")
            time.sleep(1)

    print("\n[COCO] 👋 Stopped.")


def test_mode():
    """Quick test: record 3 seconds and transcribe."""
    print("[TEST] Recording 3 seconds...")
    audio = record_chunk(3.0)
    print(f"[TEST] RMS level: {rms(audio):.0f}")
    print("[TEST] Transcribing...")
    text = transcribe(audio, beam_size=5)
    print(f"[TEST] Result: \"{text}\"")


if __name__ == "__main__":
    if "--test" in sys.argv:
        test_mode()
    else:
        main_loop()
