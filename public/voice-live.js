// ==============================================================================
// PRODUCTION REAL-TIME LIVE VOICE ASSISTANT CLIENT CONTROLLER (voice-live.js)
// Real VAD, Web Audio API, WebSocket Streaming, Canvas 3D Neural Orb, Barge-in
// ==============================================================================

(function () {
  'use strict';

  // State Machine definitions
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

  class LiveVoiceManager {
    constructor() {
      // DOM Elements
      this.screen = document.getElementById('liveVoiceScreen');
      this.waveCanvas = document.getElementById('liveVoiceWaveCanvas');
      this.statusText = document.getElementById('liveVoiceStatusText');
      this.transcriptUser = document.getElementById('liveTranscriptUser');
      this.transcriptAi = document.getElementById('liveTranscriptAi');
      this.langSelect = document.getElementById('liveVoiceLangSelect');
      this.micDeviceSelect = document.getElementById('liveMicDeviceSelect');
      this.micMeter = document.getElementById('liveMicMeter');
      this.dockTypeContainer = document.getElementById('dockTypeContainer');
      this.dockTypeToggleBtn = document.getElementById('dockTypeToggleBtn');
      this.dockTextInput = document.getElementById('dockTextInput');
      this.dockSendBtn = document.getElementById('dockSendBtn');
      this.dockSpeakerBtn = document.getElementById('dockSpeakerBtn');
      this.dockMicToggleBtn = document.getElementById('dockMicToggleBtn');
      this.dockMicIcon = document.getElementById('dockMicIcon');
      this.dockEndVoiceBtn = document.getElementById('dockEndVoiceBtn');
      this.isSpeakerMuted = false;

      // Launcher triggers in standard UI
      this.openLiveVoiceBtn = document.getElementById('openLiveVoiceBtn');
      this.launchLiveVoicePillBtn = document.getElementById('launchLiveVoicePillBtn');

      // Internal State
      this.currentState = VoiceState.IDLE;
      this.isMuted = false;
      this.isThinkMode = false;
      this.selectedDeviceId = 'default';

      // Modular VoiceAssistant Service Instance
      this.voiceAssistant = new window.VoiceAssistant({
        enableGeminiLive: true,
        onStateChange: (state, payload) => {
          this.setState(state, payload?.message);
        },
        onAudioLevel: (data) => {
          this.currentAudioRMS = data.rms || 0;
          this.audioFrequencyData = data.frequencyData || this.audioFrequencyData;
          this.updateMicMeterUI(this.currentAudioRMS);
        },
        onTranscript: ({ role, text, isFinal }) => {
          if (role === 'user') {
            if (this.transcriptUser) {
              this.transcriptUser.textContent = `"${text}"`;
            }
            // Auto-detect spoken language and synchronize the top dropdown accordingly
            if (text && text.trim()) {
              this.autoDetectAndSetLanguage(text);
            }
            if (isFinal && window.syncLiveVoiceUserMessage) {
              window.syncLiveVoiceUserMessage(text);
            }
          } else if (role === 'assistant') {
            if (this.transcriptAi) {
              if (isFinal) {
                this.transcriptAi.textContent = text;
                if (window.syncLiveVoiceMessage) {
                  window.syncLiveVoiceMessage(text);
                }
              } else {
                if (this.transcriptAi.textContent === 'Thinking...' || this.transcriptAi.textContent === '') {
                  this.transcriptAi.textContent = text;
                } else {
                  this.transcriptAi.textContent += text;
                }
              }
            }
          }
        },
        onInterruption: () => {
          console.log('[Live Voice UI] Interruption received from service');
          if (this.statusText) {
            this.statusText.textContent = 'Listening...';
            this.statusText.style.color = '#D9F9DF';
          }
        },
        onError: (err) => {
          const msg = (typeof err === 'object' && err !== null) ? (err.message || 'Connection issue') : String(err);
          this.setState(VoiceState.ERROR, msg);
        }
      });

      // Orb & Wave Animation Data
      this.orbCtx = this.orbCanvas ? this.orbCanvas.getContext('2d') : null;
      this.waveCtx = this.waveCanvas ? this.waveCanvas.getContext('2d') : null;
      this.animationFrameId = null;
      this.orbPhase = 0;
      this.audioFrequencyData = new Uint8Array(64);
      this.currentAudioRMS = 0;

      this.initEvents();
    }

    initEvents() {
      if (this.langSelect) {
        this.langSelect.addEventListener('change', () => {
          this.updateRecognitionLanguage();
        });
      }
      if (this.micDeviceSelect) {
        this.micDeviceSelect.addEventListener('change', async () => {
          this.selectedDeviceId = this.micDeviceSelect.value;
          console.log(`[Live Voice UI] Selected microphone changed to: ${this.selectedDeviceId}`);
          if (this.voiceAssistant && this.screen && this.screen.classList.contains('active')) {
            const currentLabel = this.micDeviceSelect.options[this.micDeviceSelect.selectedIndex]?.text?.replace(/^[🎙️\s]+/, '') || 'Microphone';
            this.setState(VoiceState.CONNECTING, `Connecting ${currentLabel}...`);
            const ok = await this.voiceAssistant.switchMicrophone(this.selectedDeviceId);
            if (this.screen && this.screen.classList.contains('active') && !this.isMuted) {
              this.setState(VoiceState.LISTENING, 'Listening... Speak now');
            }
          }
        });
      }

      // Automatically refresh microphone list when external USB / Bluetooth mics are plugged in or unplugged
      if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
        navigator.mediaDevices.addEventListener('devicechange', async () => {
          console.log('[Live Voice UI] Audio device change detected (hotplug)');
          await this.populateAudioDevices();
        });
      }
      if (this.openLiveVoiceBtn) {
        this.openLiveVoiceBtn.addEventListener('click', () => this.startLiveSession());
      }
      if (this.launchLiveVoicePillBtn) {
        this.launchLiveVoicePillBtn.addEventListener('click', () => {
          if (this.screen && this.screen.classList.contains('active')) {
            this.toggleMicrophoneMute();
          } else {
            this.startLiveSession();
          }
        });
      }
      const sidebarLiveVoiceBtn = document.getElementById('sidebarLiveVoiceBtn');
      if (sidebarLiveVoiceBtn) {
        sidebarLiveVoiceBtn.addEventListener('click', () => this.startLiveSession());
      }
      const voiceBackBtn = document.getElementById('voiceBackBtn');
      if (voiceBackBtn) {
        voiceBackBtn.addEventListener('click', () => this.endLiveSession());
      }
      if (this.dockEndVoiceBtn) {
        this.dockEndVoiceBtn.addEventListener('click', () => this.endLiveSession());
      }
      if (this.dockMicToggleBtn) {
        this.dockMicToggleBtn.addEventListener('click', () => this.toggleMicrophoneMute());
      }
      if (this.dockSpeakerBtn) {
        this.dockSpeakerBtn.addEventListener('click', () => this.toggleSpeakerMute());
      }
      if (this.dockTypeToggleBtn) {
        this.dockTypeToggleBtn.addEventListener('click', () => {
          this.dockTextInput.focus();
        });
      }
      if (this.dockSendBtn) {
        this.dockSendBtn.addEventListener('click', () => this.sendTypedQuery());
      }
      if (this.dockTextInput) {
        this.dockTextInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            this.sendTypedQuery();
          }
        });
      }

      // Quick Dola Topic Pills Handler
      document.querySelectorAll('.dola-topic-pill').forEach(pill => {
        pill.addEventListener('click', () => {
          const prompt = pill.getAttribute('data-voice-prompt');
          if (prompt) {
            if (this.transcriptUser) {
              this.transcriptUser.textContent = `"${prompt}"`;
            }
            this.processUserSpeech(prompt);
          }
        });
      });

      // Keyboard Accessibility
      window.addEventListener('keydown', (e) => {
        if (!this.screen || !this.screen.classList.contains('active')) return;
        if (e.key === 'Escape') {
          this.endLiveSession();
        } else if (e.key.toLowerCase() === 'm' && document.activeElement !== this.dockTextInput) {
          this.toggleMicrophoneMute();
        }
      });
    }

    setState(newState, statusLabel = null) {
      if (this.isMuted && (newState === VoiceState.LISTENING || newState === VoiceState.USER_SPEAKING)) {
        if (this.statusText) {
          this.statusText.textContent = 'Microphone Muted';
          this.statusText.style.color = '#ef4444';
        }
        return;
      }
      this.currentState = newState;
      if (this.statusText) {
        switch (newState) {
          case VoiceState.CONNECTING:
            this.statusText.textContent = statusLabel || 'Connecting...';
            this.statusText.style.color = '#1A1C4B';
            break;
          case VoiceState.READY:
            this.statusText.textContent = statusLabel || 'Microphone Ready';
            this.statusText.style.color = '#1A1C4B';
            break;
          case VoiceState.LISTENING:
            this.statusText.textContent = statusLabel || 'Listening... Speak now';
            this.statusText.style.color = '#1A1C4B';
            break;
          case VoiceState.USER_SPEAKING:
            this.statusText.textContent = statusLabel || 'Listening to you...';
            this.statusText.style.color = '#1A1C4B';
            break;
          case VoiceState.THINKING:
            this.statusText.textContent = statusLabel || 'Thinking...';
            this.statusText.style.color = '#1A1C4B';
            break;
          case VoiceState.AI_SPEAKING:
            this.statusText.textContent = statusLabel || '';
            this.statusText.style.color = '#1A1C4B';
            break;
          case VoiceState.INTERRUPTED:
            this.statusText.textContent = 'Listening...';
            this.statusText.style.color = '#1A1C4B';
            break;
          case VoiceState.ERROR:
            this.statusText.textContent = statusLabel || 'Connection Issue';
            this.statusText.style.color = '#ef4444';
            break;
          default:
            this.statusText.textContent = statusLabel || '';
        }
      }
    }

    // ==========================================
    // HARDWARE AUDIO DEVICE ENUMERATION
    // ==========================================
    async populateAudioDevices() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter(d => d.kind === 'audioinput');
        
        console.log('[Mic] Available audio input devices:');
        audioInputs.forEach((device, idx) => {
          console.log(`[Mic] Device #${idx}: label="${device.label || 'Default / Generic'}" deviceId="${device.deviceId}" groupId="${device.groupId}"`);
        });

        if (this.micDeviceSelect && audioInputs.length > 0) {
          const currentVal = this.selectedDeviceId || this.micDeviceSelect.value;
          this.micDeviceSelect.innerHTML = '';

          // 1. Add Default System Microphone option
          const defaultOpt = document.createElement('option');
          defaultOpt.value = 'default';
          defaultOpt.textContent = '🎙️ Default microphone';
          this.micDeviceSelect.appendChild(defaultOpt);

          // 2. Add enumerated audio devices
          let bestDeviceId = 'default';
          let physicalFound = false;

          audioInputs.forEach((device, idx) => {
            if (device.deviceId === 'default') return; // Handled above

            const opt = document.createElement('option');
            opt.value = device.deviceId || `mic-${idx}`;
            const label = device.label || `Microphone ${idx + 1}`;
            opt.textContent = `🎙️ ${label}`;
            this.micDeviceSelect.appendChild(opt);

            // Detect if this is a physical / external mic (not Steam or Virtual Audio)
            const isVirtual = /steam|virtual|cable|voicemeeter/i.test(label);
            if (!isVirtual && !physicalFound) {
              bestDeviceId = device.deviceId;
              physicalFound = true;
            }
          });

          // Retain the user's explicit selection if it exists in the list
          if (currentVal && Array.from(this.micDeviceSelect.options).some(o => o.value === currentVal)) {
            this.micDeviceSelect.value = currentVal;
            this.selectedDeviceId = currentVal;
          } else if (physicalFound) {
            this.micDeviceSelect.value = bestDeviceId;
            this.selectedDeviceId = bestDeviceId;
            console.log(`[Mic] Prioritized physical microphone: ${bestDeviceId}`);
          } else {
            this.micDeviceSelect.value = 'default';
            this.selectedDeviceId = 'default';
          }

          if (window.refreshCustomDropdown) {
            window.refreshCustomDropdown(this.micDeviceSelect);
          }
        }
      } catch (err) {
        console.warn('[Live Voice]: enumerateDevices error:', err);
      }
    }

    updateMicMeterUI(rms) {
      if (!this.micMeter) return;
      const bars = this.micMeter.querySelectorAll('.meter-bar');
      const activeCount = Math.min(Math.floor(rms / 4), bars.length);
      bars.forEach((bar, idx) => {
        if (idx < activeCount) {
          bar.style.height = `${8 + idx * 3}px`;
          bar.style.backgroundColor = idx >= 3 ? '#D9F9DF' : '#AEE2FF';
        } else {
          bar.style.height = '6px';
          bar.style.backgroundColor = '#CBD0FF';
        }
      });
    }

    updateRecognitionLanguage() {
      const selected = this.langSelect ? this.langSelect.value : 'auto';
      if (this.voiceAssistant) {
        this.voiceAssistant.setLanguage(selected);
      }
    }

    autoDetectAndSetLanguage(text) {
      if (!text || !this.langSelect) return;
      const str = text.trim();
      let detectedLang = null;

      // 1. Bengali detection (Bengali script or key Bengali words)
      if (/[\u0980-\u09FF]/.test(str) || /\b(kemon|acho|achen|tumi|tomar|apni|apnar|bhalo|kothay|ki|korcho|bolchi|shuncho|aajke|ekhon|bangla|khobor)\b/i.test(str)) {
        detectedLang = 'bn-IN';
      }
      // 2. Pure Hindi detection (Devanagari script or pure Hindi words)
      else if (/[\u0900-\u097F]/.test(str) || /\b(namaste|kaise|kaisa|batao|aap|aapka|aapki|mera|meri|kijiye|dhanyawad|shukriya|madad|sahayata|kripya)\b/i.test(str)) {
        detectedLang = 'hi-IN';
      }
      // 3. English detection (Default for English words and standard Latin characters)
      else if (/[a-zA-Z]/.test(str)) {
        detectedLang = 'en-US';
      }

      if (detectedLang && this.langSelect.value !== detectedLang) {
        this.langSelect.value = detectedLang;
        // Trigger dropdown UI refresh
        if (typeof window.refreshCustomDropdown === 'function') {
          window.refreshCustomDropdown(this.langSelect);
        } else {
          this.langSelect.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (this.voiceAssistant) {
          this.voiceAssistant.setLanguage(detectedLang);
        }
      }
    }

    processUserSpeech(text) {
      if (!text) return;
      this.autoDetectAndSetLanguage(text);
      if (this.transcriptAi) this.transcriptAi.textContent = 'Thinking...';
      if (this.voiceAssistant) {
        this.voiceAssistant.send(text);
      }
    }

    sendTypedQuery() {
      const text = this.dockTextInput ? this.dockTextInput.value.trim() : '';
      if (!text) return;

      if (this.dockTextInput) this.dockTextInput.value = '';
      if (this.transcriptUser) {
        this.transcriptUser.textContent = `"${text}"`;
      }
      this.processUserSpeech(text);
    }

    // =========================================================================
    // CIRCULAR QUANTUM HARMONIC HALO & ORBITAL AURA (AUDIO-SYNCED CIRCLE)
    // Synchronized circular multi-harmonic glowing loops + reactive audio halo
    // =========================================================================
    startOrbRenderer() {
      if (!this.waveCanvas) {
        this.waveCanvas = document.getElementById('liveVoiceWaveCanvas');
      }
      this.waveCtx = this.waveCanvas ? this.waveCanvas.getContext('2d') : null;
      if (!this.waveCtx || !this.waveCanvas) return;

      let smoothedRMS = 0;
      let currentSpeechScale = 0.20;
      let smoothedCompFactor = 0;
      const smoothedFreqs = new Float32Array(64);
      for (let i = 0; i < 64; i++) {
        smoothedFreqs[i] = 10;
      }

      // 36 Ambient Orbiting Stardust Particles
      const particles = [];
      const particleColors = ['#7358FF', '#00D2FF', '#FF4DB8', '#00FF9D', '#AEE2FF'];
      for (let p = 0; p < 36; p++) {
        particles.push({
          angle: Math.random() * Math.PI * 2,
          dist: Math.random() * 95 + 35,
          speed: (Math.random() * 0.02 + 0.008) * (Math.random() > 0.5 ? 1 : -1),
          size: Math.random() * 2.2 + 0.8,
          alpha: Math.random() * 0.6 + 0.25,
          color: particleColors[Math.floor(Math.random() * particleColors.length)]
        });
      }

      const render = () => {
        if (!this.screen || !this.screen.classList.contains('active')) return;

        this.orbPhase += 0.035;

        // Smooth energy and frequency data with progressive dual-rate attack/release lerp
        const rawRMS = this.currentAudioRMS || 0;
        smoothedRMS += (rawRMS - smoothedRMS) * 0.15;

        for (let i = 0; i < 64; i++) {
          const rawF = this.audioFrequencyData[i] || 0;
          // Smooth rise and fall for each spectral frequency
          const smoothingFactor = rawF > smoothedFreqs[i] ? 0.22 : 0.12;
          smoothedFreqs[i] += (rawF - smoothedFreqs[i]) * smoothingFactor;
        }

        let sumEnergy = 0;
        for (let i = 0; i < 32; i++) {
          sumEnergy += smoothedFreqs[i];
        }
        const avgEnergy = (sumEnergy / 32) / 255;
        const isSpeaking = this.currentState === VoiceState.USER_SPEAKING || this.currentState === VoiceState.AI_SPEAKING;
        const isThinking = this.currentState === VoiceState.THINKING;

        // Dynamic audio amplitude factor with gentle continuous soft-knee compression
        const rawSpeechFactor = avgEnergy * 2.5 + (smoothedRMS * 0.08);
        const targetCompFactor = Math.tanh(rawSpeechFactor * 1.4) * 1.15;
        
        // Attack vs Release smoothing for the suppression curve
        const compLerpRate = targetCompFactor > smoothedCompFactor ? 0.14 : 0.07;
        smoothedCompFactor += (targetCompFactor - smoothedCompFactor) * compLerpRate;

        const targetSpeechScale = isSpeaking 
          ? (0.50 + smoothedCompFactor) 
          : (isThinking ? (0.32 + Math.sin(this.orbPhase * 2.5) * 0.10) : 0.18);

        // Smoothly interpolate between active and idle scale (eliminates sudden pops or jumps)
        const scaleLerpRate = targetSpeechScale > currentSpeechScale ? 0.16 : 0.08;
        currentSpeechScale += (targetSpeechScale - currentSpeechScale) * scaleLerpRate;
        const speechScale = currentSpeechScale;

        const ctx = this.waveCtx;
        const w = this.waveCanvas.width;
        const h = this.waveCanvas.height;
        const cx = w / 2;
        const cy = h / 2;
        const baseRadius = 100;

        ctx.clearRect(0, 0, w, h);

        // -------------------------------------------------------------
        // LAYER 1: Orbiting Stardust Particles
        // -------------------------------------------------------------
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        particles.forEach(pt => {
          pt.angle += pt.speed * (1 + speechScale * 0.5);
          const dynamicDist = pt.dist * (1 + speechScale * 0.15) + Math.sin(this.orbPhase * 1.5 + pt.angle * 2) * 4;
          const px = cx + Math.cos(pt.angle) * dynamicDist;
          const py = cy + Math.sin(pt.angle) * dynamicDist;

          ctx.beginPath();
          ctx.arc(px, py, pt.size * (0.8 + speechScale * 0.4), 0, Math.PI * 2);
          ctx.fillStyle = pt.color;
          ctx.globalAlpha = Math.min(0.9, pt.alpha * (0.6 + speechScale * 0.5));
          ctx.fill();
        });
        ctx.restore();

        // -------------------------------------------------------------
        // LAYER 2: Multi-Harmonic Undulating Circular Ribbons (Deepened & Enriched)
        // -------------------------------------------------------------
        ctx.save();
        ctx.globalCompositeOperation = 'screen';

        const circularHarmonics = [
          // 1. Deep Royal Violet Harmonic (#7358FF)
          {
            color: 'rgba(115, 88, 255, 0.90)',
            glow: '#7358FF',
            radiusOffset: -5,
            freq: 3,
            speed: 0.8,
            amp: 11 * speechScale,
            thick: 2.4,
            phaseOffset: 0
          },
          // 2. Glowing Neon Magenta Orbit (#FF4DB8)
          {
            color: 'rgba(255, 77, 184, 0.92)',
            glow: '#FF4DB8',
            radiusOffset: 0,
            freq: 4,
            speed: -0.7,
            amp: 12 * speechScale,
            thick: 2.2,
            phaseOffset: 1.6
          },
          // 3. Vibrant Neon Cyan Kinetic Ring (#00D2FF)
          {
            color: 'rgba(0, 210, 255, 0.95)',
            glow: '#00D2FF',
            radiusOffset: 4,
            freq: 5,
            speed: 0.9,
            amp: 13 * speechScale,
            thick: 2.4,
            phaseOffset: 3.2
          },
          // 4. Radiant Electric Mint Wave (#00FF9D)
          {
            color: 'rgba(0, 255, 157, 0.96)',
            glow: '#00FF9D',
            radiusOffset: -2,
            freq: 6,
            speed: -0.85,
            amp: 14 * speechScale,
            thick: 2.6,
            phaseOffset: 4.8
          }
        ];

        // 180 points for silky smooth, anti-aliased curves without harsh edges
        const numCircleSteps = 180;

        circularHarmonics.forEach((harm, hIdx) => {
          ctx.beginPath();
          for (let i = 0; i <= numCircleSteps; i++) {
            const angle = (i / numCircleSteps) * Math.PI * 2;
            
            // Frequency spectrum audio sync with smooth cosine interpolation
            const normPos = Math.abs((i % 90) - 45) / 45;
            const binIdx = Math.min(31, Math.floor(normPos * 31));
            const rawEnergy = (smoothedFreqs[binIdx] || 0) / 255;
            const fEnergy = Math.tanh(rawEnergy * 1.5); // Suppressed soft curve

            // Fluid sinusoidal harmonic wave formula around circle
            const wave1 = Math.sin(angle * harm.freq + this.orbPhase * harm.speed + harm.phaseOffset) * harm.amp;
            const wave2 = Math.cos(angle * (harm.freq - 1) - this.orbPhase * 0.5 + hIdx) * (harm.amp * 0.35);
            const reactiveExpansion = (fEnergy * 14 * speechScale);

            const r = baseRadius + harm.radiusOffset + wave1 + wave2 + reactiveExpansion;
            const x = cx + Math.cos(angle) * r;
            const y = cy + Math.sin(angle) * r;

            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.closePath();

          ctx.strokeStyle = harm.color;
          ctx.lineWidth = Math.max(1.8, harm.thick * (0.8 + speechScale * 0.3));
          ctx.shadowColor = harm.glow;
          ctx.shadowBlur = 14 * (0.8 + speechScale * 0.4);
          ctx.stroke();
        });

        // -------------------------------------------------------------
        // LAYER 3: Incandescent Center Core Spine (#00FFE0 & Pure White-Cyan Glow)
        // -------------------------------------------------------------
        ctx.beginPath();
        for (let i = 0; i <= numCircleSteps; i++) {
          const angle = (i / numCircleSteps) * Math.PI * 2;
          const normPos = Math.abs((i % 90) - 45) / 45;
          const binIdx = Math.min(31, Math.floor(normPos * 31));
          const fEnergy = Math.tanh(((smoothedFreqs[binIdx] || 0) / 255) * 1.5);

          const wave = Math.sin(angle * 5 + this.orbPhase * 1.4) * (7 * speechScale) +
                       Math.cos(angle * 2 - this.orbPhase * 1.0) * (5 * speechScale);
          const reactiveLift = (fEnergy * 9 * speechScale);

          const r = baseRadius + wave + reactiveLift;
          const x = cx + Math.cos(angle) * r;
          const y = cy + Math.sin(angle) * r;

          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.strokeStyle = 'rgba(235, 255, 255, 0.98)';
        ctx.lineWidth = 2.4 * (0.9 + speechScale * 0.3);
        ctx.shadowColor = '#00F5D4';
        ctx.shadowBlur = 16 * (0.8 + speechScale * 0.4);
        ctx.stroke();

        // Deep rich center radiant glow
        const centerGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, baseRadius * (0.85 + speechScale * 0.3));
        centerGlow.addColorStop(0, 'rgba(115, 88, 255, 0.35)');
        centerGlow.addColorStop(0.45, 'rgba(0, 210, 255, 0.20)');
        centerGlow.addColorStop(0.8, 'rgba(0, 255, 157, 0.08)');
        centerGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = centerGlow;
        ctx.beginPath();
        ctx.arc(cx, cy, baseRadius * (0.85 + speechScale * 0.3), 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();

        this.animationFrameId = requestAnimationFrame(render);
      };

      this.animationFrameId = requestAnimationFrame(render);
    }

    stopOrbRenderer() {
      if (this.animationFrameId) {
        cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = null;
      }
    }

    // ==========================================
    // SESSION LIFECYCLE (START / END)
    // ==========================================
    async startLiveSession() {
      this.screen.classList.add('active');
      this.setState(VoiceState.CONNECTING, 'Initializing Microphone...');

      // Populate hardware microphones dropdown
      await this.populateAudioDevices();

      // Start 3D Ribbon / Orb Renderer
      this.startOrbRenderer();

      // Retrieve conversation memory and user settings
      const currentChat = window.getLiveVoiceActiveMessages ? window.getLiveVoiceActiveMessages() : [];
      const savedSettings = JSON.parse(localStorage.getItem('aura_settings') || localStorage.getItem('chatgpt_settings') || '{}');

      // Connect Modular Voice Assistant Service
      if (this.voiceAssistant) {
        const selectedLang = this.langSelect ? this.langSelect.value : 'auto';
        this.voiceAssistant.connect({
          deviceId: this.selectedDeviceId,
          language: selectedLang,
          history: currentChat,
          provider: savedSettings.provider || 'gemini',
          apiKey: savedSettings.apiKey || ''
        });
      }
    }

    endLiveSession() {
      console.log('[Live Voice]: Terminating session and releasing audio devices.');

      if (this.voiceAssistant) {
        this.voiceAssistant.disconnect();
      }

      this.stopOrbRenderer();
      this.screen.classList.remove('active');
      this.setState(VoiceState.IDLE);
    }

    toggleMicrophoneMute() {
      this.isMuted = !this.isMuted;
      
      // Update Dock Mic Button visual state
      if (this.dockMicToggleBtn) {
        this.dockMicToggleBtn.classList.toggle('muted', this.isMuted);
        const micIcon = document.getElementById('dockMicIcon');
        if (micIcon) {
          if (this.isMuted) {
            // Muted Mic SVG (with strike-through slash)
            micIcon.innerHTML = `
              <line x1="1" y1="1" x2="23" y2="23"></line>
              <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path>
              <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path>
              <line x1="12" y1="19" x2="12" y2="23"></line>
              <line x1="8" y1="23" x2="16" y2="23"></line>
            `;
          } else {
            // Normal Active Mic SVG
            micIcon.innerHTML = `
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
              <line x1="12" y1="19" x2="12" y2="23"></line>
              <line x1="8" y1="23" x2="16" y2="23"></line>
            `;
          }
        }
      }

      // Update Pill Mic Button visual state if present
      if (this.launchLiveVoicePillBtn) {
        this.launchLiveVoicePillBtn.classList.toggle('muted', this.isMuted);
      }

      if (this.voiceAssistant) {
        this.voiceAssistant.setMuted(this.isMuted);
      }

      if (this.isMuted) {
        this.setState(VoiceState.IDLE, 'Microphone Muted');
      } else {
        this.setState(VoiceState.LISTENING, 'Listening... Speak now');
      }
    }

    toggleSpeakerMute() {
      this.isSpeakerMuted = !this.isSpeakerMuted;
      if (this.dockSpeakerBtn) {
        this.dockSpeakerBtn.classList.toggle('muted', this.isSpeakerMuted);
      }

      if (this.voiceAssistant) {
        if (this.isSpeakerMuted) {
          this.voiceAssistant._stopAllAudioPlayback();
          if (this.voiceAssistant.outputAnalyser) {
            this.voiceAssistant.outputAnalyser.disconnect();
          }
        } else {
          this.voiceAssistant._initAudioOutput();
        }
      }
    }
  }

  // Initialize on document ready
  document.addEventListener('DOMContentLoaded', () => {
    window.liveVoiceInstance = new LiveVoiceManager();
  });
})();
