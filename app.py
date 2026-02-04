"""Voice-enabled Copilot Web App - Flask Backend"""
import os
import io
import wave
import tempfile
import asyncio
import uuid
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

# Current working directory (shared state)
_current_working_dir = r"C:\SOC"

# Context usage tracking
_context_stats = {
    "input_tokens": 0,
    "output_tokens": 0,
    "turns": 0,
    "start_time": None,
    "max_tokens": 128000  # GPT-4 context window
}

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
        # Add context about file system access - always include working directory
        enhanced_message = f"[IMPORTANT: The user's current working directory is {_current_working_dir}. When asked about working directory or location, report this path. All file operations should be relative to this directory.]\n\n{message}"
        
        async def process_message(retry_on_session_error=True):
            global _copilot_client, _copilot_session
            
            try:
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
                    # Log session properties for debugging
                    session_id = _copilot_session.session_id if hasattr(_copilot_session, 'session_id') else 'unknown'
                    print(f"[CHAT] *** NEW SESSION CREATED: {session_id} ***")
                
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
            except Exception as e:
                error_msg = str(e).lower()
                error_type = type(e).__name__
                print(f"[CHAT] Exception caught: {error_type}: {e}")
                
                # Only reset on specific connection/session errors, not general errors
                session_error_keywords = ['session expired', 'session not found', 'unauthorized', 'authentication', 'connection refused']
                is_session_error = any(keyword in error_msg for keyword in session_error_keywords)
                
                if retry_on_session_error and is_session_error:
                    print(f"[CHAT] Session error detected, resetting and retrying: {e}")
                    _copilot_client = None
                    _copilot_session = None
                    return await process_message(retry_on_session_error=False)
                raise
        
        response_text = run_async(process_message(), timeout=timeout)
        
        print(f"[CHAT] Response: {response_text[:100]}...")
        
        voice_text = generate_voice_status(response_text)
        print(f"[CHAT] Voice text: {voice_text[:100]}...")
        
        # Get session ID to return to frontend
        session_id = None
        if _copilot_session is not None and hasattr(_copilot_session, 'session_id'):
            session_id = _copilot_session.session_id
        
        return jsonify({
            "response": response_text,
            "voice_status": voice_text,
            "session_id": session_id
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
        
        # Only reset on specific fatal errors, not general ones
        error_msg = str(e).lower()
        fatal_errors = ['connection refused', 'client not started', 'authentication failed']
        if any(err in error_msg for err in fatal_errors):
            print("[CHAT] Fatal error - resetting client/session")
            _copilot_client = None
            _copilot_session = None
        
        fallback_response = f"I received your message: '{message[:50]}...'. The Copilot SDK encountered an error: {type(e).__name__}"
        return jsonify({
            "response": fallback_response,
            "voice_status": f"Error occurred: {type(e).__name__}. Please try again.",
            "session_id": _copilot_session.session_id if _copilot_session and hasattr(_copilot_session, 'session_id') else None
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
    session_id = None
    if _copilot_session is not None:
        # Try to get session ID from the session object
        if hasattr(_copilot_session, 'id'):
            session_id = _copilot_session.id
        elif hasattr(_copilot_session, 'session_id'):
            session_id = _copilot_session.session_id
        elif hasattr(_copilot_session, '_id'):
            session_id = _copilot_session._id
    
    return jsonify({
        "status": "ok",
        "whisper_model": WHISPER_MODEL,
        "piper_model": PIPER_MODEL_PATH.name if PIPER_MODEL_PATH.exists() else "not installed",
        "session_id": session_id,
        "session_active": _copilot_session is not None
    })


@app.route("/api/session/reset", methods=["POST"])
def reset_session():
    """Reset the Copilot session for a fresh conversation"""
    global _copilot_session, _context_stats
    _copilot_session = None
    _context_stats = {
        "input_tokens": 0,
        "output_tokens": 0,
        "turns": 0,
        "start_time": None,
        "max_tokens": 128000
    }
    print("[SESSION] Session reset by user")
    return jsonify({
        "success": True,
        "message": "Session reset successfully"
    })


@app.route("/api/cwd", methods=["GET"])
def get_cwd():
    """Get current working directory"""
    global _current_working_dir
    return jsonify({
        "cwd": _current_working_dir,
        "segments": _current_working_dir.replace("/", "\\").split("\\")
    })


@app.route("/api/cwd", methods=["POST"])
def set_cwd():
    """Set current working directory"""
    global _current_working_dir, _copilot_session
    
    data = request.get_json()
    if not data or "path" not in data:
        return jsonify({"error": "No path provided"}), 400
    
    new_path = data["path"].replace("/", "\\")
    
    # Validate path exists
    if not os.path.isdir(new_path):
        return jsonify({"error": f"Directory does not exist: {new_path}"}), 400
    
    _current_working_dir = os.path.abspath(new_path)
    
    # Reset Copilot session so it picks up new working directory
    _copilot_session = None
    
    return jsonify({
        "cwd": _current_working_dir,
        "segments": _current_working_dir.split("\\")
    })


# Base directory for directory suggestions (will be updated dynamically)
CWD_BASE_PATH = r"C:\SOC"


@app.route("/api/filesystem/home", methods=["GET"])
def get_home_directory():
    """Get the user's home directory from the OS"""
    home = os.path.expanduser("~")
    return jsonify({
        "path": home,
        "name": os.path.basename(home) or home
    })


@app.route("/api/filesystem/browse", methods=["GET"])
def browse_filesystem():
    """Browse the file system - list directories at a given path"""
    path = request.args.get("path", os.path.expanduser("~"))
    
    # Handle drive root on Windows
    if path and len(path) == 2 and path[1] == ':':
        path = path + "\\"
    
    try:
        path = os.path.abspath(path)
        
        if not os.path.isdir(path):
            return jsonify({"error": f"Not a directory: {path}"}), 400
        
        entries = []
        try:
            for entry in os.scandir(path):
                if entry.is_dir() and not entry.name.startswith('.'):
                    try:
                        # Check if we can access the directory
                        has_children = any(
                            e.is_dir() for e in os.scandir(entry.path) 
                            if not e.name.startswith('.')
                        )
                    except (PermissionError, OSError):
                        has_children = False
                    
                    entries.append({
                        "name": entry.name,
                        "path": entry.path,
                        "hasChildren": has_children
                    })
        except PermissionError:
            return jsonify({"error": f"Permission denied: {path}"}), 403
        
        # Sort alphabetically, case-insensitive
        entries.sort(key=lambda x: x["name"].lower())
        
        # Get parent path
        parent = os.path.dirname(path)
        if parent == path:  # At root
            parent = None
        
        return jsonify({
            "path": path,
            "parent": parent,
            "entries": entries
        })
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/filesystem/drives", methods=["GET"])
def list_drives():
    """List available drives (Windows) or root (Unix)"""
    import platform
    
    if platform.system() == "Windows":
        import string
        drives = []
        for letter in string.ascii_uppercase:
            drive = f"{letter}:\\"
            if os.path.exists(drive):
                drives.append({
                    "name": f"{letter}:",
                    "path": drive,
                    "hasChildren": True
                })
        return jsonify({"drives": drives})
    else:
        return jsonify({"drives": [{"name": "/", "path": "/", "hasChildren": True}]})


@app.route("/api/directories", methods=["GET"])
def list_directories():
    """List all directories under the base path"""
    base = request.args.get("base", CWD_BASE_PATH)
    max_depth = int(request.args.get("depth", 2))
    
    directories = []
    base_path = Path(base)
    
    if not base_path.exists():
        return jsonify({"error": f"Base path does not exist: {base}"}), 400
    
    def scan_dirs(path, current_depth):
        if current_depth > max_depth:
            return
        try:
            for entry in path.iterdir():
                if entry.is_dir() and not entry.name.startswith('.'):
                    directories.append(str(entry))
                    scan_dirs(entry, current_depth + 1)
        except PermissionError:
            pass
    
    scan_dirs(base_path, 1)
    
    return jsonify({
        "base": base,
        "directories": sorted(directories)
    })


@app.route("/api/cwd/suggest", methods=["POST"])
def suggest_cwd():
    """Use Copilot to suggest directories based on voice input"""
    global _copilot_client, _copilot_session
    
    data = request.get_json()
    if not data or "query" not in data:
        return jsonify({"error": "No query provided"}), 400
    
    query = data["query"]
    base = data.get("base", CWD_BASE_PATH)
    
    # Get available directories
    directories = []
    base_path = Path(base)
    
    def scan_dirs(path, current_depth, max_depth=2):
        if current_depth > max_depth:
            return
        try:
            for entry in path.iterdir():
                if entry.is_dir() and not entry.name.startswith('.'):
                    directories.append(str(entry))
                    scan_dirs(entry, current_depth + 1, max_depth)
        except PermissionError:
            pass
    
    if base_path.exists():
        scan_dirs(base_path, 1)
    
    if not directories:
        return jsonify({"error": "No directories found"}), 404
    
    # Ask Copilot to match the voice input to directories
    prompt = f"""The user said (via voice, may be phonetically similar): "{query}"

Available directories:
{chr(10).join(directories)}

Based on phonetic similarity and likely intent, return EXACTLY 3 directory paths that best match what the user likely meant. Return ONLY the full paths, one per line, no numbering or explanation. If fewer than 3 match well, still return 3 (pick closest alternatives)."""

    try:
        async def get_suggestions():
            global _copilot_client, _copilot_session
            
            if _copilot_client is None:
                from copilot import CopilotClient
                _copilot_client = CopilotClient()
                await _copilot_client.start()
            
            if _copilot_session is None:
                _copilot_session = await _copilot_client.create_session({
                    "intent": "directory-matching",
                    "skills": []
                })
            
            response = await _copilot_session.send_message(prompt, model="gpt-4", streaming=False)
            
            # Extract content from response
            content = ""
            if hasattr(response, 'content'):
                content = response.content
            elif hasattr(response, 'text'):
                content = response.text
            elif isinstance(response, str):
                content = response
            else:
                for event in response:
                    if hasattr(event, 'content'):
                        content += event.content
            
            return content
        
        result = run_async(get_suggestions(), timeout=30)
        
        # Parse the response into directory options
        lines = [line.strip() for line in result.strip().split('\n') if line.strip()]
        # Filter to only valid directories
        options = [line for line in lines if os.path.isdir(line)][:3]
        
        if not options:
            # Fallback: return first 3 directories
            options = directories[:3]
        
        return jsonify({
            "query": query,
            "options": [{"index": i + 1, "path": opt, "name": os.path.basename(opt)} for i, opt in enumerate(options)]
        })
        
    except Exception as e:
        print(f"[CWD/SUGGEST] Error: {e}")
        # Fallback: simple substring matching
        query_lower = query.lower().replace(" ", "")
        matches = []
        for d in directories:
            name_lower = os.path.basename(d).lower().replace("-", "").replace("_", "")
            if any(part in name_lower for part in query_lower.split()):
                matches.append(d)
        
        options = (matches or directories)[:3]
        return jsonify({
            "query": query,
            "options": [{"index": i + 1, "path": opt, "name": os.path.basename(opt)} for i, opt in enumerate(options)],
            "fallback": True
        })


@app.route("/api/cwd/select", methods=["POST"])
def select_cwd():
    """Select a directory from suggestions and update CWD"""
    global _current_working_dir, _copilot_session
    
    data = request.get_json()
    if not data or "path" not in data:
        return jsonify({"error": "No path provided"}), 400
    
    new_path = data["path"].replace("/", "\\")
    
    if not os.path.isdir(new_path):
        return jsonify({"error": f"Directory does not exist: {new_path}"}), 400
    
    _current_working_dir = os.path.abspath(new_path)
    _copilot_session = None  # Reset session for new context
    
    return jsonify({
        "success": True,
        "cwd": _current_working_dir,
        "segments": _current_working_dir.split("\\"),
        "message": f"Changed to {os.path.basename(_current_working_dir)}"
    })


if __name__ == "__main__":
    print("Starting Voice Copilot Server...")
    print(f"Models directory: {MODELS_DIR}")
    app.run(debug=True, host="0.0.0.0", port=5000)
