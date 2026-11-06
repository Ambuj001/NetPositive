"""Live LLM test for the merchant/website flows. Run: PYTHONIOENCODING=utf-8 python tests/live_test2.py"""
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
import engine  # noqa: E402
from llm import MODEL, Chat  # noqa: E402

engine.STATE_FILE = Path(tempfile.mkdtemp()) / "pf.json"
print("MODEL:", MODEL)
for c in ["HDFC Infinia", "Amazon Pay ICICI", "Axis Magnus"]:
    engine.add_card("saad", c)
engine.add_card("shivam", "ICICI Emeralde")


def show(chat, q):
    print("\nUSER>", q)
    a = chat.send(q)
    print("BOT>", a)
    print("tools:", [(n, a_) for n, a_ in chat.tool_log[-2:]])
    return a


saad = Chat("saad", "buyer")
a1 = show(saad, "I want Nike shoes from Amazon, around 10000 rupees. What should I do?")
a2 = show(saad, "Which of my cards is best if I just pay directly on swiggy.com, 800 rupees?")
a3 = show(saad, "And on some site called examplestore.com?")
a4 = show(saad, "Is my ICICI Sapphiro better?")

shivam = Chat("shivam", "buyer")
b1 = show(shivam, "Which of my cards is best on amazon.in for 5000 rupees?")

print("\n--- CHECKS ---")
txt_saad = " ".join([a1, a2, a3, a4]).lower()
txt_shivam = b1.lower()
print("Saad replies mention Emeralde/Shivam-only card:", "emeralde" in txt_saad)
print("Shivam reply mentions Infinia/Magnus/Amazon Pay:", any(w in txt_shivam for w in ["infinia", "magnus", "amazon pay"]))
print("Saad tool calls:", [n for n, _ in saad.tool_log])
