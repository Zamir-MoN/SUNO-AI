import pyttsx3
import speech_recognition as sr
import threading
import queue
import re

class VoiceEngine:
    def __init__(self, speech_rate=185, volume=1.0):
        self.speech_rate = speech_rate
        self.volume = volume
        self.recognizer = sr.Recognizer()
        self.recognizer.energy_threshold = 250
        self.recognizer.dynamic_energy_threshold = True
        self.recognizer.pause_threshold = 0.8
        self.speech_queue = queue.Queue()
        self.is_speaking = False
        self.is_listening = False
        
        # Start background TTS worker
        self.tts_thread = threading.Thread(target=self._tts_worker, daemon=True)
        self.tts_thread.start()

    def _tts_worker(self):
        """Dedicated thread to run pyttsx3 smoothly without blocking GUI or logic."""
        # Windows COM initialization for multi-threading
        try:
            import pythoncom
            pythoncom.CoInitialize()
        except Exception:
            pass

        while True:
            text = self.speech_queue.get()
            if text is None:
                break
            try:
                self.is_speaking = True
                engine = pyttsx3.init()
                engine.setProperty('rate', self.speech_rate)
                engine.setProperty('volume', self.volume)
                
                # Pick a pleasant voice if available
                voices = engine.getProperty('voices')
                for v in voices:
                    if "zira" in v.name.lower() or "eva" in v.name.lower() or "david" in v.name.lower():
                        engine.setProperty('voice', v.id)
                        break
                        
                engine.say(text)
                engine.runAndWait()
                engine.stop()
            except Exception as e:
                print(f"[VoiceEngine TTS Error]: {e}")
            finally:
                self.is_speaking = False
                self.speech_queue.task_done()

    def speak(self, text):
        """Enqueue speech to be spoken aloud."""
        if not text or not text.strip():
            return
        # Clean markdown characters for clearer speech
        clean = text.replace('*', '').replace('#', '').replace('`', '').replace('⚡', '').strip()
        # Remove tool brackets and markdown links
        clean = re.sub(r'\[TOOL:[^\]]+\]', '', clean)
        clean = re.sub(r'\[([^\]]+)\]\([^\)]+\)', r'\1', clean)
        if clean.strip():
            self.speech_queue.put(clean.strip())

    def stop_speaking(self):
        """Clears pending speech queue."""
        with self.speech_queue.mutex:
            self.speech_queue.queue.clear()

    def listen_once(self, timeout=7, phrase_time_limit=10):
        """Listens from the default system microphone and returns transcribed text."""
        self.is_listening = True
        try:
            with sr.Microphone() as source:
                self.recognizer.adjust_for_ambient_noise(source, duration=0.4)
                audio = self.recognizer.listen(source, timeout=timeout, phrase_time_limit=phrase_time_limit)
                text = self.recognizer.recognize_google(audio)
                return text.strip()
        except sr.WaitTimeoutError:
            return ""
        except sr.UnknownValueError:
            return ""
        except Exception as e:
            print(f"[SpeechRecognition Error]: {e}")
            return ""
        finally:
            self.is_listening = False

