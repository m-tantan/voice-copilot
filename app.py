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


# Persistent event loop for async operations
_event_loop = None

def get_event_loop():
    """Get or create a persistent event loop for Copilot SDK"""
    global _event_loop
    if _event_loop is None or _event_loop.is_closed():
        _event_loop = asyncio.new_event_loop()
        asyncio.set_event_loop(_event_loop)
    return _event_loop


@app.route("/api/chat", methods=["POST"])
def chat():
    """Send message to Copilot and get response"""
    data = request.get_json()
    if not data or "message" not in data:
        return jsonify({"error": "No message provided"}), 400
    
    message = data["message"]
    
    try:
        # Use persistent event loop for Copilot SDK
        loop = get_event_loop()
        
        # Add context about file system access
        enhanced_message = message
        if any(word in message.lower() for word in ['file', 'folder', 'directory', 'drive', 'read', 'write', 'list', 'access']):
            enhanced_message = f"[Context: You have full access to the file system. Working directory is C:\\SOC. You can read, write, and list files.]\n\n{message}"
        
        async def process_message():
            session = await get_copilot_session()
            response = await session.send_and_wait({"prompt": enhanced_message})
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
        
        response_text = loop.run_until_complete(process_message())
        # Don't close the loop - keep it for subsequent requests
        
        status = generate_voice_status(response_text)
        
        return jsonify({
            "response": response_text,
            "voice_status": status
        })
    except Exception as e:
        # Fallback: echo back with acknowledgment (for demo/testing)
        print(f"Copilot SDK error: {e}")
        fallback_response = f"I received your message: '{message}'. The Copilot SDK connection is not configured. Please ensure you have valid credentials set up."
        return jsonify({
            "response": fallback_response,
            "voice_status": "Message received. Copilot SDK not configured."
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
