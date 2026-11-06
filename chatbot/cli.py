"""Interactive test: python cli.py saad buyer   |   python cli.py shivam seller"""
import sys

from llm import Chat, MODEL

user, role = (sys.argv[1], sys.argv[2]) if len(sys.argv) == 3 else ("saad", "buyer")
chat = Chat(user, role)
print(f"[{role}:{user}] model={MODEL}  (Ctrl+C to quit)")
while True:
    try:
        text = input("you> ").strip()
    except (KeyboardInterrupt, EOFError):
        break
    if text:
        print("bot>", chat.send(text), "\n")
