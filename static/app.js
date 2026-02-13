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
        this.cwdBreadcrumbs = document.getElementById('cwd-breadcrumbs');
        this.muteBadge = document.getElementById('mute-badge');
        this.sessionIdValue = document.getElementById('session-id-value');
        this.newSessionBtn = document.getElementById('new-session-btn');
        
        // Folder picker elements
        this.folderPickerModal = document.getElementById('folder-picker-modal');
        this.folderTree = document.getElementById('folder-tree');
        this.folderPickerCurrent = document.getElementById('folder-picker-current');
        this.folderPickerUp = document.getElementById('folder-picker-up');
        this.folderPickerHome = document.getElementById('folder-picker-home');
        this.folderPickerDrives = document.getElementById('folder-picker-drives');
        this.folderPickerSelect = document.getElementById('folder-picker-select');
        this.currentBrowsePath = null;
        
        // Process steps indicator
        this.processSteps = document.getElementById('process-steps');
        
        // Activity status bar
        this.activityStatus = document.getElementById('activity-status');
        this.activityVerb = document.getElementById('activity-verb');
        this.activityText = document.getElementById('activity-text');
        this.activityInterval = null;

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
        this.isMuted = false;  // TTS mute state
        this.currentAudio = null;  // Current playing audio for stopping mid-speech
        this.isSpeaking = false;  // Track if TTS is currently playing
        this.useStreaming = true;  // Enable streaming by default
        this.currentStreamingMessage = null;  // Reference to streaming message element

        // Wake words
        this.wakeWords = ['copilot', 'github', 'hey copilot', 'hey github'];
        this.stopWords = ['stop listening'];
        this.abortWords = ['abort', 'cancel', 'nevermind', 'never mind'];
        this.extendWords = ['extend', 'continue', 'add more', 'keep going'];
        this.triggeredByVoice = false;
        this.autoSubmitActive = false;
        this.pendingExtendText = '';  // Text to prepend when extending

        // Directory change detection
        this.cdKeywords = ['change directory', 'change working directory', 'cd to', 'switch to folder', 'go to folder', 'open folder', 'navigate to'];
        this.selectionWords = {
            'option 1': 0, 'option one': 0, 'first': 0, 'first one': 0,
            'option 2': 1, 'option two': 1, 'second': 1, 'second one': 1,
            'option 3': 2, 'option three': 2, 'third': 2, 'third one': 2
        };
        this.isSelectingDirectory = false;

        // Mute/unmute keywords
        this.muteKeywords = ['mute copilot', 'mute voice', 'go silent', 'be quiet', 'silence'];
        this.unmuteKeywords = ['unmute copilot', 'unmute voice', 'speak again', 'voice on'];
        this.pendingDirectoryOptions = [];

        this.init();
    }

    init() {
        // Check for saved working directory or show picker
        this.initWorkingDirectory();
        
        // Check for first run experience
        this.checkFirstRun();
        
        // Initialize mute badge
        this.updateMuteBadge();
        if (this.muteBadge) {
            this.muteBadge.addEventListener('click', () => {
                this.handleMuteCommand(this.isMuted ? 'unmute' : 'mute');
            });
        }
        
        // Initialize folder picker buttons
        this.initFolderPicker();
        
        // New session button handler
        if (this.newSessionBtn) {
            this.newSessionBtn.addEventListener('click', () => window.location.reload());
        }
        
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
            // PTT OFF mode: click to toggle recording
            else if (!this.pushToTalkMode && !this.triggeredByVoice) {
                e.preventDefault();
                if (this.isRecording) {
                    this.stopRecording();
                } else {
                    this.startRecording(false);
                }
            }
        });
        
        this.recordBtn.addEventListener('mousedown', () => {
            // Only use hold-to-record if in PTT mode (PTT = hold to record)
            if (!this.isRecording && this.pushToTalkMode) {
                this.startRecording(false);  // Button-triggered
            }
        });
        this.recordBtn.addEventListener('mouseup', () => {
            // Only stop on mouseup if it was button-triggered (hold to record) and in PTT mode
            if (this.isRecording && !this.triggeredByVoice && this.pushToTalkMode) {
                this.stopRecording();
            }
        });
        this.recordBtn.addEventListener('mouseleave', () => {
            if (this.isRecording && !this.triggeredByVoice && this.pushToTalkMode) {
                this.stopRecording();
            }
        });

        // Touch support for mobile
        this.recordBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            if (this.isRecording && this.triggeredByVoice) {
                // Tap to stop voice-triggered recording
                this.stopRecording();
            } else if (!this.pushToTalkMode) {
                // PTT OFF mode: tap to toggle
                if (this.isRecording) {
                    this.stopRecording();
                } else {
                    this.startRecording(false);
                }
            } else if (!this.isRecording) {
                // PTT ON mode: hold to record (start on touch)
                this.startRecording(false);
            }
        });
        this.recordBtn.addEventListener('touchend', (e) => {
            e.preventDefault();
            // Only stop on touchend if it was button-triggered AND in PTT mode (hold behavior)
            if (this.isRecording && !this.triggeredByVoice && this.pushToTalkMode) {
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
        
        // Set up click-to-copy for session ID
        this.setupSessionIdCopy();
    }

    setupSessionIdCopy() {
        const sessionIdContainer = document.getElementById('session-id');
        if (sessionIdContainer) {
            sessionIdContainer.style.cursor = 'pointer';
            sessionIdContainer.title = 'Click to copy session ID';
            sessionIdContainer.addEventListener('click', () => {
                const sessionId = this.sessionIdValue?.textContent;
                if (sessionId) {
                    navigator.clipboard.writeText(sessionId).then(() => {
                        // Show feedback
                        const originalText = sessionIdContainer.innerHTML;
                        sessionIdContainer.innerHTML = '📋 Copied!';
                        sessionIdContainer.classList.add('copied');
                        setTimeout(() => {
                            sessionIdContainer.innerHTML = originalText;
                            sessionIdContainer.classList.remove('copied');
                        }, 1500);
                    }).catch(err => {
                        console.error('Failed to copy session ID:', err);
                    });
                }
            });
        }
    }

    updateSessionId(sessionId) {
        // Update session ID display with Copilot session GUID
        const sessionIdContainer = document.getElementById('session-id');
        if (sessionIdContainer && this.sessionIdValue) {
            if (sessionId) {
                // Show full GUID and make container visible
                this.sessionIdValue.textContent = sessionId;
                sessionIdContainer.style.display = 'block';
            } else {
                // Hide until session exists
                sessionIdContainer.style.display = 'none';
            }
        }
    }

    checkFirstRun() {
        const hasSeenIntro = localStorage.getItem('voiceCopilot_hasSeenIntro');
        
        if (!hasSeenIntro) {
            const modal = document.getElementById('first-run-modal');
            const dismissBtn = document.getElementById('first-run-dismiss');
            
            if (modal && dismissBtn) {
                modal.style.display = 'flex';
                
                dismissBtn.addEventListener('click', () => {
                    modal.style.display = 'none';
                    localStorage.setItem('voiceCopilot_hasSeenIntro', 'true');
                });
                
                // Also dismiss on clicking overlay background
                modal.addEventListener('click', (e) => {
                    if (e.target === modal) {
                        modal.style.display = 'none';
                        localStorage.setItem('voiceCopilot_hasSeenIntro', 'true');
                    }
                });
            }
        }
    }

    checkSupport() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            this.showError('Microphone access not supported in this browser');
            this.recordBtn.disabled = true;
        }
    }

    initWakeWordDetection() {
        // Use MediaRecorder for offline-compatible wake word detection
        this.wakeWordActive = false;
        this.wakeWordStream = null;
        this.wakeWordRecorder = null;
        this.wakeWordLoopTimer = null;
        
        // Start if permission granted (checked in checkSupport)
        this.startWakeWordDetection();
    }

    async startWakeWordDetection() {
        if (this.wakeWordActive) return;
        
        try {
            // Re-acquire stream if needed
            if (!this.wakeWordStream || !this.wakeWordStream.active) {
                this.wakeWordStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            }
            
            this.wakeWordActive = true;
            this.wakeWordStatus.innerHTML = '<span class="indicator"></span> Listening for wake word...';
            this.wakeWordStatus.classList.remove('inactive');
            
            this.runWakeWordLoop();
        } catch (e) {
            console.warn('Could not start wake word detection:', e);
            this.wakeWordStatus.innerHTML = '<span class="indicator" style="background: #cf222e;"></span> Mic error';
        }
    }

    runWakeWordLoop() {
        if (!this.wakeWordActive || !this.wakeWordStream || !this.wakeWordStream.active) return;
        
        // Record for 1.5 seconds
        try {
            const recorder = new MediaRecorder(this.wakeWordStream);
            const chunks = [];
            
            recorder.ondataavailable = e => {
                if (e.data.size > 0) chunks.push(e.data);
            };
            
            recorder.onstop = async () => {
                // Process only if we are still active
                if (!this.wakeWordActive) return;
                
                // Restart loop immediately to minimize gap
                this.runWakeWordLoop();
                
                // Process audio
                if (chunks.length > 0) {
                    const blob = new Blob(chunks, { type: 'audio/webm' });
                    this.processWakeWordAudio(blob);
                }
            };
            
            recorder.start();
            // Stop after 1.5s
            this.wakeWordLoopTimer = setTimeout(() => {
                if (recorder.state === 'recording') recorder.stop();
            }, 1500);
            
        } catch (e) {
            console.error('Wake word loop error:', e);
            this.wakeWordActive = false;
        }
    }

    async processWakeWordAudio(blob) {
        try {
            const formData = new FormData();
            formData.append('audio', blob, 'wake.webm');
            
            const response = await fetch('/api/wake-detect', {
                method: 'POST',
                body: formData
            });
            
            if (!response.ok) return;
            
            const data = await response.json();
            if (data.text) {
                this.handleWakeWordText(data.text);
            }
        } catch (e) {
            // Ignore fetch errors (offline etc)
        }
    }

    handleWakeWordText(text) {
        text = text.toLowerCase().trim();
        if (!text) return;
        
        // Logic from original SpeechRecognition.onresult
        
        // Check for mute/unmute commands (only when not recording)
        if (!this.isRecording) {
            const muteAction = this.detectMuteCommand(text);
            if (muteAction) {
                console.log('Mute command detected:', muteAction);
                this.transcript.textContent = muteAction === 'mute' ? 'Muting voice...' : 'Unmuting voice...';
                this.handleMuteCommand(muteAction);
                return;
            }
        }
        
        // Check for wake words (only when not recording)
        if (!this.isRecording) {
            for (const wake of this.wakeWords) {
                if (text.includes(wake)) {
                    console.log('Wake word detected:', wake);
                    this.transcript.textContent = `Wake word detected: "${wake}"`;
                    
                    if (this.isSpeaking) {
                        this.stopCurrentAudio();
                    }
                    
                    this.startRecording(true);
                    return;
                }
            }
        }
        
        // Check for stop words (only if voice-triggered recording)
        if (this.isRecording && this.triggeredByVoice) {
            for (const stop of this.stopWords) {
                if (text.includes(stop)) {
                    console.log('Stop word detected:', stop);
                    this.stopRecording();
                    return;
                }
            }
        }
        
        // Check for abort/extend (during auto-submit)
        if (this.autoSubmitActive && !this.isRecording) {
            for (const abort of this.abortWords) {
                if (text.includes(abort)) {
                    this.cancelAutoSubmit();
                    this.transcript.textContent = `Aborted: "${abort}"`;
                    return;
                }
            }
            
            for (const extend of this.extendWords) {
                if (text.includes(extend)) {
                    this.cancelAutoSubmit();
                    this.pendingExtendText = this.chatInput.value;
                    this.transcript.textContent = `Extending: "${extend}"`;
                    this.startRecording(true);
                    return;
                }
            }
        }
    }

    stopWakeWordDetection() {
        this.wakeWordActive = false;
        if (this.wakeWordLoopTimer) {
            clearTimeout(this.wakeWordLoopTimer);
            this.wakeWordLoopTimer = null;
        }
        // Do NOT stop the stream here because we might need it for re-starting
        // or if it's shared. But we should stop recording.
        // The recorder.stop() in loop handles cleanup.
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

        // Show process steps
        this.showProcessSteps();

        try {
            // Step 1: Transcribe
            this.setProcessStep('transcribe', 'active');
            this.startActivityStatus('transcribe');
            this.transcript.textContent = 'Transcribing...';
            const transcription = await this.transcribe(wavBlob);
            this.setProcessStep('transcribe', 'complete');
            this.stopActivityStatus();
            
            if (!transcription.text || transcription.text.trim() === '') {
                this.transcript.textContent = 'No speech detected';
                this.updateUI('ready');
                this.startWakeWordDetection();
                return;
            }

            // Put transcription in chat input (append if extending)
            if (this.pendingExtendText) {
                this.chatInput.value = this.pendingExtendText + ' ' + transcription.text;
                this.pendingExtendText = '';  // Clear pending text
                this.transcript.textContent = 'Extended transcription ready';
            } else {
                this.chatInput.value = transcription.text;
                this.transcript.textContent = 'Voice transcription ready';
            }
            this.chatInput.classList.add('voice-input');
            this.isVoiceInput = true;
            this.updateUI('ready');

            // Start auto-submit countdown (2 seconds)
            this.startAutoSubmit();

        } catch (error) {
            console.error('Error processing recording:', error);
            this.showError('Error: ' + error.message);
            this.stopActivityStatus();
            this.updateUI('ready');
        }

        this.startWakeWordDetection();
    }

    startAutoSubmit() {
        this.cancelAutoSubmit();
        let countdown = 4;
        this.autoSubmitActive = true;
        
        this.autoSubmitTimer.textContent = `Auto-sending in ${countdown}s... (say "abort" or "extend")`;
        
        const tick = () => {
            countdown--;
            if (countdown > 0) {
                this.autoSubmitTimer.textContent = `Auto-sending in ${countdown}s... (say "abort" or "extend")`;
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
        const allStopWords = [...this.stopWords, ...this.abortWords, ...this.extendWords];
        
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

        // Check if we're in directory selection mode
        if (this.isSelectingDirectory) {
            const selection = this.checkDirectorySelection(message);
            if (selection !== null) {
                this.cancelAutoSubmit();
                this.chatInput.value = '';
                await this.selectDirectory(selection);
                return;
            }
            // Check for cancel
            if (this.abortWords.some(w => message.toLowerCase().includes(w))) {
                this.cancelDirectorySelection();
                return;
            }
        }

        // Check if this is a directory change command
        const cdMatch = this.detectCdCommand(message);
        if (cdMatch) {
            this.cancelAutoSubmit();
            this.chatInput.value = '';
            this.chatInput.classList.remove('voice-input');
            this.isVoiceInput = false;
            this.transcript.textContent = '';
            await this.handleCdCommand(cdMatch);
            return;
        }

        this.cancelAutoSubmit();
        this.chatInput.value = '';
        this.chatInput.classList.remove('voice-input');
        this.isVoiceInput = false;
        this.transcript.textContent = '';

        // Add user message to conversation
        this.addMessage('user', message);

        // Show process steps and set thinking as active
        this.showProcessSteps();
        this.setProcessStep('transcribe', 'complete');  // Already done if voice input
        this.setProcessStep('thinking', 'active');
        this.startActivityStatus('thinking');

        // Send to Copilot
        this.updateUI('processing');
        this.status.innerHTML = 'Thinking<span class="loading"></span>';
        this.sendBtn.disabled = true;

        try {
            let response;
            
            if (this.useStreaming) {
                // Use streaming for real-time response
                this.addStreamingMessage();
                
                response = await this.sendToCopilotStreaming(
                    message,
                    // onDelta - update streaming message with each chunk
                    (content) => {
                        this.updateStreamingMessage(content);
                    },
                    // onIntent - update activity status
                    (intent) => {
                        this.updateActivityText(intent);
                    },
                    // onToolStart - show tool execution
                    (toolName) => {
                        this.startActivityStatus('tool', toolName);
                    },
                    // onToolComplete
                    (toolName) => {
                        this.startActivityStatus('thinking');
                    }
                );
                
                // Finalize the streaming message
                this.finalizeStreamingMessage(response.response);
            } else {
                // Non-streaming fallback
                response = await this.sendToCopilot(message);
                this.addMessage('copilot', response.response);
            }
            
            this.setProcessStep('thinking', 'complete');
            
            // Update session ID if returned
            if (response.session_id) {
                this.updateSessionId(response.session_id);
            }

            // Keep wake word detection active during speech so user can interrupt
            // (Previously we stopped it here, but now we allow interruption)
            
            // Speak the response
            this.setProcessStep('speaking', 'active');
            this.startActivityStatus('speaking');
            this.updateUI('speaking');
            await this.speak(response.voice_status || response.response);
            this.setProcessStep('speaking', 'complete');
            this.stopActivityStatus();

            this.updateUI('ready');
            
            // Refresh CWD in case it changed
            this.fetchCwd();
            
            // Ensure wake word detection is running (restart if needed)
            this.startWakeWordDetection();
        } catch (error) {
            console.error('Error sending message:', error);
            // Clean up streaming message if it exists
            if (this.currentStreamingMessage) {
                this.finalizeStreamingMessage('Error: ' + error.message);
            }
            this.showError('Error: ' + error.message);
            this.stopActivityStatus();
            this.updateUI('ready');
            this.startWakeWordDetection();
        }

        this.sendBtn.disabled = false;
    }

    async fetchCwd() {
        try {
            const response = await fetch('/api/cwd');
            if (response.ok) {
                const data = await response.json();
                this.renderCwdBreadcrumbs(data.segments);
            }
        } catch (error) {
            console.warn('Could not fetch CWD:', error);
            this.cwdBreadcrumbs.innerHTML = '<span class="cwd-loading">Loading...</span>';
        }
    }

    renderCwdBreadcrumbs(segments) {
        if (!this.cwdBreadcrumbs || !segments || segments.length === 0) return;
        
        this.cwdBreadcrumbs.innerHTML = '';
        
        segments.forEach((segment, index) => {
            if (!segment) return;
            
            // Add separator before segments (except first)
            if (index > 0) {
                const sep = document.createElement('span');
                sep.className = 'cwd-separator';
                sep.textContent = '>';
                this.cwdBreadcrumbs.appendChild(sep);
            }
            
            const segEl = document.createElement('span');
            segEl.className = 'cwd-segment';
            if (index === segments.length - 1) {
                segEl.classList.add('current');
            }
            segEl.textContent = segment;
            
            // Click to navigate to that path
            const pathToHere = segments.slice(0, index + 1).join('\\');
            segEl.addEventListener('click', () => this.changeCwd(pathToHere));
            
            this.cwdBreadcrumbs.appendChild(segEl);
        });
    }

    async changeCwd(newPath) {
        try {
            const response = await fetch('/api/cwd', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: newPath })
            });
            
            if (response.ok) {
                const data = await response.json();
                this.renderCwdBreadcrumbs(data.segments);
                this.transcript.textContent = `Changed to: ${data.cwd}`;
            } else {
                const error = await response.json();
                this.showError(error.error || 'Could not change directory');
            }
        } catch (error) {
            console.error('Error changing CWD:', error);
            this.showError('Could not change directory');
        }
    }

    // Mute/unmute voice command methods
    detectMuteCommand(message) {
        const lowerMsg = message.toLowerCase();
        for (const keyword of this.muteKeywords) {
            if (lowerMsg.includes(keyword)) {
                return 'mute';
            }
        }
        for (const keyword of this.unmuteKeywords) {
            if (lowerMsg.includes(keyword)) {
                return 'unmute';
            }
        }
        return null;
    }

    handleMuteCommand(action) {
        if (action === 'mute') {
            this.isMuted = true;
            this.stopCurrentAudio();
            this.updateMuteBadge();
            this.addMessage('copilot', '🔇 Voice muted. Say "unmute copilot" to re-enable.');
            this.transcript.textContent = 'Voice muted';
        } else {
            this.isMuted = false;
            this.updateMuteBadge();
            this.addMessage('copilot', '🔊 Voice unmuted.');
            this.speak('Voice unmuted');
            this.transcript.textContent = 'Voice unmuted';
        }
        this.updateUI('ready');
        this.startWakeWordDetection();
    }

    updateMuteBadge() {
        if (this.muteBadge) {
            this.muteBadge.classList.toggle('active', this.isMuted);
            this.muteBadge.textContent = this.isMuted ? '🔇 Muted' : '🔊';
        }
    }

    stopCurrentAudio() {
        if (this.currentAudio) {
            this.currentAudio.pause();
            this.currentAudio.currentTime = 0;
            this.currentAudio = null;
        }
        // Also stop browser TTS if active
        if ('speechSynthesis' in window) {
            speechSynthesis.cancel();
        }
        this.isSpeaking = false;
    }

    // Folder picker methods
    async initWorkingDirectory() {
        const savedCwd = localStorage.getItem('voiceCopilot_cwd');
        
        if (savedCwd) {
            // Restore saved directory
            try {
                const response = await fetch('/api/cwd', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: savedCwd })
                });
                
                if (response.ok) {
                    this.fetchCwd();
                    return;
                }
            } catch (error) {
                console.warn('Could not restore saved CWD:', error);
            }
        }
        
        // No saved directory or restore failed - show picker
        this.showFolderPicker();
    }

    initFolderPicker() {
        if (this.folderPickerUp) {
            this.folderPickerUp.addEventListener('click', () => this.browseParent());
        }
        if (this.folderPickerHome) {
            this.folderPickerHome.addEventListener('click', () => this.browseHome());
        }
        if (this.folderPickerDrives) {
            this.folderPickerDrives.addEventListener('click', () => this.browseDrives());
        }
        if (this.folderPickerSelect) {
            this.folderPickerSelect.addEventListener('click', () => this.selectFolder());
        }
        
        // Also make CWD breadcrumbs clickable to open picker
        if (this.cwdBreadcrumbs) {
            this.cwdBreadcrumbs.parentElement.addEventListener('dblclick', () => {
                this.showFolderPicker();
            });
        }
    }

    async showFolderPicker() {
        if (this.folderPickerModal) {
            this.folderPickerModal.style.display = 'flex';
            
            // Start at saved path, current CWD, or home
            const savedCwd = localStorage.getItem('voiceCopilot_cwd');
            if (savedCwd) {
                this.browsePath(savedCwd);
            } else {
                this.browseHome();
            }
        }
    }

    hideFolderPicker() {
        if (this.folderPickerModal) {
            this.folderPickerModal.style.display = 'none';
        }
    }

    async browseHome() {
        try {
            const response = await fetch('/api/filesystem/home');
            if (response.ok) {
                const data = await response.json();
                this.browsePath(data.path);
            }
        } catch (error) {
            console.error('Error getting home directory:', error);
        }
    }

    async browseDrives() {
        try {
            const response = await fetch('/api/filesystem/drives');
            if (response.ok) {
                const data = await response.json();
                this.currentBrowsePath = null;
                this.folderPickerCurrent.textContent = 'Drives';
                this.folderPickerUp.disabled = true;
                this.renderFolderTree(data.drives);
            }
        } catch (error) {
            console.error('Error getting drives:', error);
        }
    }

    async browseParent() {
        if (this.currentBrowsePath) {
            const parent = this.currentBrowsePath.split('\\').slice(0, -1).join('\\');
            if (parent) {
                this.browsePath(parent);
            } else {
                this.browseDrives();
            }
        }
    }

    async browsePath(path) {
        try {
            const response = await fetch(`/api/filesystem/browse?path=${encodeURIComponent(path)}`);
            if (response.ok) {
                const data = await response.json();
                this.currentBrowsePath = data.path;
                this.folderPickerCurrent.textContent = data.path;
                this.folderPickerUp.disabled = !data.parent;
                this.renderFolderTree(data.entries);
            } else {
                const error = await response.json();
                this.folderTree.innerHTML = `<div class="folder-empty">Error: ${error.error}</div>`;
            }
        } catch (error) {
            console.error('Error browsing path:', error);
            this.folderTree.innerHTML = `<div class="folder-empty">Error loading directory</div>`;
        }
    }

    renderFolderTree(entries) {
        if (!this.folderTree) return;
        
        if (!entries || entries.length === 0) {
            this.folderTree.innerHTML = '<div class="folder-empty">No subfolders</div>';
            return;
        }
        
        this.folderTree.innerHTML = '';
        
        entries.forEach(entry => {
            const item = document.createElement('div');
            item.className = 'folder-item';
            item.innerHTML = `
                <span class="folder-icon">📁</span>
                <span class="folder-name">${entry.name}</span>
                ${entry.hasChildren ? '<span class="folder-expand">▶</span>' : ''}
            `;
            
            item.addEventListener('click', () => {
                // Navigate into folder on single click
                this.browsePath(entry.path);
            });
            
            this.folderTree.appendChild(item);
        });
    }

    async selectFolder() {
        const path = this.currentBrowsePath;
        if (!path) return;
        
        try {
            const response = await fetch('/api/cwd', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path })
            });
            
            if (response.ok) {
                // Save to localStorage
                localStorage.setItem('voiceCopilot_cwd', path);
                
                this.hideFolderPicker();
                this.fetchCwd();
                this.transcript.textContent = `Working directory set to: ${path}`;
            } else {
                const error = await response.json();
                this.transcript.textContent = error.error || 'Could not set directory';
            }
        } catch (error) {
            console.error('Error selecting folder:', error);
        }
    }

    // Directory change voice command methods
    detectCdCommand(message) {
        const lowerMsg = message.toLowerCase();
        for (const keyword of this.cdKeywords) {
            const idx = lowerMsg.indexOf(keyword);
            if (idx !== -1) {
                // Extract the directory query after the keyword
                const query = message.slice(idx + keyword.length).trim();
                return query || null;
            }
        }
        return null;
    }

    async handleCdCommand(query) {
        this.updateUI('processing');
        this.status.innerHTML = 'Finding directories<span class="loading"></span>';
        this.addMessage('user', `Change directory to: ${query}`);

        try {
            const response = await fetch('/api/cwd/suggest', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Could not find directories');
            }

            const data = await response.json();
            this.pendingDirectoryOptions = data.options;
            this.showDirectoryOptions(data.options);

        } catch (error) {
            console.error('Error finding directories:', error);
            this.showError('Could not find matching directories');
            this.updateUI('ready');
            this.startWakeWordDetection();
        }
    }

    showDirectoryOptions(options) {
        this.isSelectingDirectory = true;
        
        // Build options message
        let optionsText = 'Which directory?\n\n';
        options.forEach((opt, i) => {
            optionsText += `Option ${i + 1}: ${opt.name}\n`;
        });
        optionsText += '\nSay "option 1", "option 2", or "option 3" to select, or "cancel" to abort.';
        
        this.addMessage('copilot', optionsText);

        // Speak the options
        const speakText = options.map((opt, i) => `Option ${i + 1}: ${opt.name}`).join('. ');
        this.updateUI('speaking');
        this.speak(`Which directory? ${speakText}. Say option 1, 2, or 3 to select.`).then(() => {
            this.updateUI('ready');
            this.startWakeWordDetection();
        });
    }

    checkDirectorySelection(message) {
        const lowerMsg = message.toLowerCase().trim();
        for (const [phrase, index] of Object.entries(this.selectionWords)) {
            if (lowerMsg.includes(phrase)) {
                return index;
            }
        }
        return null;
    }

    async selectDirectory(index) {
        if (index < 0 || index >= this.pendingDirectoryOptions.length) {
            this.showError('Invalid option');
            return;
        }

        const selected = this.pendingDirectoryOptions[index];
        this.isSelectingDirectory = false;
        this.pendingDirectoryOptions = [];

        this.updateUI('processing');
        this.status.innerHTML = 'Changing directory<span class="loading"></span>';

        try {
            const response = await fetch('/api/cwd/select', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: selected.path })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Could not change directory');
            }

            const data = await response.json();
            this.renderCwdBreadcrumbs(data.segments);
            
            const confirmMsg = `Changed to ${data.message}`;
            this.addMessage('copilot', confirmMsg);
            
            this.updateUI('speaking');
            await this.speak(confirmMsg);
            this.updateUI('ready');
            this.startWakeWordDetection();

        } catch (error) {
            console.error('Error selecting directory:', error);
            this.showError('Could not change directory');
            this.updateUI('ready');
            this.startWakeWordDetection();
        }
    }

    cancelDirectorySelection() {
        this.isSelectingDirectory = false;
        this.pendingDirectoryOptions = [];
        this.cancelAutoSubmit();
        this.chatInput.value = '';
        this.transcript.textContent = 'Directory selection cancelled';
        this.addMessage('copilot', 'Directory selection cancelled.');
        this.updateUI('ready');
        this.startWakeWordDetection();
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

    async sendToCopilotStreaming(message, onDelta, onIntent, onToolStart, onToolComplete) {
        /**
         * Send message to Copilot with streaming support via SSE
         * @param {string} message - The message to send
         * @param {function} onDelta - Callback for text chunks: (content) => void
         * @param {function} onIntent - Callback for intent updates: (intent) => void
         * @param {function} onToolStart - Callback when tool starts: (toolName) => void
         * @param {function} onToolComplete - Callback when tool completes: (toolName) => void
         * @returns {Promise<{response: string, voice_status: string, session_id: string}>}
         */
        console.log('[STREAM] Starting streaming request:', message);
        
        return new Promise((resolve, reject) => {
            // Use fetch with ReadableStream for SSE
            fetch('/api/chat/stream', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message })
            }).then(response => {
                if (!response.ok) {
                    throw new Error('Stream request failed');
                }
                
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';
                let collectedContent = '';
                let sessionId = null;
                let voiceStatus = '';
                
                const processChunk = ({ done, value }) => {
                    if (done) {
                        console.log('[STREAM] Stream ended');
                        resolve({
                            response: collectedContent,
                            voice_status: voiceStatus,
                            session_id: sessionId
                        });
                        return;
                    }
                    
                    buffer += decoder.decode(value, { stream: true });
                    
                    // Process complete SSE messages (data: ...\n\n)
                    const lines = buffer.split('\n\n');
                    buffer = lines.pop() || '';  // Keep incomplete line in buffer
                    
                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            try {
                                const event = JSON.parse(line.substring(6));
                                console.log('[STREAM] Event:', event.type);
                                
                                switch (event.type) {
                                    case 'session':
                                        sessionId = event.session_id;
                                        break;
                                    
                                    case 'delta':
                                        collectedContent += event.content;
                                        if (onDelta) onDelta(event.content);
                                        break;
                                    
                                    case 'message':
                                        // Complete message (if not streaming deltas)
                                        collectedContent = event.content;
                                        if (onDelta) onDelta(event.content);
                                        break;
                                    
                                    case 'intent':
                                        if (onIntent) onIntent(event.intent);
                                        break;
                                    
                                    case 'tool_start':
                                        if (onToolStart) onToolStart(event.tool);
                                        break;
                                    
                                    case 'tool_complete':
                                        if (onToolComplete) onToolComplete(event.tool);
                                        break;
                                    
                                    case 'complete':
                                        collectedContent = event.content || collectedContent;
                                        voiceStatus = event.voice_status || '';
                                        sessionId = event.session_id || sessionId;
                                        break;
                                    
                                    case 'error':
                                        console.error('[STREAM] Error event:', event.message);
                                        reject(new Error(event.message));
                                        return;
                                    
                                    case 'turn_start':
                                    case 'turn_end':
                                    case 'tool_progress':
                                    case 'keepalive':
                                        // Informational, no action needed
                                        break;
                                }
                            } catch (e) {
                                console.warn('[STREAM] Failed to parse event:', line, e);
                            }
                        }
                    }
                    
                    // Continue reading
                    reader.read().then(processChunk).catch(reject);
                };
                
                reader.read().then(processChunk).catch(reject);
                
            }).catch(reject);
        });
    }

    addStreamingMessage() {
        /**
         * Add a placeholder message for streaming content
         * Returns the content element that can be updated
         */
        this.conversation.classList.add('active');
        
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message copilot streaming';
        
        const label = document.createElement('div');
        label.className = 'label';
        label.textContent = 'Copilot';
        
        const content = document.createElement('div');
        content.className = 'message-content';
        content.innerHTML = '<span class="streaming-cursor">▊</span>';
        
        messageDiv.appendChild(label);
        messageDiv.appendChild(content);
        this.conversation.appendChild(messageDiv);
        
        // Scroll to bottom
        this.conversation.scrollTop = this.conversation.scrollHeight;
        
        this.currentStreamingMessage = { div: messageDiv, content: content, text: '' };
        return this.currentStreamingMessage;
    }

    updateStreamingMessage(deltaText) {
        /**
         * Append text to the streaming message
         */
        if (!this.currentStreamingMessage) return;
        
        this.currentStreamingMessage.text += deltaText;
        const text = this.currentStreamingMessage.text;
        
        // Render markdown with cursor at end
        if (typeof marked !== 'undefined') {
            this.currentStreamingMessage.content.innerHTML = 
                marked.parse(text) + '<span class="streaming-cursor">▊</span>';
        } else {
            this.currentStreamingMessage.content.innerHTML = 
                text + '<span class="streaming-cursor">▊</span>';
        }
        
        // Scroll to bottom
        this.conversation.scrollTop = this.conversation.scrollHeight;
    }

    finalizeStreamingMessage(fullText) {
        /**
         * Finalize the streaming message with complete text
         */
        if (!this.currentStreamingMessage) return;
        
        const { div, content } = this.currentStreamingMessage;
        div.classList.remove('streaming');
        
        // Render final markdown without cursor
        if (typeof marked !== 'undefined') {
            content.innerHTML = marked.parse(fullText || '(empty response)');
        } else {
            content.textContent = fullText || '(empty response)';
        }
        
        // Add long-press to copy functionality
        let pressTimer = null;
        const startPress = () => {
            pressTimer = setTimeout(() => {
                navigator.clipboard.writeText(fullText).then(() => {
                    div.classList.add('copied');
                    this.transcript.textContent = '📋 Copied to clipboard!';
                    setTimeout(() => div.classList.remove('copied'), 1000);
                }).catch(err => console.error('Failed to copy:', err));
            }, 500);
        };
        const cancelPress = () => {
            if (pressTimer) {
                clearTimeout(pressTimer);
                pressTimer = null;
            }
        };
        
        div.addEventListener('mousedown', startPress);
        div.addEventListener('mouseup', cancelPress);
        div.addEventListener('mouseleave', cancelPress);
        div.addEventListener('touchstart', startPress);
        div.addEventListener('touchend', cancelPress);
        div.addEventListener('touchcancel', cancelPress);
        
        this.currentStreamingMessage = null;
    }

    async speak(text) {
        // Check if muted - skip TTS entirely
        if (this.isMuted) {
            console.log('[SPEAK] Muted, skipping TTS');
            return;
        }

        console.log('[SPEAK] Speaking text:', text);
        
        // Handle empty text
        if (!text || !text.trim()) {
            console.log('[SPEAK] Empty text, skipping');
            return;
        }
        
        this.isSpeaking = true;
        
        try {
            const response = await fetch('/api/speak', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text })
            });

            if (!response.ok) {
                // Fallback to browser TTS
                console.log('[SPEAK] API response not ok, falling back to browser TTS');
                return this.speakWithBrowserTTS(text);
            }

            const audioBlob = await response.blob();
            console.log('[SPEAK] Audio blob size:', audioBlob.size, 'type:', audioBlob.type);
            
            // Check for empty or too-small audio (just WAV header)
            if (audioBlob.size < 100) {
                console.log('[SPEAK] Audio too small, falling back to browser TTS');
                return this.speakWithBrowserTTS(text);
            }
            
            // Ensure blob has correct MIME type for WAV audio playback
            const wavBlob = new Blob([audioBlob], { type: 'audio/wav' });
            const audioUrl = URL.createObjectURL(wavBlob);
            const audio = new Audio(audioUrl);
            this.currentAudio = audio;
            
            return new Promise((resolve) => {
                audio.onended = () => {
                    console.log('[SPEAK] Audio playback ended');
                    URL.revokeObjectURL(audioUrl);
                    this.currentAudio = null;
                    this.isSpeaking = false;
                    resolve();
                };
                audio.onerror = (e) => {
                    console.error('[SPEAK] Audio error:', e);
                    URL.revokeObjectURL(audioUrl);
                    this.currentAudio = null;
                    this.isSpeaking = false;
                    this.speakWithBrowserTTS(text).then(resolve);
                };
                audio.play().then(() => {
                    console.log('[SPEAK] Audio playing');
                }).catch((e) => {
                    console.error('[SPEAK] play() failed:', e);
                    this.currentAudio = null;
                    this.isSpeaking = false;
                    URL.revokeObjectURL(audioUrl);
                    this.speakWithBrowserTTS(text).then(resolve);
                });
            });

        } catch (error) {
            console.warn('[SPEAK] Fetch failed, using browser TTS:', error);
            return this.speakWithBrowserTTS(text);
        } finally {
            // Ensure isSpeaking is reset if we exit early
            // (actual reset happens in onended/onerror for audio playback)
        }
    }

    speakWithBrowserTTS(text) {
        if (this.isMuted) {
            this.isSpeaking = false;
            return Promise.resolve();
        }
        
        // Handle empty text
        if (!text || !text.trim()) {
            console.log('[SPEAK] Empty text, skipping browser TTS');
            this.isSpeaking = false;
            return Promise.resolve();
        }
        
        this.isSpeaking = true;
        
        return new Promise((resolve) => {
            if ('speechSynthesis' in window) {
                const utterance = new SpeechSynthesisUtterance(text);
                utterance.rate = 1.1;
                utterance.onend = () => {
                    console.log('[SPEAK] Browser TTS ended');
                    this.isSpeaking = false;
                    resolve();
                };
                utterance.onerror = (e) => {
                    console.error('[SPEAK] Browser TTS error:', e);
                    this.isSpeaking = false;
                    resolve();
                };
                speechSynthesis.speak(utterance);
                console.log('[SPEAK] Browser TTS started');
            } else {
                console.warn('[SPEAK] No speechSynthesis support');
                this.isSpeaking = false;
                resolve();
            }
        });
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
        content.className = 'message-content';
        
        // Render markdown for Copilot responses, plain text for user messages
        if (type === 'copilot' && typeof marked !== 'undefined') {
            content.innerHTML = marked.parse(text || '(empty response)');
        } else {
            content.textContent = text || '(empty response)';
        }
        
        messageDiv.appendChild(label);
        messageDiv.appendChild(content);
        this.conversation.appendChild(messageDiv);
        
        // Add long-press to copy functionality
        let pressTimer = null;
        const startPress = () => {
            pressTimer = setTimeout(() => {
                navigator.clipboard.writeText(text).then(() => {
                    messageDiv.classList.add('copied');
                    this.transcript.textContent = '📋 Copied to clipboard!';
                    setTimeout(() => {
                        messageDiv.classList.remove('copied');
                    }, 1000);
                }).catch(err => {
                    console.error('Failed to copy:', err);
                });
            }, 500);  // 500ms long press
        };
        const cancelPress = () => {
            if (pressTimer) {
                clearTimeout(pressTimer);
                pressTimer = null;
            }
        };
        
        messageDiv.addEventListener('mousedown', startPress);
        messageDiv.addEventListener('mouseup', cancelPress);
        messageDiv.addEventListener('mouseleave', cancelPress);
        messageDiv.addEventListener('touchstart', startPress);
        messageDiv.addEventListener('touchend', cancelPress);
        messageDiv.addEventListener('touchcancel', cancelPress);
        
        // Scroll to bottom
        this.conversation.scrollTop = this.conversation.scrollHeight;
        console.log('[MESSAGE] Message added, conversation children:', this.conversation.children.length);
    }

    async resetSession() {
        console.log('[SESSION] Resetting session...');
        
        try {
            // Call backend to reset Copilot session
            const response = await fetch('/api/session/reset', { method: 'POST' });
            const data = await response.json();
            
            if (data.success) {
                // Clear conversation UI
                this.conversation.innerHTML = '';
                this.conversation.classList.remove('active');
                
                // Clear transcript and input
                this.transcript.textContent = '';
                this.chatInput.value = '';
                
                // Reset session ID display
                if (this.sessionIdValue) {
                    this.sessionIdValue.textContent = '';
                    document.getElementById('session-id').style.display = 'none';
                }
                
                // Reset context display
                const donutFill = document.getElementById('donut-fill');
                const contextPercent = document.getElementById('context-percent');
                if (donutFill) donutFill.setAttribute('stroke-dasharray', '0, 100');
                if (contextPercent) contextPercent.textContent = '0%';
                
                // Update status
                this.status.textContent = 'New session started';
                setTimeout(() => {
                    this.status.textContent = 'Ready';
                }, 2000);
                
                console.log('[SESSION] Session reset successfully');
            } else {
                console.error('[SESSION] Reset failed:', data);
            }
        } catch (error) {
            console.error('[SESSION] Reset error:', error);
            this.status.textContent = 'Failed to reset session';
        }
    }

    updateUI(state) {
        this.recordBtn.classList.remove('recording');
        this.status.classList.remove('recording', 'processing', 'speaking');

        switch (state) {
            case 'recording':
                this.recordBtn.classList.add('recording');
                // Show "Stop Listening" for all recording modes
                this.recordBtn.querySelector('.btn-text').textContent = 'Stop Listening';
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
                this.hideProcessSteps();
        }
    }

    // Process steps indicator methods
    showProcessSteps() {
        if (this.processSteps) {
            this.processSteps.style.display = 'flex';
            // Reset all steps
            this.processSteps.querySelectorAll('.process-step').forEach(step => {
                step.classList.remove('active', 'complete');
            });
        }
    }

    hideProcessSteps() {
        if (this.processSteps) {
            this.processSteps.style.display = 'none';
        }
    }

    setProcessStep(stepName, state) {
        // state: 'active', 'complete', or 'pending'
        if (!this.processSteps) return;
        
        const step = this.processSteps.querySelector(`[data-step="${stepName}"]`);
        if (step) {
            step.classList.remove('active', 'complete');
            if (state === 'active') {
                step.classList.add('active');
            } else if (state === 'complete') {
                step.classList.add('complete');
            }
        }
    }

    // Activity Status Bar - Copilot CLI-style cycling verbs
    startActivityStatus(phase, toolName = null) {
        if (!this.activityStatus || !this.activityVerb || !this.activityText) return;
        
        // Copilot CLI-inspired verb + context pairs
        const messages = {
            transcribe: [
                { verb: 'Listening', text: 'to your voice...' },
                { verb: 'Converting', text: 'speech to text...' },
                { verb: 'Processing', text: 'audio input...' },
                { verb: 'Decoding', text: 'your words...' }
            ],
            thinking: [
                { verb: 'Thinking', text: 'about your request...' },
                { verb: 'Analyzing', text: 'the context...' },
                { verb: 'Reasoning', text: 'through possibilities...' },
                { verb: 'Searching', text: 'for the best answer...' },
                { verb: 'Crafting', text: 'a thoughtful response...' },
                { verb: 'Connecting', text: 'the dots...' },
                { verb: 'Considering', text: 'different angles...' },
                { verb: 'Formulating', text: 'insights...' }
            ],
            speaking: [
                { verb: 'Speaking', text: 'the response...' },
                { verb: 'Reading', text: 'aloud for you...' }
            ],
            tool: [
                { verb: 'Running', text: toolName || 'a tool...' },
                { verb: 'Executing', text: toolName || 'command...' }
            ]
        };

        const phaseMessages = messages[phase] || messages.thinking;
        let index = 0;

        // Clear any existing interval
        this.stopActivityStatus();

        // Set initial message and show
        this.activityStatus.style.display = 'flex';
        this.activityStatus.className = `activity-status ${phase}`;
        this.activityVerb.textContent = phaseMessages[0].verb;
        this.activityText.textContent = phaseMessages[0].text;

        // Cycle through messages faster for more dynamic feel
        this.activityInterval = setInterval(() => {
            index = (index + 1) % phaseMessages.length;
            
            // Animate the verb
            this.activityVerb.style.animation = 'none';
            this.activityVerb.offsetHeight; // Trigger reflow
            this.activityVerb.style.animation = 'verbFade 0.4s ease-in-out';
            this.activityVerb.textContent = phaseMessages[index].verb;
            
            // Animate the text
            this.activityText.style.animation = 'none';
            this.activityText.offsetHeight; // Trigger reflow
            this.activityText.style.animation = 'textSlide 0.4s ease-in-out';
            this.activityText.textContent = phaseMessages[index].text;
        }, 1500);  // Faster cycling for more engagement
    }

    updateActivityText(intentText) {
        /**
         * Update activity status with intent from Copilot
         */
        if (!this.activityVerb || !this.activityText) return;
        
        // Stop cycling, show the actual intent
        if (this.activityInterval) {
            clearInterval(this.activityInterval);
            this.activityInterval = null;
        }
        
        this.activityVerb.textContent = 'Working on';
        this.activityText.textContent = intentText;
    }

    stopActivityStatus() {
        if (this.activityInterval) {
            clearInterval(this.activityInterval);
            this.activityInterval = null;
        }
        if (this.activityStatus) {
            this.activityStatus.style.display = 'none';
            this.activityStatus.className = 'activity-status';
        }
    }

    updateRecordButtonText() {
        if (this.pushToTalkMode) {
            this.recordBtn.querySelector('.btn-text').textContent = 'Hold to Record';
        } else {
            this.recordBtn.querySelector('.btn-text').textContent = 'Click to Record';
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
        setInterval(() => this.checkHealth(), 5000);
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
                // Update session ID from backend
                this.updateSessionId(data.session_id);
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
