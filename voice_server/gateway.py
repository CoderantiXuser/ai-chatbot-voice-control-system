# gateway.py (Version 6.0: Class-based & Refined)
import sys
import os
import json
import threading
import subprocess
import logging
from datetime import datetime
from collections import deque
from flask import Flask, request, jsonify, render_template, Blueprint, Response
from flask_cors import CORS
from flask_socketio import SocketIO, emit

# --- VOSK ASR Imports ---
try:
    from vosk import Model, KaldiRecognizer
    import pyaudio
except ImportError as e:
    print(f"FATAL: Missing dependency: {e}. Please run 'pip install vosk pyaudio'")
    sys.exit(1)

# --- Basic Logging Setup ---
# Configure basic logging to stdout
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    stream=sys.stdout
)
# Silence Werkzeug's default logger to avoid duplicate output
werkzeug_log = logging.getLogger('werkzeug')
werkzeug_log.setLevel(logging.ERROR)


class VoiceGateway:
    """
    Encapsulates the entire Voice Gateway server application, including
    Flask routes, SocketIO handlers, and ASR/TTS processing logic.
    """
    
    # --- Configuration ---
    CONFIG = {
        "PIPER_MODEL_DIRS": ["/usr/share/piper-tts-vosk-asr-models/piper-models/"],
        "VOSK_MODEL_DIRS": ["/usr/share/piper-tts-vosk-asr-models/vosk-models/"],
        "ASR_COMMANDS_FILE": "asr_cmds.json",
        "LOG_HISTORY_MAXLEN": 150,
        "ASR_RESULTS_MAXLEN": 10,
        "LOG_LEVELS": {
            "DEBUG": 0, "INFO": 1, "WARN": 2, "ERROR": 3, "CRITICAL": 4,
            "SYSTEM": 1, "ACTION": 1, "SUCCESS": 1
        }
    }

    def __init__(self):
        # --- State ---
        self.available_piper_models = []
        self.available_vosk_models = []
        self.asr_commands = {}
        self.asr_thread = None
        self.asr_running_flag = threading.Event()
        self.current_tts_process = None
        self.tts_process_lock = threading.Lock()
        self.log_history = deque(maxlen=self.CONFIG['LOG_HISTORY_MAXLEN'])
        self.asr_results_queue = deque(maxlen=self.CONFIG['ASR_RESULTS_MAXLEN'])

        # --- Reverse Log Level Mapping for Handlers ---
        self.LEVEL_NAMES_BY_VALUE = {v: k for k, v in self.CONFIG['LOG_LEVELS'].items()}

        # --- App Setup ---
        self.app = Flask(__name__, static_folder='static', template_folder='templates')
        self.app.config['SECRET_KEY'] = os.urandom(24)
        CORS(self.app)
        self.socketio = SocketIO(self.app, cors_allowed_origins="*")

        self.setup_routes()
        self.setup_socketio()
        self.initialize_gateway()

    def initialize_gateway(self):
        """Scans models and loads commands."""
        self.log_event("Server Init", "-----------------------------------", "Info", level="SYSTEM")
        self.log_event("Server Init", "Initializing Voice Gateway...", "Info", level="SYSTEM")
        self.scan_models()
        self.load_asr_commands()
        self.log_event("Server Init", "Gateway is ready and awaiting connections.", "Success", level="SYSTEM")

    def setup_routes(self):
        """Registers Flask blueprints and routes."""
        api_blueprint = Blueprint('api', __name__, url_prefix='/api')

        # --- API Routes ---
        @api_blueprint.route('/status', methods=['GET'])
        def get_status():
            return jsonify({"asr_running": self.asr_thread is not None and self.asr_thread.is_alive()})

        @api_blueprint.route('/tts', methods=['POST'])
        def handle_tts_request():
            data = request.json
            audio_data, error = self.speak_text(**data)

            if error:
                self.log_event("TTS API Error", error, "Error", level="ERROR")
                return jsonify({"status": "error", "message": error}), 500

            # The mimetype should ideally match the output format from piper.
            # Assuming s16le format at 22050 Hz, which is a common piper default.
            return Response(audio_data, content_type="audio/l16; rate=22050; channels=1")

        @api_blueprint.route('/tts/stop', methods=['POST'])
        def handle_tts_stop():
            return self.stop_tts()

        @api_blueprint.route('/asr/start', methods=['POST'])
        def handle_asr_start():
            model_path = request.json.get('model')
            return self.start_asr(model_path)

        @api_blueprint.route('/asr/stop', methods=['POST'])
        def handle_asr_stop():
            return self.stop_asr()

        @api_blueprint.route('/asr/results', methods=['GET'])
        def get_asr_results():
            results = list(self.asr_results_queue)
            self.asr_results_queue.clear()
            return jsonify(results)

        @api_blueprint.route('/models/<model_type>', methods=['GET'])
        def get_models_list(model_type):
            if model_type == 'piper':
                return jsonify(self.available_piper_models)
            elif model_type == 'vosk':
                models = [{"name": os.path.basename(p), "path": p} for p in self.available_vosk_models]
                return jsonify(models)
            return jsonify({"error": "Unknown model type"}), 404

        @api_blueprint.route('/browse', methods=['GET'])
        def browse_directories():
            """Securely browses directories within the user's home directory."""
            home_dir = os.path.expanduser('~')
            req_path = request.args.get('path', home_dir)

            # --- Security Check ---
            # Resolve the absolute path and ensure it's within the home directory.
            abs_req_path = os.path.abspath(os.path.join(home_dir, req_path))
            if not abs_req_path.startswith(home_dir):
                return jsonify({"error": "Access denied. Path is outside the allowed directory."}), 403

            try:
                if not os.path.isdir(abs_req_path):
                    return jsonify({"error": "Path is not a valid directory."}), 400

                # List contents and filter for directories only
                dirs = [d for d in os.listdir(abs_req_path) if os.path.isdir(os.path.join(abs_req_path, d))]

                # Provide parent directory for navigation
                parent = os.path.dirname(abs_req_path) if abs_req_path != home_dir else None

                return jsonify({
                    "current_path": abs_req_path,
                    "parent_path": parent,
                    "directories": sorted(dirs)
                })
            except Exception as e:
                return jsonify({"error": f"Failed to browse directory: {e}"}), 500

        self.app.register_blueprint(api_blueprint)

        # --- Web UI Routes ---
        @self.app.route('/')
        def index():
            return render_template('logs.html')

        @self.app.route('/logs')
        def view_logs():
            return render_template('logs.html')

    def setup_socketio(self):
        """Registers SocketIO event handlers."""
        @self.socketio.on('connect')
        def handle_connect():
            self.log_event("SocketIO", f"Log viewer client connected: {request.sid}", "Info", full_data={"sid": request.sid})
            emit('log_history', {'logs': list(self.log_history)}, to=request.sid)

        @self.socketio.on('disconnect')
        def handle_disconnect():
            self.log_event("SocketIO", f"Log viewer client disconnected: {request.sid}", "Info", full_data={"sid": request.sid})
        
        @self.socketio.on('extension_log')
        def handle_extension_log(log_entry):
            """Handles log entries from the browser extension."""
            numeric_level = log_entry.get('level', 1)  # Default to INFO

            # Convert numeric level from extension to string representation for log_event
            level_str = self.LEVEL_NAMES_BY_VALUE.get(numeric_level, 'INFO')

            log_entry['source'] = log_entry.get('source', 'extension')
            self.log_event(
                event=log_entry.get('event', 'Unknown Event'),
                details=log_entry.get('details', 'No details provided.'),
                status=log_entry.get('status', 'Info'),
                trigger_id=log_entry.get('triggerId', 'N/A'),
                level=level_str,  # Pass the converted string level
                full_data=log_entry.get('fullData', {})
            )

    def log_event(self, event: str, details: str, status: str, trigger_id: str = 'N/A', level: str = 'INFO', full_data: dict = None):
        """The core logging function. Formats, prints, adds to history, and pushes to clients."""
        timestamp = datetime.now().isoformat() + 'Z'

        # --- Robustness: Handle both string and numeric levels ---
        if isinstance(level, int):
            # If level is an int, convert it to its string name; default to 'INFO'
            level_str = self.LEVEL_NAMES_BY_VALUE.get(level, 'INFO')
        else:
            # Otherwise, assume it's a string and uppercase it
            level_str = level.upper()

        level_upper = level_str
        log_entry = {
            'timestamp': timestamp,
            'source': 'gateway.py',
            'event': event,
            'details': details,
            'status': status,
            'triggerId': trigger_id,
            'level': self.CONFIG['LOG_LEVELS'].get(level_upper, self.CONFIG['LOG_LEVELS']['INFO']),
            'fullData': full_data or {}
        }
        
        # Use standard logging for console output
        formatted_log = f"[{level_upper}] [{log_entry['source']}] {event}: {details}"
        logging.info(formatted_log)
        
        self.log_history.append(log_entry)
        self.socketio.emit('new_log', log_entry)

    def scan_models(self):
        """Scans configured directories for Piper and VOSK models, prioritizing environment variables."""
        self.log_event("Model Scan", "Scanning for models...", "Info", level="SYSTEM")

        # --- Determine Model Directories ---
        tts_env_path = os.getenv('TTS_MODELS_DIR')
        asr_env_path = os.getenv('ASR_MODELS_DIR')

        piper_model_dirs = [tts_env_path] if tts_env_path else self.CONFIG['PIPER_MODEL_DIRS']
        vosk_model_dirs = [asr_env_path] if asr_env_path else self.CONFIG['VOSK_MODEL_DIRS']
        
        self.log_event("Model Scan", f"Piper (TTS) directories: {piper_model_dirs}", "Info")
        self.log_event("Model Scan", f"VOSK (ASR) directories: {vosk_model_dirs}", "Info")

        # --- Piper (TTS) Scan ---
        piper_found = []
        for dir_path in piper_model_dirs:
            if not dir_path or not os.path.isdir(dir_path): continue
            try:
                for filename in os.listdir(dir_path):
                    if not filename.endswith(".onnx"): continue
                    model_path = os.path.join(dir_path, filename)
                    model_info = {"name": os.path.basename(model_path), "path": model_path, "speakers": None}
                    json_path = model_path + ".json"
                    if os.path.exists(json_path):
                        try:
                            with open(json_path, 'r', encoding='utf-8') as f:
                                metadata = json.load(f)
                            if metadata.get("num_speakers", 0) > 1:
                                speakers = [{"id": v, "name": k} for k, v in metadata.get("speaker_id_map", {}).items()]
                                model_info["speakers"] = sorted(speakers, key=lambda x: x["id"])
                        except (json.JSONDecodeError, Exception) as e:
                            self.log_event("Model Scan Error", f"Error processing {json_path}: {e}", "Error", level="ERROR", full_data={"path": json_path, "error": str(e)})
                    piper_found.append(model_info)
            except OSError as e:
                self.log_event("Model Scan Error", f"Could not scan Piper directory {dir_path}: {e}", "Error", level="ERROR", full_data={"directory": dir_path, "error": str(e)})
        self.available_piper_models = sorted(piper_found, key=lambda x: x["name"])
        self.log_event("Model Scan", f"Found {len(self.available_piper_models)} Piper models.", "Success" if piper_found else "Info")

        # --- VOSK (ASR) Scan ---
        vosk_found = []
        for dir_path in vosk_model_dirs:
            if not dir_path or not os.path.isdir(dir_path): continue
            try:
                for item in os.listdir(dir_path):
                    model_path = os.path.join(dir_path, item)
                    if os.path.isdir(model_path) and os.path.exists(os.path.join(model_path, 'am', 'final.mdl')):
                        vosk_found.append(model_path)
            except OSError as e:
                self.log_event("Model Scan Error", f"Could not scan VOSK directory {dir_path}: {e}", "Error", level="ERROR", full_data={"directory": dir_path, "error": str(e)})
        self.available_vosk_models = sorted(vosk_found)
        self.log_event("Model Scan", f"Found {len(self.available_vosk_models)} VOSK models.", "Success" if vosk_found else "Info")

    def load_asr_commands(self):
        """Loads ASR commands from a JSON file."""
        commands_file = os.path.join(os.path.dirname(__file__), self.CONFIG['ASR_COMMANDS_FILE'])
        self.log_event("ASR Commands", f"Loading from {commands_file}...", "Info", level="SYSTEM")
        try:
            with open(commands_file, 'r') as f:
                data = json.load(f)
            self.asr_commands = {cmd["phrase"].lower(): cmd["action"] for cmd in data.get("commands", [])}
            self.log_event("ASR Commands", f"Loaded {len(self.asr_commands)} commands.", "Success", level="INFO")
        except FileNotFoundError:
            self.log_event("ASR Commands", "Commands file not found.", "Error", level="ERROR")
        except (json.JSONDecodeError, Exception) as e:
            self.log_event("ASR Commands", f"Error loading commands: {e}", "Error", level="ERROR", full_data={"error": str(e)})

    def speak_text(self, text: str, model: str, speaker_id: int = None, **kwargs):
        """
        Generates speech from text using the Piper TTS engine and returns the raw audio data.
        Returns a tuple of (audio_data, error_message).
        """
        if not text:
            error_msg = "Empty text received, skipping TTS generation."
            self.log_event("TTS Request", error_msg, "Warning", level="WARN")
            return None, error_msg

        if not model or not os.path.exists(model):
            error_msg = f"Piper model not found: {model}"
            self.log_event("TTS Request", error_msg, "Error", level="ERROR", full_data={"model_path": model})
            return None, error_msg

        with self.tts_process_lock:
            try:
                self.log_event("TTS Generation", f"Starting TTS for '{text[:50]}...'", "Info", level="INFO", full_data={"model": os.path.basename(model), "speaker_id": speaker_id})

                piper_command = ["piper", "--model", model, "--output-raw"]
                if speaker_id is not None:
                    piper_command.extend(["--speaker", str(speaker_id)])
                
                for key, value in kwargs.items():
                    if value is not None and key not in ['text', 'model', 'speaker_id']:
                        kebab_key = key.replace('_', '-')
                        piper_command.extend([f"--{kebab_key}", str(value)])

                piper_process = subprocess.Popen(
                    piper_command,
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE
                )

                audio_data, stderr_data = piper_process.communicate(input=text.encode('utf-8'))

                if piper_process.returncode != 0:
                    error_msg = f"Piper process exited with code {piper_process.returncode}: {stderr_data.decode().strip()}"
                    self.log_event("TTS Error", error_msg, "Error", level="ERROR", full_data={"error": stderr_data.decode()})
                    return None, error_msg
                
                if stderr_data:
                    self.log_event("TTS Warning", f"Piper process stderr: {stderr_data.decode().strip()}", "Warn", level="WARN")

                self.log_event("TTS Generation", f"Successfully generated {len(audio_data)} bytes of audio data.", "Success", level="INFO")
                return audio_data, None

            except Exception as e:
                error_msg = f"An exception occurred during TTS generation: {e}"
                self.log_event("TTS Error", error_msg, "Error", level="CRITICAL", full_data={"error": str(e)})
                return None, error_msg

    def stop_tts(self):
        """Stops the currently running TTS process. (Now deprecated)"""
        self.log_event("TTS Control", "Stop request received but is no longer applicable in this server mode.", "Warning", level="WARN")
        return jsonify({"status": "warning", "message": "TTS stop functionality is not applicable in the current server mode."})

    def start_asr(self, model_path: str):
        """Starts the ASR listening thread."""
        if self.asr_thread and self.asr_thread.is_alive():
            self.log_event("ASR Control", "Start request ignored: already running.", "Warning", level="WARN")
            return jsonify({"status": "warning", "message": "ASR is already running."})
        
        if not model_path or not os.path.exists(model_path):
            self.log_event("ASR Control", "No valid VOSK model specified.", "Error", level="ERROR")
            return jsonify({"status": "error", "message": "No VOSK model specified"}), 400
        
        self.log_event("ASR Control", f"Start request received for model: {os.path.basename(model_path)}", "Info", level="ACTION")
        self.asr_running_flag.clear()
        self.asr_thread = threading.Thread(target=self._asr_listen_loop, args=(model_path,))
        self.asr_thread.daemon = True
        self.asr_thread.start()
        return jsonify({"status": "ok", "message": "ASR started."})

    def stop_asr(self):
        """Stops the ASR listening thread."""
        self.log_event("ASR Control", "Stop request received.", "Info", level="ACTION")
        if not self.asr_thread or not self.asr_thread.is_alive():
            self.log_event("ASR Control", "Stop request ignored: not running.", "Warning", level="WARN")
            return jsonify({"status": "warning", "message": "ASR is not running."})
        
        self.asr_running_flag.set()
        self.asr_thread.join(timeout=2)
        self.asr_thread = None
        self.log_event("ASR Control", "ASR process stopped.", "Success", level="SUCCESS")
        return jsonify({"status": "ok", "message": "ASR stopped."})

    def _asr_listen_loop(self, model_path: str):
        """The main loop for the ASR thread."""
        self.log_event("ASR Thread", f"Starting with model '{os.path.basename(model_path)}'", "Info", level="INFO")
        try:
            model = Model(model_path)
            recognizer = KaldiRecognizer(model, 16000)
            p_audio = pyaudio.PyAudio()
            stream = p_audio.open(format=pyaudio.paInt16, channels=1, rate=16000, input=True, frames_per_buffer=8192)
            stream.start_stream()
            self.log_event("ASR Thread", "VOSK Model loaded. Listening...", "Success", level="INFO")

            while not self.asr_running_flag.is_set():
                data = stream.read(4096, exception_on_overflow=False)
                if recognizer.AcceptWaveform(data):
                    result = json.loads(recognizer.Result())
                    text = result.get('text', '')
                    if text:
                        self.log_event("ASR Recognition", f"Recognized: '{text}'", "Info", level="INFO", full_data={"text": text})
                        self.asr_results_queue.append(text)
                        # --- Push result directly to clients ---
                        self.socketio.emit('asr_result', {'text': text})
        except Exception as e:
            self.log_event("ASR Error", f"An error occurred in the ASR thread: {e}", "Error", level="CRITICAL", full_data={"error": str(e)})
        finally:
            if 'stream' in locals() and locals()['stream'].is_active():
                locals()['stream'].stop_stream()
                locals()['stream'].close()
            if 'p_audio' in locals():
                locals()['p_audio'].terminate()
            self.log_event("ASR Thread", "ASR thread finished.", "Info", level="INFO")

    def run(self, host='127.0.0.1', port=5000):
        """Starts the Flask-SocketIO server."""
        self.socketio.run(self.app, host=host, port=port, allow_unsafe_werkzeug=True)

# --- Main Execution ---
if __name__ == '__main__':
    gateway = VoiceGateway()
    gateway.run()
