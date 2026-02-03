/**
 * Voice Copilot - Frontend Application
 * Handles recording, wake word detection, and Copilot interactions
 */

class VoiceCopilot {
    constructor() {
        // DOM elements
        this.recordBtn = document.getElementById('record-btn');
        this.pttToggle = document.getElementById('ptt-toggle');
        this.status = document.getElementById('status');
        this.wakeWordStatus = document.getElementById('wake-word-status');
        this.conversation = document.getElementById('conversation');
        this.transcript = document.getElementById('transcript');
        this.chatInput = document.getElementById('chat-input');
        this.sendBtn = document.getElementById('send-btn');
        this.autoSubmitTimer = document.getElementById('auto-submit-timer');
        this.healthIndicator = document.getElementById('health-indicator');
        this.healthText = document.getElementById('health-text');

        // State
        this.isRecording = false;
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.recognition = null;
        this.wakeWordActive = false;
        this.autoSubmitTimeout = null;
        this.isVoiceInput = false;
        this.serverOnline = false;
        this.micPermission = false;
        this.pushToTalkMode = false;  // PTT toggle state

        // Wake words
        this.wakeWords = ['copilot', 'github', 'hey copilot', 'hey github'];
        this.stopWords = ['stop listening', 'done', 'finish', 'end', 'that\'s all'];
        this.abortWords = ['abort', 'cancel', 'nevermind', 'never mind'];
        this.triggeredByVoice = false;
        this.autoSubmitActive = false;

        this.init();
    }

