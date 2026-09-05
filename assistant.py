import os
import sys
import json
import webbrowser
import subprocess
import datetime
import requests
import re
import psutil
import pyautogui
import pygetwindow as gw

OLLAMA_URL = "http://127.0.0.1:11434/api/chat"
MODEL_NAME = "qwen3:4b-instruct"

SYSTEM_PROMPT = """You are Aetheria, an ultra-capable, autonomous Desktop AI Assistant with FULL SYSTEM ACCESS to the user's computer.
You have real-time neural intelligence and direct system control capabilities.

Whenever the user asks you to perform an action on their computer, take control, write files, inspect system resources, open software, search, take screenshots, type, or execute commands, you MUST invoke a tool call at the end of your response using:
[TOOL: action_name | arg]

Available Full-Access Tools:
- [TOOL: run_command | powershell command] (Execute any shell command, script, or batch file)
- [TOOL: open_app | app_name] (calc, notepad, chrome, explorer, cmd, taskmgr, code, spotify, etc.)
- [TOOL: close_app | process_name] (e.g. notepad.exe, calc.exe, chrome.exe)
- [TOOL: open_url | https://example.com] (Open any website or URL)
- [TOOL: web_search | search query] (Search Google / YouTube)
- [TOOL: take_screenshot | filename.png] (Captures user screen)
- [TOOL: type_text | text to type] (Direct keyboard typing automation)
- [TOOL: press_key | enter, space, tab, ctrl+c, alt+f4, etc.]
- [TOOL: create_file | path::content] (Write any text or code file directly to disk)
- [TOOL: read_file | file_path] (Read file contents)
- [TOOL: list_files | folder_path] (View files in any folder)
- [TOOL: system_info | none] (Detailed CPU %, RAM %, Disk %, battery & uptime)
- [TOOL: list_processes | none] (List top running applications)
- [TOOL: get_time | none] (Current date, day and exact time)
- [TOOL: volume_set | 0-100]
- [TOOL: lock_pc | none]

Tone & Persona:
You are sharp, lightning fast, highly capable, proactive, and respectful. Immediately confirm execution of requested system operations."""

