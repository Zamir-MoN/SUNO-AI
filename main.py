"""
==============================================================================
AURA & AETHERIA AI ASSISTANT - PYCHARM LAUNCH ENTRY POINT (main.py)
==============================================================================
This script is configured specifically for PyCharm execution:
- Right-click this file in PyCharm -> Run 'main' (or Shift+F10)
- Auto-checks and launches:
  1. Node.js Live Voice & Web Server (server.js on http://localhost:3000)
  2. Ollama Local Neural Engine (if installed/available)
  3. Aura Web UI in default browser
  4. Desktop AI HUD GUI (app_gui.py)
==============================================================================
"""

import os
import sys
import time
import socket
import subprocess
import webbrowser
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
SERVER_SCRIPT = BASE_DIR / "server.js"
GUI_SCRIPT = BASE_DIR / "app_gui.py"
PORT = 3000

def is_port_in_use(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex(('127.0.0.1', port)) == 0

def check_ollama():
    """Ensure Ollama local neural model engine is running if available."""
    try:
        res = subprocess.run(["tasklist"], capture_output=True, text=True, check=False)
        if "ollama.exe" not in res.stdout.lower():
            print("[PyCharm Launcher] Starting Ollama background engine...")
            subprocess.Popen(["ollama", "serve"], shell=True)
            time.sleep(1.5)
        else:
            print("[PyCharm Launcher] Ollama is already active.")
    except Exception as e:
        print(f"[PyCharm Launcher] Note: Ollama check skipped ({e}).")

def start_node_server():
    """Start the Node.js Live Voice backend server if not already running."""
    if is_port_in_use(PORT):
        print(f"[PyCharm Launcher] Server is already running on http://localhost:{PORT}")
        return None

    print(f"[PyCharm Launcher] Starting Node.js Live Voice Server (port {PORT})...")
    try:
        proc = subprocess.Popen(
            ["node", str(SERVER_SCRIPT)],
            cwd=str(BASE_DIR),
            shell=True
        )
        # Wait up to 5 seconds for server to be responsive
        for _ in range(10):
            time.sleep(0.5)
            if is_port_in_use(PORT):
                print(f"[PyCharm Launcher] Server successfully started on http://localhost:{PORT}")
                return proc
        return proc
    except Exception as e:
        print(f"[PyCharm Launcher] Error starting Node server: {e}")
        return None

def main():
    print("=" * 60)
    print("🚀 AURA / AETHERIA AI ASSISTANT - PYCHARM ENVIRONMENT")
    print("=" * 60)

    # 1. Check & start Ollama
    check_ollama()

    # 2. Start Live Voice & Web Server
    server_proc = start_node_server()

    # 3. Open Aura Web & Live Voice Interface
    print("[PyCharm Launcher] Launching Aura Web UI in browser...")
    webbrowser.open(f"http://localhost:{PORT}")

    # 4. Launch Desktop Assistant GUI
    print("[PyCharm Launcher] Starting Desktop Assistant Window...")
    try:
        # Import and run app_gui directly in PyCharm's Python process
        from app_gui import ChatGPTDesktopApp
        app = ChatGPTDesktopApp()
        app.mainloop()
    except Exception as err:
        print(f"[PyCharm Launcher] Desktop GUI closed or exited: {err}")
    finally:
        print("[PyCharm Launcher] Exiting launcher session.")

if __name__ == "__main__":
    main()