    init() {
        // Start health monitoring
        this.startHealthMonitor();
        
        // Push-to-talk toggle handler
        this.pttToggle.addEventListener('click', () => {
            this.pushToTalkMode = !this.pushToTalkMode;
            this.pttToggle.classList.toggle('active', this.pushToTalkMode);
            this.updateRecordButtonText();
            console.log('Push-to-talk mode:', this.pushToTalkMode ? 'ON' : 'OFF');
        });
        
        // Set up button handlers - click toggles for voice-triggered or PTT mode, hold for manual
        this.recordBtn.addEventListener('click', (e) => {
            // If recording was triggered by voice, a click should stop it
            if (this.isRecording && this.triggeredByVoice) {
                e.preventDefault();
                this.stopRecording();
            }
            // PTT mode: click to toggle recording
            else if (this.pushToTalkMode && !this.triggeredByVoice) {
                e.preventDefault();
                if (this.isRecording) {
                    this.stopRecording();
                } else {
                    this.startRecording(false);
                }
            }
        });
        
        this.recordBtn.addEventListener('mousedown', () => {
            // Only use hold-to-record if NOT in PTT mode
            if (!this.isRecording && !this.pushToTalkMode) {
                this.startRecording(false);  // Button-triggered
            }
        });
        this.recordBtn.addEventListener('mouseup', () => {
            // Only stop on mouseup if it was button-triggered (hold to record) and NOT in PTT mode
            if (this.isRecording && !this.triggeredByVoice && !this.pushToTalkMode) {
                this.stopRecording();
            }
        });
        this.recordBtn.addEventListener('mouseleave', () => {
            if (this.isRecording && !this.triggeredByVoice && !this.pushToTalkMode) {
                this.stopRecording();
            }
        });

        // Touch support for mobile
        this.recordBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            if (this.isRecording && this.triggeredByVoice) {
                // Tap to stop voice-triggered recording
                this.stopRecording();
            } else if (this.pushToTalkMode) {
                // PTT mode: tap to toggle
                if (this.isRecording) {
                    this.stopRecording();
                } else {
                    this.startRecording(false);
                }
            } else if (!this.isRecording) {
                this.startRecording(false);
            }
        });
        this.recordBtn.addEventListener('touchend', (e) => {
            e.preventDefault();
            // Only stop on touchend if it was button-triggered AND not in PTT mode
            if (this.isRecording && !this.triggeredByVoice && !this.pushToTalkMode) {
                this.stopRecording();
            }
        });

        // Chat input handlers
        this.sendBtn.addEventListener('click', () => this.submitMessage());
        this.chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.submitMessage();
            }
        });
        this.chatInput.addEventListener('input', () => {
            // Cancel auto-submit if user edits the text
            this.cancelAutoSubmit();
            this.chatInput.classList.remove('voice-input');
            this.isVoiceInput = false;
        });

        // Initialize wake word detection
        this.initWakeWordDetection();

        // Check browser support
        this.checkSupport();
    }

    checkSupport() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            this.showError('Microphone access not supported in this browser');
            this.recordBtn.disabled = true;
        }
    }

    initWakeWordDetection() {
        // Use Web Speech API for wake word detection
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        
        if (!SpeechRecognition) {
            this.wakeWordStatus.innerHTML = '<span class="indicator" style="background: #cf222e;"></span> Wake word not supported';
            this.wakeWordStatus.classList.add('inactive');
            return;
        }

        this.recognition = new SpeechRecognition();
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.lang = 'en-US';

        this.recognition.onresult = (event) => {
            const last = event.results[event.results.length - 1];
            const text = last[0].transcript.toLowerCase().trim();
            
            // Check for wake words (only when not recording)
            if (!this.isRecording) {
                for (const wake of this.wakeWords) {
                    if (text.includes(wake)) {
                        console.log('Wake word detected:', wake);
                        this.transcript.textContent = `Wake word detected: "${wake}"`;
                        this.startRecording(true);  // Pass true for voice-triggered
                        return;
                    }
                }
            }
            
            // Check for stop words during recording (only for voice-triggered recording)
            if (this.isRecording && this.triggeredByVoice) {
                for (const stop of this.stopWords) {
                    if (text.includes(stop)) {
                        console.log('Stop word detected:', stop);
                        this.transcript.textContent = `Stop command: "${stop}"`;
                        this.stopRecording();
                        return;
                    }
                }
            }
            
            // Check for abort words during auto-submit countdown
            if (this.autoSubmitActive) {
                for (const abort of this.abortWords) {
                    if (text.includes(abort)) {
                        console.log('Abort word detected:', abort);
                        this.cancelAutoSubmit();
                        this.transcript.textContent = `Aborted: "${abort}" - text kept for editing`;
                        // Keep the text in the input, just cancel auto-send
                        return;
                    }
                }
            }
        };

        this.recognition.onerror = (event) => {
            console.warn('Speech recognition error:', event.error);
            if (event.error === 'not-allowed' || event.error === 'audio-capture') {
                this.wakeWordStatus.innerHTML = '<span class="indicator" style="background: #cf222e;"></span> Microphone permission denied';
                this.wakeWordStatus.classList.add('inactive');
                this.wakeWordActive = false;  // Stop retrying if permission denied
            }
        };

        this.recognition.onend = () => {
            // Restart recognition in these cases:
            // 1. Not recording - keep listening for wake words
            // 2. Recording triggered by voice - need to listen for "stop" command
            // 3. Auto-submit countdown active - need to listen for "abort" command
            const shouldRestart = this.wakeWordActive && 
                                  !this.wakeWordStatus.classList.contains('inactive') &&
                                  (!this.isRecording || this.triggeredByVoice || this.autoSubmitActive);
            
            if (shouldRestart) {
                setTimeout(() => {
                    try {
                        this.recognition.start();
                        console.log('Speech recognition restarted, isRecording:', this.isRecording);
                    } catch (e) {
                        console.warn('Could not restart recognition:', e);
                    }
                }, 100);  // Quick restart for responsive stop detection
            }
        };

        // Start wake word listening
        this.startWakeWordDetection();
    }

    startWakeWordDetection() {
        if (this.recognition && !this.wakeWordActive) {
            try {
                this.recognition.start();
                this.wakeWordActive = true;
                this.wakeWordStatus.innerHTML = '<span class="indicator"></span> Listening for wake word...';
                this.wakeWordStatus.classList.remove('inactive');
            } catch (e) {
                console.warn('Could not start wake word detection:', e);
            }
        }
    }

    stopWakeWordDetection() {
        if (this.recognition && this.wakeWordActive) {
            this.wakeWordActive = false;
            try {
                this.recognition.stop();
            } catch (e) {
                console.warn('Could not stop recognition:', e);
            }
        }
    }

    async startRecording(triggeredByWakeWord = false) {
        if (this.isRecording) return;

        this.triggeredByVoice = triggeredByWakeWord;
        this.recordingStartTime = Date.now();  // Track start time

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    sampleRate: 16000
                }
            });

            this.isRecording = true;
            this.audioChunks = [];
            this.updateUI('recording');

            // If triggered by wake word, keep speech recognition running for stop detection
            // If triggered by button, stop it to avoid conflicts
            if (!triggeredByWakeWord) {
                this.stopWakeWordDetection();
            }

            this.mediaRecorder = new MediaRecorder(stream, {
                mimeType: this.getSupportedMimeType()
            });

            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.audioChunks.push(event.data);
                }
            };

            this.mediaRecorder.onstop = () => {
                stream.getTracks().forEach(track => track.stop());
                this.processRecording();
            };

            this.mediaRecorder.start(100); // Collect data every 100ms
            console.log('Recording started, triggered by:', triggeredByWakeWord ? 'wake word' : 'button');

        } catch (error) {
            console.error('Error starting recording:', error);
            this.showError('Could not access microphone');
            this.isRecording = false;
        }
    }

    getSupportedMimeType() {
        const types = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/wav'];
        for (const type of types) {
            if (MediaRecorder.isTypeSupported(type)) {
                return type;
            }
        }
        return 'audio/webm';
    }

    stopRecording() {
        if (!this.isRecording || !this.mediaRecorder) return;

        this.isRecording = false;
        this.mediaRecorder.stop();
        this.updateUI('processing');
        console.log('Recording stopped');
    }

    async processRecording() {
        // Check recording duration - ignore if under 1 second
        const recordingDuration = Date.now() - this.recordingStartTime;
        if (recordingDuration < 1000) {
            console.log('Recording too short, ignoring:', recordingDuration, 'ms');
            this.transcript.textContent = 'Recording too short';
            this.updateUI('ready');
            this.startWakeWordDetection();
            return;
        }

        if (this.audioChunks.length === 0) {
            this.updateUI('ready');
            this.startWakeWordDetection();
            return;
        }

        const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
        
        // Convert to WAV for better compatibility with Whisper
        const wavBlob = await this.convertToWav(audioBlob);

        try {
            // Step 1: Transcribe
            this.transcript.textContent = 'Transcribing...';
            const transcription = await this.transcribe(wavBlob);
            
            if (!transcription.text || transcription.text.trim() === '') {
                this.transcript.textContent = 'No speech detected';
                this.updateUI('ready');
                this.startWakeWordDetection();
                return;
            }

            // Put transcription in chat input
            this.chatInput.value = transcription.text;
            this.chatInput.classList.add('voice-input');
            this.isVoiceInput = true;
            this.transcript.textContent = 'Voice transcription ready';
            this.updateUI('ready');

            // Start auto-submit countdown (2 seconds)
            this.startAutoSubmit();

        } catch (error) {
            console.error('Error processing recording:', error);
            this.showError('Error: ' + error.message);
            this.updateUI('ready');
        }

        this.startWakeWordDetection();
    }

    startAutoSubmit() {
        this.cancelAutoSubmit();
        let countdown = 4;
        this.autoSubmitActive = true;
        
        this.autoSubmitTimer.textContent = `Auto-sending in ${countdown}s... (say "abort" to cancel)`;
        
        const tick = () => {
            countdown--;
            if (countdown > 0) {
                this.autoSubmitTimer.textContent = `Auto-sending in ${countdown}s... (say "abort" to cancel)`;
                this.autoSubmitTimeout = setTimeout(tick, 1000);
            } else {
                this.autoSubmitTimer.textContent = '';
                this.autoSubmitActive = false;
                this.submitMessage();
            }
        };
        
        this.autoSubmitTimeout = setTimeout(tick, 1000);
    }

    cancelAutoSubmit() {
        if (this.autoSubmitTimeout) {
            clearTimeout(this.autoSubmitTimeout);
            this.autoSubmitTimeout = null;
        }
        this.autoSubmitActive = false;
        this.autoSubmitTimer.textContent = '';
    }

    cleanStopWords(text) {
        // Remove stop words from the end of the message (case-insensitive)
        let cleaned = text;
        const allStopWords = [...this.stopWords, ...this.abortWords];
        
        for (const word of allStopWords) {
            // Remove from end of string (with optional trailing punctuation)
            const endPattern = new RegExp(`\\s*${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[.!?,]*\\s*$`, 'i');
            cleaned = cleaned.replace(endPattern, '');
            
            // Also remove if it appears at the start followed by comma/period
            const startPattern = new RegExp(`^\\s*${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[.!?,]*\\s*`, 'i');
            cleaned = cleaned.replace(startPattern, '');
        }
        
        return cleaned.trim();
    }

    async submitMessage() {
        let message = this.chatInput.value.trim();
        if (!message) return;

        // Remove stop words that may have been captured in transcription
        message = this.cleanStopWords(message);
        if (!message) return;

        this.cancelAutoSubmit();
        this.chatInput.value = '';
        this.chatInput.classList.remove('voice-input');
        this.isVoiceInput = false;
        this.transcript.textContent = '';

        // Add user message to conversation
        this.addMessage('user', message);

        // Send to Copilot
        this.updateUI('processing');
        this.status.innerHTML = 'Thinking<span class="loading"></span>';
        this.sendBtn.disabled = true;

        try {
            const response = await this.sendToCopilot(message);
            this.addMessage('copilot', response.response);

            // Stop wake word detection while speaking to prevent feedback loop
            this.stopWakeWordDetection();
            
            // Speak the response
            this.updateUI('speaking');
            await this.speak(response.voice_status || response.response);

            this.updateUI('ready');
            
            // Resume wake word detection after speaking
            this.startWakeWordDetection();
        } catch (error) {
            console.error('Error sending message:', error);
            this.showError('Error: ' + error.message);
            this.updateUI('ready');
            this.startWakeWordDetection();
        }

        this.sendBtn.disabled = false;
    }

    async convertToWav(blob) {
        // For now, we'll send the webm directly and let the server handle it
        // In production, you might want to convert client-side
        return blob;
    }

    async transcribe(audioBlob) {
        const formData = new FormData();
        formData.append('audio', audioBlob, 'recording.wav');

        const response = await fetch('/api/transcribe', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Transcription failed');
        }

        return response.json();
    }

    async sendToCopilot(message) {
        console.log('[SEND] Sending to Copilot:', message);
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message })
        });

        console.log('[SEND] Response status:', response.status);
        
        if (!response.ok) {
            const error = await response.json();
            console.error('[SEND] Error response:', error);
            throw new Error(error.error || 'Copilot request failed');
        }

        const data = await response.json();
        console.log('[SEND] Response data:', data);
        return data;
    }

    async speak(text) {
        console.log('[SPEAK] Speaking text:', text);
        try {
            const response = await fetch('/api/speak', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text })
            });

            if (!response.ok) {
                // Fallback to browser TTS
                this.speakWithBrowserTTS(text);
                return;
            }

            const audioBlob = await response.blob();
            console.log('TTS audio blob size:', audioBlob.size);
            const audioUrl = URL.createObjectURL(audioBlob);
            const audio = new Audio(audioUrl);
            
            return new Promise((resolve) => {
                audio.onended = () => {
                    console.log('TTS audio playback ended');
                    URL.revokeObjectURL(audioUrl);
                    resolve();
                };
                audio.onerror = (e) => {
                    console.error('TTS audio error:', e);
                    URL.revokeObjectURL(audioUrl);
                    this.speakWithBrowserTTS(text);
                    resolve();
                };
                audio.play().then(() => {
                    console.log('TTS audio playing');
                }).catch((e) => {
                    console.error('TTS play() failed:', e);
                    this.speakWithBrowserTTS(text);
                    resolve();
                });
            });

        } catch (error) {
            console.warn('Piper TTS failed, using browser TTS:', error);
            this.speakWithBrowserTTS(text);
        }
    }

    speakWithBrowserTTS(text) {
        if ('speechSynthesis' in window) {
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.rate = 1.1;
            speechSynthesis.speak(utterance);
        }
    }

    addMessage(type, text) {
        console.log('[MESSAGE] Adding message:', type, text?.substring(0, 50));
        this.conversation.classList.add('active');
        
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}`;
        
        const label = document.createElement('div');
        label.className = 'label';
        label.textContent = type === 'user' ? 'You' : 'Copilot';
        
        const content = document.createElement('div');
        content.textContent = text || '(empty response)';
        
        messageDiv.appendChild(label);
        messageDiv.appendChild(content);
        this.conversation.appendChild(messageDiv);
        
        // Scroll to bottom
        this.conversation.scrollTop = this.conversation.scrollHeight;
        console.log('[MESSAGE] Message added, conversation children:', this.conversation.children.length);
    }

    updateUI(state) {
        this.recordBtn.classList.remove('recording');
        this.status.classList.remove('recording', 'processing', 'speaking');

        switch (state) {
            case 'recording':
                this.recordBtn.classList.add('recording');
                // Show different text depending on how recording was triggered and mode
                if (this.triggeredByVoice) {
                    this.recordBtn.querySelector('.btn-text').textContent = 'Click or say "stop"';
                } else if (this.pushToTalkMode) {
                    this.recordBtn.querySelector('.btn-text').textContent = 'Click to Stop';
                } else {
                    this.recordBtn.querySelector('.btn-text').textContent = 'Release to stop';
                }
                this.status.classList.add('recording');
                this.status.textContent = '🔴 Recording';
                break;
            case 'processing':
                this.recordBtn.querySelector('.btn-text').textContent = 'Processing...';
                this.status.classList.add('processing');
                this.status.textContent = 'Processing...';
                break;
            case 'speaking':
                this.recordBtn.querySelector('.btn-text').textContent = 'Speaking...';
                this.status.classList.add('speaking');
                this.status.textContent = '🔊 Speaking';
                break;
            default:
                this.updateRecordButtonText();
                this.status.textContent = 'Ready';
                this.triggeredByVoice = false;  // Reset on ready state
        }
    }

    updateRecordButtonText() {
        if (this.pushToTalkMode) {
            this.recordBtn.querySelector('.btn-text').textContent = 'Click to Record';
        } else {
            this.recordBtn.querySelector('.btn-text').textContent = 'Hold to Record';
        }
    }

    showError(message) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error';
        errorDiv.textContent = message;
        
        const main = document.querySelector('main');
        main.insertBefore(errorDiv, main.firstChild);
        
        setTimeout(() => errorDiv.remove(), 5000);
    }

    startHealthMonitor() {
        // Check immediately, then every 3 seconds
        this.checkHealth();
        setInterval(() => this.checkHealth(), 3000);
    }

    async checkHealth() {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000);
            
            const response = await fetch('/api/health', {
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            
            if (response.ok) {
                const data = await response.json();
                this.serverOnline = true;
                this.updateHealthStatus();
            } else {
                this.serverOnline = false;
                this.updateHealthStatus();
            }
        } catch (error) {
            this.serverOnline = false;
            this.updateHealthStatus();
        }
    }

    updateHealthStatus() {
        // Check microphone permission status
        const micDenied = this.wakeWordStatus.classList.contains('inactive');
        
        this.healthIndicator.classList.remove('online', 'offline', 'warning');
        
        if (!this.serverOnline) {
            this.healthIndicator.classList.add('offline');
            this.healthText.textContent = 'Server offline - run: python app.py';
            this.recordBtn.disabled = true;
            this.sendBtn.disabled = true;
        } else if (micDenied) {
            this.healthIndicator.classList.add('warning');
            this.healthText.textContent = 'Server online • Mic permission needed';
            this.recordBtn.disabled = false;
            this.sendBtn.disabled = false;
        } else {
            this.healthIndicator.classList.add('online');
            this.healthText.textContent = 'Ready • Say "GitHub" to start';
            this.recordBtn.disabled = false;
            this.sendBtn.disabled = false;
        }
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.voiceCopilot = new VoiceCopilot();
});
