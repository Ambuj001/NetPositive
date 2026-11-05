"""Live LLM test against OpenRouter. Uses a temp state file. Run: python tests/live_test.py"""
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
import engine  # noqa: E402
from llm import MODEL, Chat  # noqa: E402

engine.STATE_FILE = Path(tempfile.mkdtemp()) / "pf.json"
FORBIDDEN_FOR_SAAD = ["Magnus", "Emeralde", "iShop", "Aurum", "ICICI", "Sapphiro"]

print("MODEL:", MODEL)
saad = Chat("saad", "buyer")
for q in ["Hi! I hold HDFC Infinia.",
          "I want a Lifestyle voucher worth 10000 rupees. Best way to buy it?",
          "What about using my Axis Magnus or ICICI Emeralde instead?"]:
    print("\nSAAD>", q)
    a = saad.send(q)
    print("BOT>", a)
    print("tools:", saad.tool_log[-3:])

reply_all = " ".join(m.get("content") or "" for m in saad.messages if m["role"] == "assistant")
leaks = [w for w in FORBIDDEN_FOR_SAAD if w.lower() in reply_all.lower()]
print("\nPortfolio saad:", engine.list_portfolio("saad"))
print("Mentions of cards outside portfolio in bot replies (may be OK if bot is declining):", leaks)

shivam = Chat("shivam", "seller")
print("\nSHIVAM> I hold 120 USDT and have the Crypto.com Obsidian card. Best way to shop for 10000 rupees?")
print("BOT>", shivam.send("I hold 120 USDT and have the Crypto.com Obsidian card. I live in India. Best way to shop for 10000 rupees?"))
print("Portfolio shivam:", engine.list_portfolio("shivam"), "| saad unchanged:", engine.list_portfolio("saad"))
