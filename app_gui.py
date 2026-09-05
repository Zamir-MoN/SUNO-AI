import tkinter as tk
from tkinter import ttk, scrolledtext
import threading
import datetime
from assistant import AssistantBrain
from voice_engine import VoiceEngine

class ChatGPTDesktopApp(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("ChatGPT")
        self.geometry("1060x780")
        self.minsize(860, 620)
        self.configure(bg="#212121")

        # Core Engines
        self.brain = AssistantBrain()
        self.voice = VoiceEngine()

        # State
        self.is_generating = False
        self.voice_listening = False
        self.voice_output_enabled = tk.BooleanVar(value=False)
        self.last_ai_reply = ""
        self.chat_history_titles = ["New chat"]

        self._build_layout()
        self.after(300, self._render_welcome)

    def _build_layout(self):
        # 1. Main Grid: Left Sidebar (260px) + Right Main Panel
        self.sidebar_frame = tk.Frame(self, bg="#171717", width=260)
        self.sidebar_frame.pack(side=tk.LEFT, fill=tk.Y)
        self.sidebar_frame.pack_propagate(False)

        self.main_panel = tk.Frame(self, bg="#212121")
        self.main_panel.pack(side=tk.RIGHT, fill=tk.BOTH, expand=True)

        # --- SIDEBAR COMPONENTS ---
        # Top Brand & New Chat
        side_top = tk.Frame(self.sidebar_frame, bg="#171717", padx=14, pady=14)
        side_top.pack(fill=tk.X)

        brand_lbl = tk.Label(side_top, text="✦ ChatGPT", font=("Inter", 13, "bold"), bg="#171717", fg="#ECECF1")
        brand_lbl.pack(side=tk.LEFT)

        new_btn = tk.Button(
            self.sidebar_frame,
            text="+ New chat",
            command=self.new_chat,
            font=("Inter", 10),
            bg="#212121",
            fg="#ECECF1",
            relief=tk.FLAT,
            padx=12,
            pady=8,
            anchor="w",
            cursor="hand2"
        )
        new_btn.pack(fill=tk.X, padx=12, pady=(0, 10))

        # Recent Chat List
        recent_lbl = tk.Label(self.sidebar_frame, text="Recent", font=("Inter", 9, "bold"), bg="#171717", fg="#8E8E8E")
        recent_lbl.pack(anchor="w", padx=16, pady=(8, 4))

        self.history_box = tk.Listbox(
            self.sidebar_frame,
            bg="#171717",
            fg="#ECECF1",
            font=("Inter", 9),
            selectbackground="#2A2B32",
            selectforeground="#FFFFFF",
            relief=tk.FLAT,
            borderwidth=0,
            highlightthickness=0,
            activestyle="none"
        )
        self.history_box.pack(fill=tk.BOTH, expand=True, padx=10, pady=4)
        self.history_box.insert(tk.END, "Current Session")
        self.history_box.select_set(0)

        # Sidebar Bottom (Profile & Voice Toggle)
        side_bottom = tk.Frame(self.sidebar_frame, bg="#171717", padx=12, pady=12)
        side_bottom.pack(fill=tk.X, side=tk.BOTTOM)

        voice_check = tk.Checkbutton(
            side_bottom,
            text="🔊 Voice Output",
            variable=self.voice_output_enabled,
            font=("Inter", 9),
            bg="#171717",
            fg="#B4B4B4",
            selectcolor="#212121",
            activebackground="#171717",
            activeforeground="#ECECF1"
        )
        voice_check.pack(anchor="w", pady=(0, 8))

        user_card = tk.Frame(side_bottom, bg="#171717")
        user_card.pack(fill=tk.X)
        
        avatar_badge = tk.Label(user_card, text="S", font=("Inter", 9, "bold"), bg="#AB68FF", fg="white", width=3, height=1)
        avatar_badge.pack(side=tk.LEFT, padx=(0, 8))

        user_info = tk.Label(user_card, text="Personal Workspace\nLocal Ollama Core", font=("Inter", 8), bg="#171717", fg="#ECECF1", justify=tk.LEFT)
        user_info.pack(side=tk.LEFT)

        # --- MAIN PANEL COMPONENTS ---
        # Top Bar (ChatGPT 4o Pill)
        top_bar = tk.Frame(self.main_panel, bg="#212121", height=50, padx=20)
        top_bar.pack(fill=tk.X, side=tk.TOP)
        top_bar.pack_propagate(False)

        model_pill = tk.Label(
            top_bar,
            text="ChatGPT 4o  ▾",
            font=("Inter", 11, "bold"),
            bg="#212121",
            fg="#ECECF1",
            cursor="hand2"
        )
        model_pill.pack(side=tk.LEFT, pady=12)

        model_sub = tk.Label(
            top_bar,
            text="qwen3:4b-instruct (Local Neural Brain)",
            font=("Inter", 9),
            bg="#2F2F2F",
            fg="#10A37F",
            padx=8,
            pady=2
        )
        model_sub.pack(side=tk.LEFT, padx=10, pady=12)

        # On-demand Read Aloud Button in Header
        self.header_speak_btn = tk.Button(
            top_bar,
            text="🔊 Read Aloud",
            command=self.speak_last_message,
            font=("Inter", 9),
            bg="#2F2F2F",
            fg="#ECECF1",
            relief=tk.FLAT,
            padx=10,
            pady=4,
            cursor="hand2"
        )
        self.header_speak_btn.pack(side=tk.RIGHT, pady=10)

        # Chat Feed
        feed_container = tk.Frame(self.main_panel, bg="#212121", padx=40)
        feed_container.pack(fill=tk.BOTH, expand=True)

        self.chat_display = scrolledtext.ScrolledText(
            feed_container,
            wrap=tk.WORD,
            bg="#212121",
            fg="#ECECF1",
            font=("Inter", 11),
            padx=16,
            pady=16,
            relief=tk.FLAT,
            borderwidth=0,
            highlightthickness=0,
            state=tk.DISABLED
        )
        self.chat_display.pack(fill=tk.BOTH, expand=True)

        # Tag configurations for ChatGPT bubble look
        self.chat_display.tag_config("user_bubble", foreground="#ECECF1", font=("Inter", 11, "bold"))
        self.chat_display.tag_config("gpt_name", foreground="#10A37F", font=("Inter", 11, "bold"))
        self.chat_display.tag_config("content", foreground="#ECECF1", font=("Inter", 11))
        self.chat_display.tag_config("system_act", foreground="#FBBF24", font=("Inter", 10, "italic"))

        # Bottom Input Area (Centered Rounded Pill Look)
        bottom_area = tk.Frame(self.main_panel, bg="#212121", padx=40, pady=14)
        bottom_area.pack(fill=tk.X, side=tk.BOTTOM)

        input_pill = tk.Frame(bottom_area, bg="#2F2F2F", padx=14, pady=8)
        input_pill.pack(fill=tk.X)

        self.mic_btn = tk.Button(
            input_pill,
            text="🎙️",
            command=self.toggle_microphone,
            font=("Segoe UI Emoji", 12),
            bg="#2F2F2F",
            fg="#B4B4B4",
            relief=tk.FLAT,
            borderwidth=0,
            cursor="hand2"
        )
        self.mic_btn.pack(side=tk.LEFT, padx=(0, 8))

        self.text_input = tk.Entry(
            input_pill,
            font=("Inter", 12),
            bg="#2F2F2F",
            fg="#ECECF1",
            relief=tk.FLAT,
            borderwidth=0,
            insertbackground="#ECECF1"
        )
        self.text_input.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=4)
        self.text_input.bind("<Return>", lambda e: self.send_message())
        self.text_input.focus_set()

        self.send_btn = tk.Button(
            input_pill,
            text="➔",
            command=self.send_message,
            font=("Inter", 12, "bold"),
            bg="#FFFFFF",
            fg="#171717",
            relief=tk.FLAT,
            padx=8,
            pady=2,
            cursor="hand2"
        )
        self.send_btn.pack(side=tk.RIGHT, padx=(8, 0))

        disclaimer = tk.Label(
            bottom_area,
            text="ChatGPT can make mistakes. Verify important info. Powered by local Ollama neural model.",
            font=("Inter", 8),
            bg="#212121",
            fg="#8E8E8E"
        )
        disclaimer.pack(pady=(6, 0))

    def _render_welcome(self):
        welcome_text = "Hello! I am your real local ChatGPT AI Assistant. How can I help you today?"
        self.append_message("ChatGPT", welcome_text, "gpt_name")

    def append_message(self, sender, text, tag):
        self.chat_display.config(state=tk.NORMAL)
        self.chat_display.insert(tk.END, f"\n{sender}\n", tag)
        self.chat_display.insert(tk.END, f"{text}\n", "content")
        self.chat_display.see(tk.END)
        self.chat_display.config(state=tk.DISABLED)

    def new_chat(self):
        self.brain.reset_chat()
        self.voice.stop_speaking()
        self.chat_display.config(state=tk.NORMAL)
        self.chat_display.delete(1.0, tk.END)
        self.chat_display.config(state=tk.DISABLED)
        self._render_welcome()

    def send_message(self):
        query = self.text_input.get().strip()
        if not query or self.is_generating:
            return

        self.text_input.delete(0, tk.END)
        self.append_message("You", query, "user_bubble")

        # Update sidebar session name
        self.history_box.delete(0)
        self.history_box.insert(0, query[:24] + "...")
        self.history_box.select_set(0)

        self.process_generation(query)

    def toggle_microphone(self):
        if self.voice_listening or self.is_generating:
            return

        self.voice_listening = True
        self.mic_btn.config(bg="#EF4444", fg="white")

        def listen_task():
            spoken = self.voice.listen_once()
            self.after(0, lambda: self._on_speech_finished(spoken))

        threading.Thread(target=listen_task, daemon=True).start()

    def _on_speech_finished(self, text):
        self.voice_listening = False
        self.mic_btn.config(bg="#2F2F2F", fg="#B4B4B4")

        if text:
            self.append_message("You (Voice)", text, "user_bubble")
            self.process_generation(text)
        else:
            self.append_message("System", "🎙️ No speech detected. Please check your microphone and speak clearly.", "system_act")


    def process_generation(self, user_query):
        self.is_generating = True
        self.send_btn.config(state=tk.DISABLED, bg="#676767")

        self.chat_display.config(state=tk.NORMAL)
        self.chat_display.insert(tk.END, "\nChatGPT\n", "gpt_name")
        self.chat_display.config(state=tk.DISABLED)

        def worker():
            def on_token(token):
                self.after(0, lambda t=token: self._stream_token(t))

            reply = self.brain.chat_stream(user_query, callback=on_token)
            self.after(0, lambda r=reply: self._finish_generation(r))

        threading.Thread(target=worker, daemon=True).start()

    def _stream_token(self, token):
        self.chat_display.config(state=tk.NORMAL)
        self.chat_display.insert(tk.END, token, "content")
        self.chat_display.see(tk.END)
        self.chat_display.config(state=tk.DISABLED)

    def _finish_generation(self, full_reply):
        self.last_ai_reply = full_reply
        self.chat_display.config(state=tk.NORMAL)
        self.chat_display.insert(tk.END, "\n", "content")
        self.chat_display.see(tk.END)
        self.chat_display.config(state=tk.DISABLED)

        self.is_generating = False
        self.send_btn.config(state=tk.NORMAL, bg="#FFFFFF")

        # Only speak if user specifically turned on the auto-voice checkbox
        if self.voice_output_enabled.get():
            self.voice.speak(full_reply)

    def speak_last_message(self):
        """On-demand audio playback for the user."""
        if self.voice.is_speaking:
            self.voice.stop_speaking()
            self.header_speak_btn.config(text="🔊 Read Aloud", bg="#2F2F2F")
        elif self.last_ai_reply:
            self.header_speak_btn.config(text="⏹ Stop Audio", bg="#10A37F")
            self.voice.speak(self.last_ai_reply)

if __name__ == "__main__":
    app = ChatGPTDesktopApp()
    app.mainloop()
