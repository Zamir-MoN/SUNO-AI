/**
 * Modular Real-Time Voice Assistant Service (voiceAssistant.js)
 * Google Gemini Live API native audio streaming with fallback to chunked pipeline.
 *
 * Features:
 * - Persistent WebSocket session to backend bridge connected to Gemini Live (@google/genai SDK)
 * - Continuous Web Audio API mic capture downsampled to 16kHz 1-channel linear PCM
 * - Streaming audio playback queue using AudioContext buffer scheduling (24kHz PCM from Gemini Live)
 * - Real-time Voice Activity Detection (VAD) & Barge-in / interruption
 * - Live AnalyserNode audio level and frequency exposure for 3D ribbon / visualizer
 * - Native multi-turn conversational session state
 * - Automatic fallback pipeline (Web Speech STT -> LLM Stream -> TTS) if Live API is unavailable
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.VoiceAssistant = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Session State Enum
  const VoiceState = {
    IDLE: 'IDLE',
    CONNECTING: 'CONNECTING',
    READY: 'READY',
    LISTENING: 'LISTENING',
    USER_SPEAKING: 'USER_SPEAKING',
    THINKING: 'THINKING',
    AI_SPEAKING: 'AI_SPEAKING',
    INTERRUPTED: 'INTERRUPTED',
    ERROR: 'ERROR'
  };

  class VoiceAssistantService {
    constructor(options = {}) {
      this.options = Object.assign({
        wsUrl: null, // Default calculates from window.location
        vadThreshold: 0.02, // RMS threshold for speech detection
        silenceDurationMs: 650, // Silence window to commit user turn in fallback mode
        inputSampleRate: 16000,
        outputSampleRate: 24000,
        enableGeminiLive: true,
        onStateChange: null,
        onAudioLevel: null,
        onTranscript: null,
        onInterruption: null,
        onError: null
      }, options);

      this.state = VoiceState.IDLE;
      this.ws = null;
      this.isLiveApiMode = false;
      this.isMuted = false;

      // Web Audio Input
      this.audioContext = null;
      this.mediaStream = null;
      this.inputSource = null;
      this.inputAnalyser = null;
      this.scriptProcessor = null;
      this.userSpeechActive = false;
      this.vadSilenceTimer = null;

      // Web Audio Output (Buffer Queue for streaming PCM)
      this.outputAudioContext = null;
      this.outputAnalyser = null;
      this.audioQueue = []; // Array of Float32Array chunks
      this.isPlayingQueue = false;
      this.scheduledEndTime = 0;
      this.activeSources = [];

      // Fallback Engine (Web Speech STT + Browser TTS)
      this.fallbackSpeechRecognition = null;
      this.fallbackSpeechQueue = [];
      this.isFallbackPlaying = false;
      this.currentUtterance = null;
      this.interimDebounceTimer = null;
      this._hasSpokenIntro = false;

      // Analyser Shared State
      this.inputFreqData = new Uint8Array(64);
      this.outputFreqData = new Uint8Array(64);
      this.currentRMS = 0;
      this.animationLoopActive = false;

      // Always expose Live Developer Diagnostics globally
      window.auraAudioDiagnostics = () => {
        const t = this.mediaStream ? this.mediaStream.getAudioTracks()[0] : null;
        const diag = {
          "Microphone": t ? (t.readyState === 'live' ? 'OK' : t.readyState) : 'NOT DETECTED (Click Voice first)',
          "Device": this.selectedDeviceLabel || (t ? t.label : 'None'),
          "Track": t ? t.readyState : 'closed',
          "AudioContext": this.audioContext ? this.audioContext.state : 'null',
          "Input sample rate": this.audioContext ? this.audioContext.sampleRate : 0,
          "Output PCM rate": this.options.inputSampleRate,
          "RMS": (this.currentRMS / 100).toFixed(4),
          "WebSocket": this.ws ? (this.ws.readyState === WebSocket.OPEN ? 'OPEN' : this.ws.readyState) : 'DISCONNECTED',
          "Live session": this.isLiveApiMode ? 'READY (Gemini Native)' : 'READY (Streaming Fallback)',
          "Speech Recognition": this.fallbackSpeechRecognition ? (this._isSttRunning ? 'RUNNING' : 'ACTIVE') : 'IDLE',
          "Last Heard": this.lastReceivedTranscript || 'None'
        };
        console.table(diag);
        return diag;
      };
    }

    // ==========================================
    // STATE & EVENT DISPATCH
    // ==========================================
    _setState(newState, payload = {}) {
      if (this.isMuted && (newState === VoiceState.LISTENING || newState === VoiceState.USER_SPEAKING)) {
        return; // Never overwrite MUTED state automatically
      }
      if (this.state === newState && !payload.force) return;
      this.state = newState;
      if (typeof this.options.onStateChange === 'function') {
        try {
          this.options.onStateChange(this.state, payload);
        } catch (e) {
          console.error('[VoiceAssistant] onStateChange callback error:', e);
        }
      }
    }

    _emitError(message, details = null) {
      console.warn('[VoiceAssistant Error]:', message, details);
      this._setState(VoiceState.ERROR, { message, details });
      if (typeof this.options.onError === 'function') {
        try {
          this.options.onError(message, details);
        } catch (e) {}
      }
    }

    _emitTranscript(role, text, isFinal = true) {
      if (typeof this.options.onTranscript === 'function') {
        try {
          this.options.onTranscript({ role, text, isFinal });
        } catch (e) {}
      }
    }

    // ==========================================
    // AUDIO INPUT CAPTURE & RESAMPLING (16kHz PCM)
    // ==========================================
    async _initAudioInput(deviceId = null) {
      try {
        console.log('[Mic] Requesting microphone permission and preparing audio pipeline');
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!this.audioContext || this.audioContext.state === 'closed') {
          this.audioContext = new AudioContextClass();
        }
        if (this.audioContext.state === 'suspended') {
          await this.audioContext.resume();
        }

        if (this.mediaStream) {
          this.mediaStream.getTracks().forEach(t => t.stop());
          this.mediaStream = null;
        }

        const baseAudioConstraints = {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        };

        if (deviceId && deviceId !== 'default') {
          try {
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
              audio: { deviceId: { exact: deviceId } }
            });
          } catch (deviceConstraintErr) {
            console.warn('[Mic] Exact device constraint failed, falling back to default mic:', deviceConstraintErr);
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
              audio: true
            });
          }
        } else {
          this.mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: true
          });
        }

        const track = this.mediaStream.getAudioTracks()[0];
        console.log(`[Mic] Permission granted on "${track ? track.label : 'Default'}"`);
        this.selectedDeviceLabel = track ? track.label : 'Default';
        this.selectedDeviceId = deviceId || 'default';

        this.inputSource = this.audioContext.createMediaStreamSource(this.mediaStream);
        this.inputAnalyser = this.audioContext.createAnalyser();
        this.inputAnalyser.fftSize = 128;
        this.inputAnalyser.smoothingTimeConstant = 0.3;
        this.inputSource.connect(this.inputAnalyser);

        // Continuous PCM Streaming via ScriptProcessorNode / AudioWorklet
        const bufferSize = 2048;
        this.scriptProcessor = this.audioContext.createScriptProcessor(bufferSize, 1, 1);

        this.scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
          if (this.isMuted || this.state === VoiceState.IDLE) return;

          const inputBuffer = audioProcessingEvent.inputBuffer;
          const inputData = inputBuffer.getChannelData(0);

          // 1. Process Voice Activity Level (VAD) for glowing visualizer
          this._processVAD(inputData);

          // 2. If connected to native Gemini Live API session, forward PCM
          if (this.isLiveApiMode && this.ws && this.ws.readyState === WebSocket.OPEN) {
            const pcm16Data = this._resampleAndEncodePCM16(
              inputData,
              inputBuffer.sampleRate,
              this.options.inputSampleRate
            );
            if (pcm16Data && pcm16Data.byteLength > 0) {
              const base64Data = this._arrayBufferToBase64(pcm16Data);
              this.ws.send(JSON.stringify({
                type: 'live.pcm_chunk',
                data: base64Data
              }));
            }
          }
        };

        this.inputSource.connect(this.scriptProcessor);
        const silentGain = this.audioContext.createGain();
        silentGain.gain.value = 0;
        this.scriptProcessor.connect(silentGain);
        silentGain.connect(this.audioContext.destination);

        // Expose Live Developer Diagnostic Tool
        window.auraAudioDiagnostics = () => {
          const t = this.mediaStream ? this.mediaStream.getAudioTracks()[0] : null;
          const diag = {
            "Microphone": t ? (t.readyState === 'live' ? 'OK' : t.readyState) : 'NOT DETECTED',
            "Device": this.selectedDeviceLabel || (t ? t.label : 'None'),
            "Track": t ? t.readyState : 'closed',
            "AudioContext": this.audioContext ? this.audioContext.state : 'null',
            "Input sample rate": this.audioContext ? this.audioContext.sampleRate : 0,
            "Output PCM rate": this.options.inputSampleRate,
            "RMS": (this.currentRMS / 100).toFixed(4),
            "PCM conversion": this._framesCapturedCount > 0 ? 'OK' : 'PENDING',
            "WebSocket": this.ws ? (this.ws.readyState === WebSocket.OPEN ? 'OPEN' : this.ws.readyState) : 'DISCONNECTED',
            "Live session": this.isLiveApiMode ? 'READY (Gemini Native)' : 'READY (Streaming Fallback)',
            "Audio packets sent": this._totalPcmBytesSent > 0 ? 'YES' : 'NO',
            "Gemini transcription": this.lastReceivedTranscript ? 'RECEIVING' : 'WAITING'
          };
          console.table(diag);
          return diag;
        };

        return true;
      } catch (err) {
        console.warn('[VoiceAssistant] Direct audio capture initialization error:', err);
        let userMsg = 'Microphone unavailable';
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          userMsg = 'Microphone permission required';
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          userMsg = 'Microphone unavailable';
        } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
          userMsg = 'Microphone in use by another app';
        }
        this._emitError(userMsg, err);
        return false;
      }
    }

    _resampleAndEncodePCM16(inputData, fromSampleRate, toSampleRate) {
      if (fromSampleRate === toSampleRate) {
        return this._floatTo16BitPCM(inputData);
      }
      const ratio = fromSampleRate / toSampleRate;
      const targetLength = Math.round(inputData.length / ratio);
      const resampled = new Float32Array(targetLength);
      for (let i = 0; i < targetLength; i++) {
        const originalIndex = Math.min(Math.floor(i * ratio), inputData.length - 1);
        resampled[i] = inputData[originalIndex];
      }
      return this._floatTo16BitPCM(resampled);
    }

    _floatTo16BitPCM(floatArray) {
      const buffer = new ArrayBuffer(floatArray.length * 2);
      const view = new DataView(buffer);
      for (let i = 0; i < floatArray.length; i++) {
        const s = Math.max(-1, Math.min(1, floatArray[i]));
        view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true); // Little-endian
      }
      return buffer;
    }

    _arrayBufferToBase64(buffer) {
      let binary = '';
      const bytes = new Uint8Array(buffer);
      const len = bytes.byteLength;
      for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return window.btoa(binary);
    }

    _base64ToArrayBuffer(base64) {
      const binaryString = window.atob(base64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return bytes.buffer;
    }

    // ==========================================
    // VOICE ACTIVITY DETECTION (VAD) & BARGE-IN
    // ==========================================
    _processVAD(floatData) {
      let sum = 0;
      for (let i = 0; i < floatData.length; i++) {
        sum += floatData[i] * floatData[i];
      }
      const rms = Math.sqrt(sum / floatData.length);
      this.currentRMS = rms * 100; // Scaled 0 - 100

      // Track if we ever received a non-zero audio signal (> 0.003)
      if (rms > 0.005) {
        this._hasHeardNonZeroSignal = true;
        this._silentFramesCount = 0;
      } else {
        this._silentFramesCount = (this._silentFramesCount || 0) + 1;
      }

      // Check for zero-signal microphone warning (e.g. Steam Streaming Mic or muted mic)
      // 2048 samples at 48kHz is ~43ms. 45 frames is ~2 seconds of pure silence
      if (this._silentFramesCount > 45 && !this._hasHeardNonZeroSignal && this.state === VoiceState.LISTENING) {
        if (!this._warnedNoSignal) {
          this._warnedNoSignal = true;
          this._setState(VoiceState.LISTENING, {
            message: 'Microphone input detected but no audio signal.'
          });
        }
      } else if (this._hasHeardNonZeroSignal && this._warnedNoSignal) {
        this._warnedNoSignal = false;
        if (this.state === VoiceState.LISTENING) {
          this._setState(VoiceState.LISTENING, {
            message: 'Microphone audio detected.'
          });
        }
      }

      const isSpeech = rms > this.options.vadThreshold;

      if (isSpeech && !this.isMuted) {
        // Only trigger barge-in when live PCM is playing, NOT when browser TTS is speaking (to avoid self-echo cancelling speech)
        if (this.state === VoiceState.AI_SPEAKING && this.isPlayingQueue && !this.isFallbackPlaying) {
          this.interrupt();
        }

        if (!this.userSpeechActive) {
          this.userSpeechActive = true;
        }

        if (this.vadSilenceTimer) {
          clearTimeout(this.vadSilenceTimer);
          this.vadSilenceTimer = null;
        }
      } else {
        if (this.userSpeechActive && !this.vadSilenceTimer) {
          this.vadSilenceTimer = setTimeout(() => {
            this.userSpeechActive = false;
            this.vadSilenceTimer = null;

            // When user speech ends, signal end of turn to Gemini Live session if in Live API mode
            if (this.isLiveApiMode && this.ws && this.ws.readyState === WebSocket.OPEN) {
              this.ws.send(JSON.stringify({ type: 'live.activity_end' }));
            }
          }, this.options.silenceDurationMs);
        }
      }
    }

    // ==========================================
    // STREAMING AUDIO OUTPUT (24kHz PCM Buffer Queue)
    // ==========================================
    _initAudioOutput() {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!this.outputAudioContext || this.outputAudioContext.state === 'closed') {
        this.outputAudioContext = new AudioContextClass();
      }
      if (this.outputAudioContext.state === 'suspended') {
        this.outputAudioContext.resume();
      }

      if (!this.outputAnalyser) {
        this.outputAnalyser = this.outputAudioContext.createAnalyser();
        this.outputAnalyser.fftSize = 128;
        this.outputAnalyser.smoothingTimeConstant = 0.3;
        this.outputAnalyser.connect(this.outputAudioContext.destination);
      }
    }

    _enqueueIncomingPCMChunk(base64PCM, sampleRate = 24000) {
      this._initAudioOutput();

      const rawBuffer = this._base64ToArrayBuffer(base64PCM);
      const dataView = new DataView(rawBuffer);
      const numSamples = Math.floor(rawBuffer.byteLength / 2);
      const float32Array = new Float32Array(numSamples);

      for (let i = 0; i < numSamples; i++) {
        const int16 = dataView.getInt16(i * 2, true);
        float32Array[i] = int16 / 32768.0;
      }

      this.audioQueue.push({
        data: float32Array,
        sampleRate: sampleRate
      });

      if (!this.isPlayingQueue) {
        this._scheduleNextAudioChunk();
      }
    }

    _scheduleNextAudioChunk() {
      if (this.audioQueue.length === 0) {
        this.isPlayingQueue = false;
        if (this.state === VoiceState.AI_SPEAKING) {
          this._setState(VoiceState.LISTENING);
        }
        return;
      }

      this.isPlayingQueue = true;
      if (this.state !== VoiceState.AI_SPEAKING) {
        this._setState(VoiceState.AI_SPEAKING);
      }

      const chunk = this.audioQueue.shift();
      const ctx = this.outputAudioContext;
      const audioBuffer = ctx.createBuffer(1, chunk.data.length, chunk.sampleRate);
      audioBuffer.getChannelData(0).set(chunk.data);

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.outputAnalyser);

      const currentTime = ctx.currentTime;
      const startTime = Math.max(currentTime, this.scheduledEndTime);
      source.start(startTime);
      this.scheduledEndTime = startTime + audioBuffer.duration;

      this.activeSources.push(source);
      source.onended = () => {
        const idx = this.activeSources.indexOf(source);
        if (idx !== -1) this.activeSources.splice(idx, 1);
        if (this.audioQueue.length > 0) {
          this._scheduleNextAudioChunk();
        } else if (this.activeSources.length === 0) {
          this.isPlayingQueue = false;
          if (this.state === VoiceState.AI_SPEAKING) {
            this._setState(VoiceState.LISTENING);
          }
          if (this.fallbackSpeechRecognition && !this.isMuted) {
            try { this.fallbackSpeechRecognition.start(); } catch (e) {}
          }
        }
      };

      // Keep pre-scheduling next chunk to eliminate stutter
      if (this.audioQueue.length > 0) {
        this._scheduleNextAudioChunk();
      }
    }

    _stopAllAudioPlayback() {
      // 1. Stop PCM audio sources
      this.audioQueue = [];
      for (const src of this.activeSources) {
        try {
          src.stop();
          src.disconnect();
        } catch (e) {}
      }
      this.activeSources = [];
      this.scheduledEndTime = 0;
      this.isPlayingQueue = false;

      // 2. Stop Browser TTS fallback
      if (window.speechSynthesis) {
        try {
          window.speechSynthesis.cancel();
        } catch (e) {}
      }
      this.fallbackSpeechQueue = [];
      this.isFallbackPlaying = false;
      this.currentUtterance = null;
    }

    // ==========================================
    // BARGE-IN / INTERRUPTION METHOD
    // ==========================================
    interrupt() {
      console.log('[VoiceAssistant] Barge-in / Interruption triggered.');
      this._stopAllAudioPlayback();

      // Notify WebSocket backend to immediately abort model turn / flush server audio buffers
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'user.interruption' }));
      }

      this._setState(VoiceState.INTERRUPTED);
      if (typeof this.options.onInterruption === 'function') {
        try {
          this.options.onInterruption();
        } catch (e) {}
      }

      setTimeout(() => {
        if (this.state === VoiceState.INTERRUPTED) {
          this._setState(VoiceState.LISTENING);
        }
      }, 120);
    }

    // ==========================================
    // WEBSOCKET PERSISTENT SESSION & PROTOCOL
    // ==========================================
    connect(config = {}) {
      if (this.ws) {
        this.disconnect();
      }

      if (config.language) {
        this.selectedLang = config.language !== 'auto' ? config.language : (navigator.language || 'en-US');
      }

      // Synchronously create/resume AudioContexts on direct user gesture
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!this.audioContext || this.audioContext.state === 'closed') {
        this.audioContext = new AudioContextClass();
      }
      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume().catch(() => {});
      }

      if (!this.outputAudioContext || this.outputAudioContext.state === 'closed') {
        this.outputAudioContext = new AudioContextClass();
      }
      if (this.outputAudioContext.state === 'suspended') {
        this.outputAudioContext.resume().catch(() => {});
      }

      // Unlock browser SpeechSynthesis on user gesture
      if (window.speechSynthesis) {
        try {
          window.speechSynthesis.resume();
          window.speechSynthesis.getVoices();
        } catch (_) {}
      }

      this._setState(VoiceState.CONNECTING);
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = this.options.wsUrl || `${protocol}//${window.location.host}/voice-ws`;

      try {
        this.ws = new WebSocket(wsUrl);
      } catch (err) {
        this._emitError('WebSocket connection error: ' + err.message);
        return;
      }

      this.ws.onopen = async () => {
        console.log('[VoiceAssistant WS] Connected to backend gateway.');
        this._setState(VoiceState.READY);

        // Only capture raw microphone hardware stream when Gemini Live PCM streaming is explicitly active.
        // In streaming fallback mode, SpeechRecognition manages the hardware mic directly to prevent Android audio conflicts.
        if (this.isLiveApiMode) {
          await this._initAudioInput(config.deviceId);
        }
        this._initAudioOutput();
        this._startVisualizerLoop();

        // Send session initialization
        const savedSettings = JSON.parse(localStorage.getItem('aura_settings') || localStorage.getItem('chatgpt_settings') || '{}');
        const effectiveKey = config.apiKey || savedSettings.apiKey || '';

        this.ws.send(JSON.stringify({
          type: 'session.start',
          history: config.history || [],
          provider: config.provider || savedSettings.provider || 'gemini',
          apiKey: effectiveKey,
          enableGeminiLive: false,
          model: 'gemini-3.7-flash'
        }));

        this._setState(VoiceState.LISTENING);
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          switch (msg.type) {
            case 'session.ready':
              this.isLiveApiMode = false;
              console.log('[VoiceAssistant] Session established. Mode: High-Speed Streaming STT/TTS');
              
              const currentHistory = config.history || [];
              if (!this._hasSpokenIntro && currentHistory.length === 0) {
                this._hasSpokenIntro = true;
                this._setState(VoiceState.AI_SPEAKING);
                
                let introGreeting = "नमस्ते! मैं SUNO AI हूँ। मुझे सुदीप्त ने आपके भावनात्मक सहयोग और बातचीत के लिए बनाया है। बताइए, आज मैं आपकी क्या मदद कर सकती हूँ?";
                if (this.selectedLang === 'en-US') {
                  introGreeting = "Hello! I am SUNO AI, your compassionate companion. How can I support you today?";
                } else if (this.selectedLang === 'bn-IN') {
                  introGreeting = "নমস্কার! আমি SUNO AI। আমাকে সুদীপ্ত তৈরি করেছেন আপনার মানসিক সমর্থন ও বন্ধুত্বের জন্য। বলুন, আজ আপনাকে কীভাবে সাহায্য করতে পারি?";
                }
                this._lastAssistantSpokenText = introGreeting;
                this._emitTranscript('assistant', introGreeting, true);
                
                // Play intro greeting FIRST. Speech recognition will ONLY initialize after intro speech concludes!
                this._enqueueFallbackTTSChunk(introGreeting);
              } else {
                this._initFallbackSpeechRecognition();
                this._setState(VoiceState.LISTENING);
              }
              break;

            case 'live.input_transcript':
              if (msg.text) {
                this.lastReceivedTranscript = msg.text;
                console.log(`[Live] Input transcript: "${msg.text}" (final: ${!!msg.isFinal})`);
                this._emitTranscript('user', msg.text, !!msg.isFinal);
              }
              break;

            case 'live.audio_delta':
              // Streaming 24kHz PCM from Gemini Live
              if (msg.pcmBase64) {
                this._enqueueIncomingPCMChunk(msg.pcmBase64, msg.sampleRate || 24000);
              }
              if (msg.text) {
                // Filter internal model thought headers if any
                const cleanText = msg.text.replace(/\*\*Crafting[^*]+\*\*/gi, '').replace(/\*\*Thinking[^*]+\*\*/gi, '').trim();
                if (cleanText) {
                  this._emitTranscript('assistant', cleanText, false);
                }
              }
              break;

            case 'live.turn_complete':
              if (msg.fullText) {
                const cleanFull = msg.fullText.replace(/\*\*Crafting[^*]+\*\*/gi, '').replace(/\*\*Thinking[^*]+\*\*/gi, '').trim();
                this._emitTranscript('assistant', cleanFull, true);
                if (!this.isPlayingQueue && this.audioQueue.length === 0 && cleanFull) {
                  this._enqueueFallbackTTSChunk(cleanFull);
                }
              }
              if (!this.isPlayingQueue && this.audioQueue.length === 0 && !this.isFallbackPlaying) {
                this._setState(VoiceState.LISTENING);
              }
              break;

            case 'response.start':
              this._setState(VoiceState.THINKING);
              break;

            case 'response.delta':
              this._emitTranscript('assistant', msg.token, false);
              break;

            case 'response.audio_chunk':
              if (msg.text) {
                this._enqueueFallbackTTSChunk(msg.text);
              }
              break;

            case 'response.complete':
              this._emitTranscript('assistant', msg.text, true);
              // Only enqueue if not already queued via response.audio_chunk
              if (msg.text && this.fallbackSpeechQueue.length === 0 && !this.isFallbackPlaying) {
                this._enqueueFallbackTTSChunk(msg.text);
              } else if (!this.isFallbackPlaying && this.fallbackSpeechQueue.length === 0) {
                this._setState(VoiceState.LISTENING);
              }
              break;

            case 'interruption.ack':
              console.log('[VoiceAssistant] Backend acknowledged interruption.');
              break;

            case 'fallback.active':
              console.warn('[VoiceAssistant] Falling back to chunked pipeline:', msg.reason);
              this.isLiveApiMode = false;
              this._initFallbackSpeechRecognition();
              break;

            case 'error':
              this._emitError(msg.message);
              break;
          }
        } catch (e) {
          console.error('[VoiceAssistant] Error handling WebSocket message:', e);
        }
      };

      this.ws.onclose = (event) => {
        console.warn(`[VoiceAssistant WS] Closed. Code: ${event.code}, Reason: "${event.reason || 'None'}", WasClean: ${event.wasClean}`);
        if (this.state !== VoiceState.IDLE) {
          this._setState(VoiceState.IDLE, { message: 'Session closed' });
        }
      };

      this.ws.onerror = (e) => {
        console.warn('[VoiceAssistant WS Error]:', e);
        this._emitError('WebSocket communication error');
      };
    }

    // Switch microphone device dynamically without tearing down the WebSocket
    async switchMicrophone(deviceId) {
      console.log(`[Mic] Switching microphone to: ${deviceId}`);
      try {
        if (this.scriptProcessor) {
          this.scriptProcessor.disconnect();
          this.scriptProcessor = null;
        }
        if (this.inputSource) {
          this.inputSource.disconnect();
          this.inputSource = null;
        }
        if (this.inputAnalyser) {
          this.inputAnalyser.disconnect();
          this.inputAnalyser = null;
        }
        if (this.mediaStream) {
          this.mediaStream.getTracks().forEach(t => t.stop());
          this.mediaStream = null;
        }

        const success = await this._initAudioInput(deviceId);
        if (success) {
          console.log(`[Mic] Successfully switched microphone to: ${this.selectedDeviceLabel || deviceId}`);
          // If fallback SpeechRecognition is active, restart it so the browser updates its audio input binding
          if (this.fallbackSpeechRecognition && !this.isMuted) {
            try {
              this.fallbackSpeechRecognition.abort();
            } catch (e) {}
            setTimeout(() => {
              if (this.fallbackSpeechRecognition && !this.isMuted && this.state !== VoiceState.AI_SPEAKING && this.state !== VoiceState.THINKING) {
                try { this.fallbackSpeechRecognition.start(); } catch (e) {}
              }
            }, 200);
          }
        }
        return success;
      } catch (err) {
        console.error('[Mic] Failed to switch microphone:', err);
        return false;
      }
    }

    disconnect() {
      console.log('[VoiceAssistant] Disconnecting session.');
      this._stopAllAudioPlayback();

      if (this.fallbackSpeechRecognition) {
        try {
          this.fallbackSpeechRecognition.stop();
        } catch (e) {}
        this.fallbackSpeechRecognition = null;
      }

      if (this.scriptProcessor) {
        this.scriptProcessor.disconnect();
        this.scriptProcessor = null;
      }

      if (this.mediaStream) {
        this.mediaStream.getTracks().forEach(t => t.stop());
        this.mediaStream = null;
      }

      if (this.audioContext && this.audioContext.state !== 'closed') {
        this.audioContext.close();
        this.audioContext = null;
      }

      if (this.outputAudioContext && this.outputAudioContext.state !== 'closed') {
        this.outputAudioContext.close();
        this.outputAudioContext = null;
      }

      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }

      this.animationLoopActive = false;
      this._setState(VoiceState.IDLE);
    }

    send(content) {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        console.warn('[VoiceAssistant] Cannot send message - socket not open.');
        return;
      }

      if (typeof content === 'string') {
        this._emitTranscript('user', content, true);
        this._setState(VoiceState.THINKING);

        if (this.isLiveApiMode) {
          this.ws.send(JSON.stringify({
            type: 'live.text_turn',
            text: content
          }));
        } else {
          this.ws.send(JSON.stringify({
            type: 'audio.transcription',
            text: content
          }));
        }
      }
    }

    setMuted(muted) {
      this.isMuted = !!muted;
      console.log(`[VoiceAssistant] Microphone mute state changed: ${this.isMuted ? 'MUTED' : 'UNMUTED'}`);

      // 1. Hardware-level track mute
      if (this.mediaStream) {
        this.mediaStream.getAudioTracks().forEach(track => {
          track.enabled = !this.isMuted;
        });
      }

      // 2. Clear current audio RMS level and abort any active recognition
      if (this.isMuted) {
        this.currentRMS = 0;
        this.userSpeechActive = false;
        if (this.vadSilenceTimer) {
          clearTimeout(this.vadSilenceTimer);
          this.vadSilenceTimer = null;
        }
        if (this.interimDebounceTimer) {
          clearTimeout(this.interimDebounceTimer);
          this.interimDebounceTimer = null;
        }
        if (this.fallbackSpeechRecognition) {
          try {
            this.fallbackSpeechRecognition.abort();
          } catch (e) {}
        }
      } else {
        if (!this.isLiveApiMode && this.fallbackSpeechRecognition) {
          try {
            this.fallbackSpeechRecognition.start();
          } catch (e) {}
        }
      }
    }

    setLanguage(langCode) {
      this.selectedLang = (langCode && langCode !== 'auto') ? langCode : (navigator.language || 'en-US');
      console.log('[VoiceAssistant] Language configured to:', this.selectedLang);
      if (this.fallbackSpeechRecognition) {
        this.fallbackSpeechRecognition.lang = this.selectedLang;
      }
    }

    // ==========================================
    // VISUAL FEEDBACK & ANALYSER INTEGRATION
    // ==========================================
    _startVisualizerLoop() {
      this.animationLoopActive = true;
      const updateData = () => {
        if (!this.animationLoopActive) return;

        let activeRMS = 0;

        if (this.state === VoiceState.AI_SPEAKING) {
          if (this.outputAnalyser && (this.isPlayingQueue || this.currentAudioElement)) {
            this.outputAnalyser.getByteFrequencyData(this.outputFreqData);
            let sum = 0;
            for (let i = 0; i < this.outputFreqData.length; i++) {
              sum += this.outputFreqData[i];
            }
            activeRMS = (sum / this.outputFreqData.length) / 255 * 100;
            // If hardware playback is low, apply dynamic voice boost
            if (activeRMS > 1.5) {
              this.currentRMS = Math.min(100, activeRMS * 1.6 + 15);
            } else {
              this.currentRMS = activeRMS;
            }
          } else if (this.isFallbackPlaying || this.currentUtterance) {
            // Highly expressive speech formants & phoneme syllabic cadence
            const t = performance.now() * 0.012;
            const syllableRhythm = Math.abs(Math.sin(t * 4.2)) * 0.55 + Math.abs(Math.cos(t * 8.0)) * 0.35 + 0.30;
            let sum = 0;
            for (let i = 0; i < this.outputFreqData.length; i++) {
              const freqIdx = i / this.outputFreqData.length;
              const formant1 = Math.exp(-Math.pow((freqIdx - 0.22) / 0.12, 2)) * 240;
              const formant2 = Math.exp(-Math.pow((freqIdx - 0.52) / 0.18, 2)) * 200;
              const flutter = Math.sin(t * 16.0 + i * 0.9) * 50;
              const val = Math.max(25, Math.min(255, Math.floor((formant1 + formant2 + flutter) * syllableRhythm)));
              this.outputFreqData[i] = val;
              sum += val;
            }
            activeRMS = (sum / this.outputFreqData.length) / 255 * 100;
            this.currentRMS = Math.max(40, activeRMS);
          }
        } else if (!this.isMuted && this.inputAnalyser) {
          this.inputAnalyser.getByteFrequencyData(this.inputFreqData);
          let sum = 0;
          for (let i = 0; i < this.inputFreqData.length; i++) {
            // Apply high-pass sensitivity boost to voice range
            sum += this.inputFreqData[i];
          }
          activeRMS = (sum / this.inputFreqData.length) / 255 * 100;
          this.currentRMS = activeRMS;
        } else if (this.isMuted) {
          this.currentRMS = 0;
          this.inputFreqData.fill(0);
        }

        if (typeof this.options.onAudioLevel === 'function') {
          try {
            this.options.onAudioLevel({
              rms: this.currentRMS,
              frequencyData: this.state === VoiceState.AI_SPEAKING ? this.outputFreqData : this.inputFreqData,
              state: this.state
            });
          } catch (e) {}
        }

        requestAnimationFrame(updateData);
      };
      requestAnimationFrame(updateData);
    }

    getAudioVisualData() {
      return {
        rms: this.isMuted ? 0 : this.currentRMS,
        frequencyData: this.state === VoiceState.AI_SPEAKING ? this.outputFreqData : (this.isMuted ? new Uint8Array(64) : this.inputFreqData),
        state: this.state
      };
    }

    // ==========================================
    // FALLBACK CHUNKED PIPELINE (Web Speech API STT + TTS)
    // ==========================================
    _initFallbackSpeechRecognition() {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) {
        console.warn('[VoiceAssistant] SpeechRecognition API not supported in browser.');
        return;
      }

      if (this.fallbackSpeechRecognition) {
        try { this.fallbackSpeechRecognition.abort(); } catch (e) {}
        this.fallbackSpeechRecognition = null;
      }

      const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
      this._isSttRunning = false;
      this.fallbackSpeechRecognition = new SpeechRecognition();
      // On mobile devices, continuous mode often suppresses interim transcripts until connection drops.
      // Setting continuous to false on mobile ensures instant, responsive recognition and turn-taking.
      this.fallbackSpeechRecognition.continuous = !isMobile;
      this.fallbackSpeechRecognition.interimResults = true;
      this.fallbackSpeechRecognition.maxAlternatives = 1;
      this.fallbackSpeechRecognition.lang = this.selectedLang || 'hi-IN';

      this.fallbackSpeechRecognition.onstart = () => {
        this._isSttRunning = true;
        console.log(`[VoiceAssistant STT] Listening in ${this.fallbackSpeechRecognition.lang}`);
        if (this.state !== VoiceState.AI_SPEAKING && this.state !== VoiceState.THINKING && !this.isMuted) {
          this._setState(VoiceState.LISTENING);
        }
      };

      this.fallbackSpeechRecognition.onresult = (event) => {
        if (this.isMuted) return;

        // 1. Never transcribe while assistant is playing speech
        if (this.isFallbackPlaying || this.state === VoiceState.AI_SPEAKING || this.currentAudioElement || this.currentUtterance) {
          console.log('[VoiceAssistant STT] Discarded speech recognition during active assistant audio.');
          return;
        }

        // 2. Cooldown window (700ms) after speech ends to prevent acoustic speaker echo from entering microphone
        if (this._lastTtsEndTime && (Date.now() - this._lastTtsEndTime < 700)) {
          console.log('[VoiceAssistant STT] Discarded residual speaker echo during cooldown window.');
          return;
        }

        let interim = '';
        let finalStr = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const item = event.results[i];
          if (item && item[0]) {
            if (item.isFinal) {
              finalStr += item[0].transcript;
            } else {
              interim += item[0].transcript;
            }
          }
        }

        const heard = (finalStr || interim).trim();
        if (heard) {
          // 3. Exact self-echo filter: if microphone heard the assistant's own intro or response text, discard it
          if (this._lastAssistantSpokenText) {
            const cleanHeard = heard.toLowerCase().replace(/[^\w\u0900-\u09FF\u0980-\u09FF]/g, '');
            const cleanLast = this._lastAssistantSpokenText.toLowerCase().replace(/[^\w\u0900-\u09FF\u0980-\u09FF]/g, '');
            if (cleanLast.includes(cleanHeard) && cleanHeard.length > 5) {
              console.log('[VoiceAssistant STT] Filtered out direct assistant self-echo:', heard);
              return;
            }
          }

          this._setState(VoiceState.USER_SPEAKING);
          this._emitTranscript('user', heard, !!finalStr);

          if (finalStr.trim()) {
            if (this.interimDebounceTimer) {
              clearTimeout(this.interimDebounceTimer);
              this.interimDebounceTimer = null;
            }
            console.log('[VoiceAssistant STT] Final recognized user speech:', finalStr.trim());
            // Immediately stop STT before sending to prevent mic overlap
            try { this.fallbackSpeechRecognition.stop(); } catch (e) {}
            this.send(finalStr.trim());
          } else if (interim.trim()) {
            if (this.interimDebounceTimer) clearTimeout(this.interimDebounceTimer);
            this.interimDebounceTimer = setTimeout(() => {
              const currentInterim = interim.trim();
              if (currentInterim && !this.isMuted && this.state !== VoiceState.AI_SPEAKING && this.state !== VoiceState.THINKING && !this.isFallbackPlaying) {
                console.log('[VoiceAssistant STT] Interim debounced speech sent:', currentInterim);
                try { this.fallbackSpeechRecognition.stop(); } catch (e) {}
                this.send(currentInterim);
              }
            }, 850);
          }
        }
      };

      this.fallbackSpeechRecognition.onspeechstart = () => {
        if (this.isMuted || this.state === VoiceState.AI_SPEAKING || this.isFallbackPlaying) {
          return;
        }
        console.log('[VoiceAssistant STT] Speech start detected from user.');
        this._setState(VoiceState.USER_SPEAKING);
      };

      this.fallbackSpeechRecognition.onsoundstart = () => {
        if (this.isMuted || this.state === VoiceState.AI_SPEAKING || this.isFallbackPlaying) {
          return;
        }
        if (this.state === VoiceState.LISTENING) {
          this._setState(VoiceState.USER_SPEAKING);
        }
      };

      this.fallbackSpeechRecognition.onspeechend = () => {
        console.log('[VoiceAssistant STT] Speech ended.');
      };

      this.fallbackSpeechRecognition.onerror = (e) => {
        if (e.error !== 'no-speech' && e.error !== 'aborted') {
          console.warn('[VoiceAssistant Fallback STT Error]:', e.error);
        }
        if (this.state === VoiceState.USER_SPEAKING && !this.isMuted) {
          this._setState(VoiceState.LISTENING);
        }
        // Auto-recover on non-fatal error with graceful backoff
        if (e.error === 'no-speech' || e.error === 'network') {
          if (this.state !== VoiceState.IDLE && !this.isMuted && this.state !== VoiceState.AI_SPEAKING && !this.isFallbackPlaying) {
            setTimeout(() => {
              try { this.fallbackSpeechRecognition.start(); } catch (err) {}
            }, 300);
          }
        }
      };

      this.fallbackSpeechRecognition.onend = () => {
        this._isSttRunning = false;
        if (this.state !== VoiceState.IDLE && !this.isMuted) {
          if (this.state !== VoiceState.AI_SPEAKING && this.state !== VoiceState.THINKING && !this.isFallbackPlaying) {
            setTimeout(() => {
              if (this.state !== VoiceState.IDLE && !this.isMuted && this.state !== VoiceState.AI_SPEAKING && this.state !== VoiceState.THINKING && !this.isFallbackPlaying && !this._isSttRunning) {
                try {
                  this.fallbackSpeechRecognition.start();
                } catch (e) {}
              }
            }, 300);
          }
        }
      };

      // Only start STT if assistant is not currently speaking TTS audio
      if (!this.isMuted && this.state !== VoiceState.AI_SPEAKING && this.state !== VoiceState.THINKING && !this.isFallbackPlaying) {
        setTimeout(() => {
          try {
            this.fallbackSpeechRecognition.start();
          } catch (e) {}
        }, 200);
      }
    }

    _enqueueFallbackTTSChunk(text) {
      if (!text) return;
      const clean = text.replace(/\*\*Crafting[^*]+\*\*/gi, '')
                        .replace(/\*\*Thinking[^*]+\*\*/gi, '')
                        .replace(/\[TOOL:[^\]]+\]/g, '')
                        .replace(/[*_#`~]/g, '')
                        .trim();
      if (!clean) return;

      this.fallbackSpeechQueue.push(clean);
      if (!this.isFallbackPlaying) {
        this._playNextFallbackTTS();
      }
    }

    _playNextFallbackTTS() {
      if (this.fallbackSpeechQueue.length === 0) {
        this.isFallbackPlaying = false;
        this._lastTtsEndTime = Date.now();
        if ((this.state === VoiceState.AI_SPEAKING || this.state === VoiceState.THINKING) && !this.isMuted) {
          this._setState(VoiceState.LISTENING);
        }
        if (this._ttsKeepAliveTimer) {
          clearInterval(this._ttsKeepAliveTimer);
          this._ttsKeepAliveTimer = null;
        }

        // Initialize SpeechRecognition ONLY after intro/assistant speech has completed
        if (!this.fallbackSpeechRecognition) {
          setTimeout(() => {
            if (!this.isFallbackPlaying && !this.isMuted) {
              this._initFallbackSpeechRecognition();
            }
          }, 600);
        } else if (!this.isMuted) {
          setTimeout(() => {
            if (!this.isFallbackPlaying && this.state !== VoiceState.AI_SPEAKING && !this.isMuted) {
              try { this.fallbackSpeechRecognition.start(); } catch (e) {}
            }
          }, 600);
        }
        return;
      }

      // Temporarily stop STT during assistant speech so the mic doesn't hear the speaker output
      if (this.fallbackSpeechRecognition) {
        try { this.fallbackSpeechRecognition.stop(); } catch (e) {}
      }

      this.isFallbackPlaying = true;
      this._setState(VoiceState.AI_SPEAKING);

      const text = this.fallbackSpeechQueue.shift();
      if (!window.speechSynthesis) {
        console.warn('[VoiceAssistant] SpeechSynthesis not supported in browser.');
        this._playNextFallbackTTS();
        return;
      }

      // Cancel any stuck previous utterances for clean playback
      try {
        window.speechSynthesis.cancel();
      } catch (e) {}

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.95; 
      utterance.volume = 1.0;
      utterance.pitch = 1.08; // Consistent gentle female pitch

      // Auto-detect language strictly: Bengali (বাংলা), Hindi (हिन्दी), or English
      const isBengaliText = /[\u0980-\u09FF]/.test(text) || /\b(tumi|tomar|kemon|achen|korecho|banalo|kothay|shuncho|aajke|ekhon|bhalo|apni|apnar)\b/i.test(text);
      const isHindiText = /[\u0900-\u097F]/.test(text) || /\b(aap|main|hum|mujhe|mera|meri|karein|rahe|rahi|namaste|dhanyawad|shukriya|sahayata|kripya)\b/i.test(text);

      let targetLang = this.selectedLang && this.selectedLang !== 'auto' ? this.selectedLang : 'hi-IN';
      if (isBengaliText) {
        targetLang = 'bn-IN';
      } else if (isHindiText) {
        targetLang = 'hi-IN';
      } else if (/[a-zA-Z]/.test(text) && !isHindiText && !isBengaliText && this.selectedLang === 'en-US') {
        targetLang = 'en-US';
      }

      utterance.lang = targetLang;

      // Select consistent voice
      let matchedVoice = null;
      try {
        const voices = window.speechSynthesis.getVoices() || [];
        if (voices.length > 0) {
          if (targetLang.startsWith('bn') || isBengaliText) {
            matchedVoice = 
              voices.find(v => (v.lang && v.lang.toLowerCase().startsWith('bn')) && /female|mithu|tapan|bashkar|shohor|girl|natural/i.test(v.name))
              || voices.find(v => (v.lang && v.lang.toLowerCase().startsWith('bn')) && !/male/i.test(v.name))
              || voices.find(v => v.lang && v.lang.toLowerCase().startsWith('bn'))
              || voices.find(v => /bengali|bangla/i.test(v.name));
          } else if (targetLang.startsWith('hi') || isHindiText) {
            matchedVoice = 
              voices.find(v => (v.lang && v.lang.toLowerCase().startsWith('hi')) && /google.*(female|हिंदी|हिन्दी)|kalpana|swara|heera|ananya|priya|neerja|female/i.test(v.name))
              || voices.find(v => (v.lang && v.lang.toLowerCase().startsWith('hi')) && !/male|hemant|madhur|guy|david/i.test(v.name))
              || voices.find(v => v.lang && v.lang.toLowerCase().startsWith('hi'))
              || voices.find(v => /hindi|kalpana|swara/i.test(v.name));
          } else {
            matchedVoice = 
              voices.find(v => v.lang && v.lang.startsWith('en') && /(aria|jenny|ava|emma|sonia|michelle|ana|clara|libby|maia|natasha|neerja)/i.test(v.name) && !/male|david|george|mark|guy|ryan/i.test(v.name))
              || voices.find(v => v.lang && v.lang.startsWith('en') && /(samantha|victoria|karen|susan|kathy|serena|stephanie|moira|fiona|tessa|veena)/i.test(v.name) && !/male|david|george|mark/i.test(v.name))
              || voices.find(v => v.lang && v.lang.startsWith('en') && /female|natural/i.test(v.name) && !/male|david|george|mark|guy/i.test(v.name))
              || voices.find(v => v.lang && v.lang.startsWith('en') && /zira|google/i.test(v.name) && !/male|david|george|mark|guy|ryan/i.test(v.name))
              || voices.find(v => v.lang && v.lang.startsWith('en') && !/male|david|george|mark|guy|ryan|richard|james|ravi/i.test(v.name));
          }

          if (matchedVoice) {
            utterance.voice = matchedVoice;
          }
        }
      } catch (e) {}

      // If text is Bengali or Hindi and no native browser voice exists on this device/OS,
      // seamlessly stream crystal-clear audio through our backend proxy!
      if (!matchedVoice && (isBengaliText || targetLang.startsWith('bn') || isHindiText || targetLang.startsWith('hi'))) {
        const ttsLang = (isBengaliText || targetLang.startsWith('bn')) ? 'bn-IN' : 'hi-IN';
        console.log(`[VoiceAssistant TTS] Device has no native ${ttsLang} voice. Streaming via backend proxy.`);
        try {
          const encoded = encodeURIComponent(text.substring(0, 300));
          const audioUrl = `/api/tts?lang=${ttsLang}&text=${encoded}`;
          this._initAudioOutput();
          const audio = new Audio(audioUrl);
          audio.crossOrigin = 'anonymous';

          try {
            if (this.outputAudioContext && this.outputAnalyser) {
              const audioSrc = this.outputAudioContext.createMediaElementSource(audio);
              audioSrc.connect(this.outputAnalyser);
            }
          } catch (audioSrcErr) {}

          let audioEnded = false;
          const onDone = () => {
            if (audioEnded) return;
            audioEnded = true;
            this.currentAudioElement = null;
            this._playNextFallbackTTS();
          };

          audio.onended = onDone;
          audio.onerror = () => {
            console.warn('[Audio Stream Error]: Falling back to standard utterance.');
            this._playUtteranceFallback(utterance);
          };

          setTimeout(() => {
            if (!audioEnded && this.currentAudioElement === audio) {
              onDone();
            }
          }, 9000);

          this.currentAudioElement = audio;
          const playPromise = audio.play();
          if (playPromise !== undefined) {
            playPromise.catch(() => {
              this._playUtteranceFallback(utterance);
            });
          }
          return;
        } catch (err) {
          console.warn('[Audio Stream Exception]:', err);
        }
      }

      this._playUtteranceFallback(utterance);
    }

    _playUtteranceFallback(utterance) {
      this.currentUtterance = utterance;

      let hasFinished = false;
      let safetyTimeout = null;

      const finishUtterance = () => {
        if (hasFinished) return;
        hasFinished = true;
        if (safetyTimeout) {
          clearTimeout(safetyTimeout);
          safetyTimeout = null;
        }
        this.currentUtterance = null;
        this._playNextFallbackTTS();
      };

      utterance.onend = finishUtterance;
      utterance.onerror = (e) => {
        console.warn('[SpeechSynthesis Error]:', e);
        finishUtterance();
      };

      const estimatedWords = (utterance.text || '').trim().split(/\s+/).length || 1;
      const timeoutMs = Math.max(3000, estimatedWords * 600 + 4000);
      safetyTimeout = setTimeout(() => {
        finishUtterance();
      }, timeoutMs);

      try {
        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }
        window.speechSynthesis.speak(utterance);
      } catch (err) {
        console.warn('[SpeechSynthesis Speak Error]:', err);
        finishUtterance();
      }
    }
  }

  return VoiceAssistantService;
}));

