"""Voice-enabled Copilot Web App - Flask Backend"""
import os
import io
import wave
import tempfile
import asyncio
from pathlib import Path

from flask import Flask, request, jsonify, send_file, render_template
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})  # Allow all origins for API routes

# Paths for models
MODELS_DIR = Path(__file__).parent / "models"
WHISPER_MODEL = "base"
PIPER_MODEL_PATH = MODELS_DIR / "en_US-amy-medium.onnx"
PIPER_CONFIG_PATH = MODELS_DIR / "en_US-amy-medium.onnx.json"

# Lazy-loaded models
_whisper_model = None
_piper_voice = None
_copilot_client = None
_copilot_session = None


def get_whisper_model():
    """Lazy load faster-whisper model"""
    global _whisper_model
    if _whisper_model is None:
        from faster_whisper import WhisperModel
        _whisper_model = WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8")
        print(f"Loaded Whisper model: {WHISPER_MODEL}")
    return _whisper_model


def get_tts_engine():
    """Get TTS engine - uses pyttsx3 which works on Windows without extra deps"""
    global _piper_voice
    if _piper_voice is None:
        import pyttsx3
        _piper_voice = pyttsx3.init()
        _piper_voice.setProperty('rate', 175)  # Speed
        _piper_voice.setProperty('volume', 0.9)
        print("Loaded pyttsx3 TTS engine")
    return _piper_voice


async def get_copilot_session():
    """Get or create Copilot session for multi-turn conversations"""
    global _copilot_client, _copilot_session
    if _copilot_client is None:
        from copilot import CopilotClient
        _copilot_client = CopilotClient()
        await _copilot_client.start()
    if _copilot_session is None:
        _copilot_session = await _copilot_client.create_session({
            "model": "gpt-4",
            "streaming": False,
            "working_directory": "C:\\SOC",  # Set working directory to parent
            "allow_file_access": True,
            "allow_shell_access": True
        })
    return _copilot_session


@app.route("/")
def index():
    """Serve the main page"""
    return render_template("index.html")


@app.route("/api/transcribe", methods=["POST"])
def transcribe():
    """Transcribe audio to text using faster-whisper"""
    if "audio" not in request.files:
        return jsonify({"error": "No audio file provided"}), 400
    
    audio_file = request.files["audio"]
    
    # Save to temp file for processing
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        audio_file.save(tmp.name)
        tmp_path = tmp.name
    
    try:
        model = get_whisper_model()
        segments, info = model.transcribe(tmp_path, beam_size=5)
        text = " ".join([segment.text for segment in segments]).strip()
        
        # Check for stop command
        stop_detected = any(word in text.lower() for word in ["stop", "done", "finish", "end"])
        
        return jsonify({
            "text": text,
            "language": info.language,
            "stop_detected": stop_detected
        })
    finally:
        os.unlink(tmp_path)


@app.route("/api/speak", methods=["POST"])
def speak():
    """Convert text to speech using pyttsx3 and return as WAV"""
    data = request.get_json()
    if not data or "text" not in data:
        return jsonify({"error": "No text provided"}), 400
    
    text = data["text"]
    
    try:
        import pyttsx3
        engine = pyttsx3.init()
        engine.setProperty('rate', 175)
        
        # Save to temp file and return
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp_path = tmp.name
        
        engine.save_to_file(text, tmp_path)
        engine.runAndWait()
        
        # Read and return the file
        with open(tmp_path, 'rb') as f:
            wav_data = f.read()
        os.unlink(tmp_path)
        
        return send_file(io.BytesIO(wav_data), mimetype="audio/wav")
    except Exception as e:
        return jsonify({"error": str(e), "use_browser_tts": True}), 500


import threading

# Single persistent event loop running in background thread
_loop = None
_loop_thread = None

def get_or_create_loop():
    """Get the persistent event loop, creating it if needed"""
    global _loop, _loop_thread
    
    if _loop is None or _loop.is_closed():
        _loop = asyncio.new_event_loop()
        
        def run_loop():
            asyncio.set_event_loop(_loop)
            _loop.run_forever()
        
        _loop_thread = threading.Thread(target=run_loop, daemon=True)
        _loop_thread.start()
    
    return _loop


def run_async(coro, timeout=300):
    """Run an async coroutine on the persistent loop
    
    Args:
        coro: The coroutine to run
        timeout: Timeout in seconds (default 300 = 5 minutes)
    """
    loop = get_or_create_loop()
    future = asyncio.run_coroutine_threadsafe(coro, loop)
    return future.result(timeout=timeout)  # 5 minute default timeout


