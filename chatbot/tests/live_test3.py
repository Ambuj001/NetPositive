"""Live LLM test: seller request flow + buyer fulfil flow. Run: PYTHONIOENCODING=utf-8 python tests/live_test3.py"""
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
import engine  # noqa: E402
from llm import MODEL, Chat  # noqa: E402

engine.STATE_FILE = Path(tempfile.mkdtemp()) / "pf.json"
for c in ["HDFC Infinia", "ICICI Emeralde", "Axis Magnus"]:
    engine.add_card("saad", c)
print("MODEL:", MODEL)


def turn(chat, q):
    print("\nUSER>", q)
    a = chat.send(q)
    print("BOT>", a)
    print("tools:", [n for n, _ in chat.tool_log][-3:])
    return a


print("\n=========== SELLER (has ETH) ===========")
sh = Chat("shivam", "seller")
turn(sh, "I want to buy shoes")
turn(sh, "Myntra please, 8000 rupees")
turn(sh, "Actually what about nike shoes from amazon instead? 10000")

print("\n=========== BUYER (accepted request: Amazon voucher, Rs 10000) ===========")
sa = Chat("saad", "buyer")
b = turn(sa, "I accepted a request for an Amazon voucher worth 10000 rupees. How do I fulfil it?")
low = b.lower()
print("\n--- CHECKS ---")
print("mentions link gyftr:", "gyftr.com/instantvouchers" in low)
print("mentions ishop link:", "ishoprewards.com" in low)
print("mentions CRED:", "cred" in low)
print("tools used:", [n for n, _ in sa.tool_log])
