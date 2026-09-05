import sys
from assistant import AssistantBrain
from voice_engine import VoiceEngine

def main():
    print("===============================================================")
    print("    ⚡ AETHERIA REAL DESKTOP AI - FULL SYSTEM ACCESS (CLI)     ")
    print("  Local Neural Core (Ollama qwen3:4b-instruct) • Real Voice    ")
    print("===============================================================")
    print("Commands:")
    print(" - Type any message or instruction (e.g. 'open chrome', 'show system stats')")
    print(" - Type 'speak' to read aloud the last answer")
    print(" - Type 'voice' to activate microphone listening")
    print(" - Type 'clear' to reset conversation history")
    print(" - Type 'exit' to quit\n")

    brain = AssistantBrain()
    voice = VoiceEngine()
    last_reply = ""

    while True:
        try:
            user_input = input("You > ").strip()
            if not user_input:
                continue

            if user_input.lower() in ["exit", "quit"]:
                print("Shutting down Aetheria. Goodbye!")
                break

            if user_input.lower() == "clear":
                brain.reset_chat()
                print("[Conversation memory cleared]\n")
                continue

            if user_input.lower() == "speak":
                if last_reply:
                    print("🔊 Reading aloud...")
                    voice.speak(last_reply)
                else:
                    print("(No previous reply to speak)\n")
                continue

            if user_input.lower() == "voice":
                print("🎙️ Listening... Speak now:")
                user_input = voice.listen_once()
                if not user_input:
                    print("(No speech detected)\n")
                    continue
                print(f"Heard > {user_input}")

            print("\nAetheria > ", end="", flush=True)
            
            def on_token(token):
                print(token, end="", flush=True)

            reply = brain.chat_stream(user_input, callback=on_token)
            last_reply = reply

        except (KeyboardInterrupt, EOFError):
            print("\nExiting...")
            break

if __name__ == "__main__":
    main()
