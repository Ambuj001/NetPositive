import assert from "node:assert/strict";
import { test } from "node:test";
import { appLinks, coinbaseLink, isMobile, metamaskLink, okxLink, trustLink, walletConnectOptions } from "../src/lib/walletLinks.ts";
import { CHAINS } from "../src/lib/chain.ts";

const URL_ = "https://app.netpositive.example/trade?mode=sell&x=a b";

test("MetaMask: host and path without the scheme", () => {
  assert.equal(metamaskLink("https://app.netpositive.example/trade"), "https://metamask.app.link/dapp/app.netpositive.example/trade");
  assert.equal(metamaskLink("http://localhost:5173/"), "https://metamask.app.link/dapp/localhost:5173/");
});

test("OKX: okx:// deep link wrapped in the universal link, encoded twice", () => {
  const link = okxLink(URL_);
  assert.ok(link.startsWith("https://www.okx.com/download?deeplink="));
  const deep = decodeURIComponent(link.slice("https://www.okx.com/download?deeplink=".length));
  assert.ok(deep.startsWith("okx://wallet/dapp/url?dappUrl="));
  assert.equal(decodeURIComponent(deep.slice("okx://wallet/dapp/url?dappUrl=".length)), URL_);
});

test("Trust and Coinbase: the page address as one encoded parameter", () => {
  assert.equal(trustLink(URL_), `https://link.trustwallet.com/open_url?coin_id=60&url=${encodeURIComponent(URL_)}`);
  assert.equal(new URL(trustLink(URL_)).searchParams.get("url"), URL_);
  assert.equal(coinbaseLink(URL_), `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(URL_)}`);
  assert.equal(new URL(coinbaseLink(URL_)).searchParams.get("cb_url"), URL_);
});

test("appLinks: four wallets for a web address, none for anything else", () => {
  assert.deepEqual(appLinks(URL_).map((l) => l.id), ["metamask", "okx", "trust", "coinbase"]);
  assert.ok(appLinks(URL_).every((l) => l.href.startsWith("https://")));
  assert.deepEqual(appLinks("about:blank"), []);
  assert.deepEqual(appLinks(""), []);
});

test("isMobile: phones, tablets and iPadOS, not desktops", () => {
  assert.equal(isMobile("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1"), true);
  assert.equal(isMobile("Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36"), true);
  assert.equal(isMobile("Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 Chrome/130.0 Safari/537.36"), true); // Android tablet
  assert.equal(isMobile("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15", 5), true); // iPadOS
  assert.equal(isMobile("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15", 0), false);
  assert.equal(isMobile("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36", 10), false); // touch laptop
  assert.equal(isMobile(""), false);
});

test("WalletConnect: asks for the configured Arc chain only, with its RPC and this site's origin", () => {
  const o = walletConnectOptions(CHAINS.mainnet, "https://app.netpositive.example/", "pid123");
  assert.deepEqual(o.optionalChains, [5042]);
  assert.deepEqual(o.rpcMap, { 5042: "https://rpc.mainnet.arc.io" });
  assert.equal(o.projectId, "pid123");
  assert.equal(o.showQrModal, true);
  assert.equal(o.metadata.url, "https://app.netpositive.example");
  assert.deepEqual(o.metadata.icons, ["https://app.netpositive.example/favicon.svg"]);
  assert.equal(o.metadata.name, "NetPositive");
  assert.deepEqual(walletConnectOptions(CHAINS.testnet, "http://localhost:5173", "p").optionalChains, [5042002]);
});