class AssistantBrain:
    def __init__(self, model=MODEL_NAME):
        self.model = model
        self.conversation_history = [
            {"role": "system", "content": SYSTEM_PROMPT}
        ]
        
    def reset_chat(self):
        self.conversation_history = [
            {"role": "system", "content": SYSTEM_PROMPT}
        ]

    def execute_tool(self, action, arg=""):
        action = action.strip().lower()
        arg = arg.strip()
        
        try:
            # 1. Shell Command Execution (Full Access)
            if action == "run_command":
                res = subprocess.run(
                    ["powershell", "-Command", arg],
                    capture_output=True,
                    text=True,
                    timeout=20
                )
                output = (res.stdout or res.stderr or "Executed successfully.").strip()
                if len(output) > 500:
                    output = output[:500] + "... [truncated]"
                return f"PowerShell Output:\n{output}"

            # 2. Application Control
            elif action == "open_app":
                app = arg.lower()
                common_apps = {
                    "calc": "calc.exe",
                    "calculator": "calc.exe",
                    "notepad": "notepad.exe",
                    "chrome": "start chrome",
                    "google": "start chrome",
                    "explorer": "explorer.exe",
                    "files": "explorer.exe",
                    "cmd": "start cmd.exe",
                    "terminal": "start wt.exe",
                    "taskmgr": "taskmgr.exe",
                    "task manager": "taskmgr.exe",
                    "code": "code",
                    "vscode": "code",
                    "spotify": "start spotify:"
                }
                cmd = common_apps.get(app, f"start {arg}")
                subprocess.Popen(cmd, shell=True)
                return f"Launched application: {arg}"

            elif action == "close_app":
                target = arg if arg.endswith(".exe") else f"{arg}.exe"
                subprocess.run(f"taskkill /f /im {target}", shell=True, capture_output=True)
                return f"Closed process: {target}"

            # 3. Web & Search
            elif action == "open_url":
                url = arg if arg.startswith("http") else f"https://{arg}"
                webbrowser.open(url)
                return f"Opened URL: {url}"

            elif action == "web_search":
                search_url = f"https://www.google.com/search?q={requests.utils.quote(arg)}"
                webbrowser.open(search_url)
                return f"Searched web for: '{arg}'"

            # 4. Keyboard & Screen Automation
            elif action == "take_screenshot":
                fn = arg if arg else f"screenshot_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}.png"
                save_path = os.path.join(os.path.expanduser("~"), "Desktop", fn)
                pyautogui.screenshot(save_path)
                return f"Screenshot saved to Desktop: {save_path}"

            elif action == "type_text":
                pyautogui.write(arg, interval=0.03)
                return f"Typed: '{arg}'"

            elif action == "press_key":
                keys = [k.strip() for k in arg.split("+")]
                if len(keys) > 1:
                    pyautogui.hotkey(*keys)
                else:
                    pyautogui.press(keys[0])
                return f"Pressed key combination: {arg}"

            # 5. File System Read/Write
            elif action == "create_file":
                parts = arg.split("::", 1)
                file_path = parts[0].strip()
                content = parts[1] if len(parts) > 1 else ""
                with open(file_path, "w", encoding="utf-8") as f:
                    f.write(content)
                return f"File created successfully at {file_path} ({len(content)} bytes)"

            elif action == "read_file":
                if os.path.exists(arg):
                    with open(arg, "r", encoding="utf-8", errors="ignore") as f:
                        data = f.read(1500)
                    return f"File content of {arg}:\n{data}"
                return f"File not found: {arg}"

            elif action == "list_files":
                target_dir = arg if arg else os.getcwd()
                if os.path.exists(target_dir):
                    items = os.listdir(target_dir)[:25]
                    return f"Contents of {target_dir}:\n" + "\n".join(f"- {i}" for i in items)
                return f"Directory not found: {target_dir}"

            # 6. System Diagnostics & Performance
            elif action == "system_info":
                cpu = psutil.cpu_percent(interval=0.3)
                mem = psutil.virtual_memory()
                disk = psutil.disk_usage('/')
                boot_time = datetime.datetime.fromtimestamp(psutil.boot_time()).strftime("%Y-%m-%d %H:%M")
                now = datetime.datetime.now().strftime("%I:%M %p, %A, %B %d, %Y")
                
                return (
                    f"System Diagnostics:\n"
                    f"- Local Time: {now}\n"
                    f"- CPU Load: {cpu}%\n"
                    f"- RAM: {mem.percent}% used ({mem.used // (1024**3)}GB / {mem.total // (1024**3)}GB)\n"
                    f"- Disk: {disk.percent}% used ({disk.free // (1024**3)}GB free)\n"
                    f"- System Boot: {boot_time}"
                )

            elif action == "list_processes":
                procs = []
                for p in psutil.process_iter(['name', 'memory_percent', 'cpu_percent']):
                    try:
                        procs.append(p.info)
                    except:
                        pass
                procs.sort(key=lambda x: x.get('memory_percent') or 0, reverse=True)
                top_procs = [f"- {p['name']} (RAM: {p.get('memory_percent', 0):.1f}%)" for p in procs[:8]]
                return "Top Active Processes:\n" + "\n".join(top_procs)

            elif action == "get_time":
                now = datetime.datetime.now().strftime("%I:%M %p on %A, %B %d, %Y")
                return f"Current local time is {now}."

            elif action == "lock_pc":
                subprocess.run("rundll32.exe user32.dll,LockWorkStation", shell=True)
                return "PC workstation locked."

            else:
                return f"Unrecognized action: {action}"

        except Exception as e:
            return f"Error executing tool {action}: {str(e)}"

    def chat_stream(self, user_text, callback=None):
        self.conversation_history.append({"role": "user", "content": user_text})
        
        gemini_key = os.environ.get("GEMINI_API_KEY", "")
        full_reply = ""

        # 1. High-speed Gemini Cloud LLM
        if gemini_key:
            try:
                gemini_url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:streamGenerateContent?key={gemini_key}&alt=sse"
                gemini_contents = []
                for msg in self.conversation_history:
                    if msg["role"] == "system":
                        continue
                    role = "model" if msg["role"] == "assistant" else "user"
                    gemini_contents.append({"role": role, "parts": [{"text": msg["content"]}]})

                res = requests.post(
                    gemini_url,
                    json={
                        "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
                        "contents": gemini_contents
                    },
                    stream=True,
                    timeout=20
                )
                if res.status_code == 200:
                    for line in res.iter_lines():
                        if line:
                            decoded = line.decode('utf-8')
                            if decoded.startswith('data: '):
                                try:
                                    parsed = json.loads(decoded[6:])
                                    token = parsed.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")
                                    if token:
                                        full_reply += token
                                        if callback: callback(token)
                                except Exception:
                                    pass
            except Exception as e:
                print(f"[Gemini Cloud Error, falling back]: {e}")

        # 2. Local Ollama Fallback if Gemini did not respond
        if not full_reply:
            payload = {
                "model": self.model,
                "messages": self.conversation_history,
                "stream": True,
                "options": {
                    "temperature": 0.6
                }
            }
            try:
                resp = requests.post(OLLAMA_URL, json=payload, stream=True, timeout=120)
                if resp.status_code == 200:
                    for line in resp.iter_lines():
                        if line:
                            chunk = json.loads(line.decode('utf-8'))
                            token = chunk.get("message", {}).get("content", "")
                            full_reply += token
                            if callback and token:
                                callback(token)
                            if chunk.get("done", False):
                                break
            except Exception as e:
                err_msg = f"Connection error: {str(e)}"
                if callback: callback(err_msg)
                return err_msg

        # Parse and execute tools autonomously
        tool_matches = re.findall(r'\[TOOL:\s*([^\|\]]+)(?:\|\s*([^\]]*))?\]', full_reply)
        executed_tool_feedback = ""
        for tool_action, tool_arg in tool_matches:
            tool_res = self.execute_tool(tool_action.strip(), tool_arg.strip())
            executed_tool_feedback += f"\n⚡ [SYSTEM ACTION]: {tool_res}"

        clean_reply = re.sub(r'\[TOOL:[^\]]+\]', '', full_reply).strip()
        if executed_tool_feedback:
            clean_reply += f"\n\n{executed_tool_feedback.strip()}"

        self.conversation_history.append({"role": "assistant", "content": full_reply})
        return clean_reply
