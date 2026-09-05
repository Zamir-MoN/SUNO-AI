import sys
import json
import webbrowser
import subprocess
import datetime
import os
import psutil
import pyautogui

def execute_pc_action(action, arg=""):
    action = (action or "").strip().lower()
    arg = (arg or "").strip()
    
    try:
        if action == "open_app":
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
            return f"Launched {arg}"

        elif action == "close_app":
            target = arg if arg.endswith(".exe") else f"{arg}.exe"
            subprocess.run(f"taskkill /f /im {target}", shell=True, capture_output=True)
            return f"Closed {target}"

        elif action == "open_url":
            url = arg if arg.startswith("http") else f"https://{arg}"
            webbrowser.open(url)
            return f"Opened {url}"

        elif action == "web_search":
            url = f"https://www.google.com/search?q={arg}"
            webbrowser.open(url)
            return f"Searched for '{arg}'"

        elif action == "take_screenshot":
            desktop = os.path.join(os.path.expanduser("~"), "Desktop")
            fn = f"screenshot_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}.png"
            path = os.path.join(desktop, fn)
            pyautogui.screenshot(path)
            return f"Screenshot saved to Desktop as {fn}"

        elif action == "system_info":
            cpu = psutil.cpu_percent(interval=0.2)
            mem = psutil.virtual_memory().percent
            now = datetime.datetime.now().strftime("%I:%M %p, %A, %B %d, %Y")
            return f"CPU: {cpu}%, RAM: {mem}%, Time: {now}"

        elif action == "get_time":
            now = datetime.datetime.now().strftime("%I:%M %p on %A, %B %d, %Y")
            return f"Current time is {now}"

        elif action == "run_command":
            res = subprocess.run(["powershell", "-Command", arg], capture_output=True, text=True, timeout=15)
            out = (res.stdout or res.stderr or "Executed successfully.").strip()
            return out[:300]

        else:
            return f"Executed action {action}"

    except Exception as e:
        return f"Error executing {action}: {str(e)}"

if __name__ == "__main__":
    if len(sys.argv) > 1:
        action_name = sys.argv[1]
        action_arg = sys.argv[2] if len(sys.argv) > 2 else ""
        result = execute_pc_action(action_name, action_arg)
        print(result)