@app.route("/api/chat", methods=["POST"])
def chat():
    """Send message to Copilot and get response"""
    global _copilot_client, _copilot_session
    
    data = request.get_json()
    if not data or "message" not in data:
        return jsonify({"error": "No message provided"}), 400
    
    message = data["message"]
    timeout = data.get("timeout", 300)  # Default 5 minutes, can be extended
    print(f"[CHAT] Received message: {message[:50]}... (timeout: {timeout}s)")
    
    try:
        # Add context about file system access
        enhanced_message = message
        if any(word in message.lower() for word in ['file', 'folder', 'directory', 'drive', 'read', 'write', 'list', 'access']):
            enhanced_message = f"[Context: You have full access to the file system. Working directory is C:\\SOC. You can read, write, and list files.]\n\n{message}"
        
        async def process_message():
            global _copilot_client, _copilot_session
            
            # Create client if needed
            if _copilot_client is None:
                print("[CHAT] Creating new Copilot client...")
                from copilot import CopilotClient
                _copilot_client = CopilotClient()
                await _copilot_client.start()
                print("[CHAT] Client started")
            
            # Create session if needed
            if _copilot_session is None:
                print("[CHAT] Creating new session...")
                _copilot_session = await _copilot_client.create_session({
                    "model": "gpt-4",
                    "streaming": False
                })
                print("[CHAT] Session created")
            
            print("[CHAT] Sending message to Copilot...")
            response = await _copilot_session.send_and_wait({"prompt": enhanced_message})
            print(f"[CHAT] Got response type: {type(response)}")
            
            # Handle SessionEvent response type
            if hasattr(response, 'data') and hasattr(response.data, 'content'):
                return response.data.content
            elif hasattr(response, 'content'):
                return response.content
            elif hasattr(response, 'text'):
                return response.text
            elif isinstance(response, str):
                return response
            else:
                return str(response)
        
        response_text = run_async(process_message(), timeout=timeout)
        
        print(f"[CHAT] Response: {response_text[:100]}...")
        
        voice_text = generate_voice_status(response_text)
        print(f"[CHAT] Voice text: {voice_text[:100]}...")
        
        return jsonify({
            "response": response_text,
            "voice_status": voice_text
        })
    except TimeoutError:
        print(f"[CHAT] TIMEOUT after {timeout}s")
        return jsonify({
            "error": "timeout",
            "message": f"Request timed out after {timeout // 60} minutes. Would you like to keep waiting?",
            "can_extend": True
        }), 408
    except Exception as e:
        import traceback
        print(f"[CHAT] ERROR: {type(e).__name__}: {e}")
        traceback.print_exc()
        
        # Reset client/session on error so next request starts fresh
        _copilot_client = None
        _copilot_session = None
        
        fallback_response = f"I received your message: '{message[:50]}...'. The Copilot SDK encountered an error: {type(e).__name__}"
        return jsonify({
            "response": fallback_response,
            "voice_status": f"Error occurred: {type(e).__name__}. Please try again."
        })


def generate_voice_status(response: str) -> str:
    """Clean up response for TTS - remove markdown but keep full content"""
    if not response:
        return response
    
    # Remove markdown formatting that TTS can't pronounce well
    cleaned = response
    
    # Remove markdown bold/italic
    cleaned = cleaned.replace('**', '')
    cleaned = cleaned.replace('*', '')
    cleaned = cleaned.replace('__', '')
    cleaned = cleaned.replace('_', ' ')
    
    # Remove markdown headers
    import re
    cleaned = re.sub(r'^#+\s*', '', cleaned, flags=re.MULTILINE)
    
    # Remove markdown links [text](url) -> text
    cleaned = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', cleaned)
    
    # Remove code blocks
    cleaned = re.sub(r'```[^`]*```', '', cleaned, flags=re.DOTALL)
    cleaned = re.sub(r'`([^`]+)`', r'\1', cleaned)
    
    # Remove bullet points
    cleaned = re.sub(r'^\s*[-•]\s*', '', cleaned, flags=re.MULTILINE)
    cleaned = re.sub(r'^\s*\d+\.\s*', '', cleaned, flags=re.MULTILINE)
    
    # Clean up extra whitespace
    cleaned = re.sub(r'\n+', '. ', cleaned)
    cleaned = re.sub(r'\s+', ' ', cleaned)
    cleaned = cleaned.strip()
    
    # If still very long (over 500 chars), summarize to first few sentences
    if len(cleaned) > 500:
        sentences = cleaned.split('. ')
        cleaned = '. '.join(sentences[:3]) + '.'
    
    return cleaned


@app.route("/api/health")
def health():
    """Health check endpoint"""
    return jsonify({
        "status": "ok",
        "whisper_model": WHISPER_MODEL,
        "piper_model": PIPER_MODEL_PATH.name if PIPER_MODEL_PATH.exists() else "not installed"
    })


if __name__ == "__main__":
    print("Starting Voice Copilot Server...")
    print(f"Models directory: {MODELS_DIR}")
    app.run(debug=True, host="0.0.0.0", port=5000)
