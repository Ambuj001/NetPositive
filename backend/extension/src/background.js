// Service worker. Holds the code/PIN only in session storage (memory, never on disk) and hands it
// to the ONE tab it opened. It is deleted when the result arrives, the tab is closed, or after 10 minutes.
//
// Flow: check runs in a background tab. If Woohoo needs a login, the tab comes to the front; once the user
// has logged in we send the tab back to the check page, finish the check, close the tab, return the user to
// the page they were on, and surface the result (side panel + badge).
importScripts('flow.js');

const CHECK_URL = 'https://www.woohoo.in/profile/check-balance';
const TIMEOUT_ALARM = 'np-timeout';
const EXPIRE_ALARM = 'np-expire';
const TIMEOUT_MINUTES = 0.75; // 45 s without progress -> ask the user
const EXPIRE_MINUTES = 10;    // hard limit; also how long the code is kept (covers a slow OTP login)

// Clicking the toolbar icon opens the side panel (like MetaMask) instead of a small popup.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

const store = chrome.storage.session;
const setStatus = (state, extra = {}) => store.set({ status: { state, ...extra } });
const getStatus = async () => (await store.get('status')).status;
const armTimeout = () => chrome.alarms.create(TIMEOUT_ALARM, { delayInMinutes: TIMEOUT_MINUTES });

async function focusTab(tabId) {
  try {
    const tab = await chrome.tabs.update(tabId, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  } catch { /* tab was closed */ }
}

async function bringToFront(tabId, state, extra = {}) {
  const prev = (await getStatus()) ?? {};
  await setStatus(state, { ...prev, ...extra, tabId });
  await focusTab(tabId);
}

/** Drop the secret and any timers. */
async function cleanup() {
  await store.remove('pending');
  chrome.alarms.clear(TIMEOUT_ALARM);
  chrome.alarms.clear(EXPIRE_ALARM);
}

async function showResult(valid, returnTabId) {
  // The side panel updates live if it is open. Badge covers the case where it is closed.
  chrome.action.setBadgeBackgroundColor({ color: valid ? '#2f7a4d' : '#b3382c' });
  chrome.action.setBadgeText({ text: valid ? '✓' : '✗' });
  try {
    const tab = returnTabId != null ? await chrome.tabs.get(returnTabId) : null;
    if (tab) await chrome.sidePanel.open({ windowId: tab.windowId }); // needs a user gesture; may be refused
  } catch { /* refused: the badge tells the user */ }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    const tabId = sender.tab?.id;
    if (msg.type === 'np:start') {
      const [current] = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = await chrome.tabs.create({ url: CHECK_URL, active: false });
      await store.set({
        pending: { code: msg.code, pin: msg.pin, expectedPaise: msg.expectedPaise, tabId: tab.id },
      });
      await store.remove('result');
      await setStatus('checking', { tabId: tab.id, returnTabId: current?.id ?? null });
      chrome.action.setBadgeText({ text: '' });
      armTimeout();
      chrome.alarms.create(EXPIRE_ALARM, { delayInMinutes: EXPIRE_MINUTES });
      sendResponse({ ok: true });
    } else if (msg.type === 'np:getPending') {
      // The secret only ever goes to a woohoo.in check-balance page (our content script is scoped to it),
      // from whichever tab it is in: a login can finish in a different tab than the one we opened.
      const { pending } = await store.get('pending');
      if (pending && tabId != null && NP.isCheckPage(sender.url ?? '')) {
        if (tabId !== pending.tabId) {
          // Follow the tab the user is actually in from now on.
          await store.set({ pending: { ...pending, tabId } });
          const status = (await getStatus()) ?? {};
          await setStatus(status.state ?? 'checking', { ...status, tabId });
        }
        sendResponse({ pending });
      } else sendResponse({ pending: null });
    } else if (msg.type === 'np:needsLogin' && tabId != null) {
      // Login form shown on the check page itself (no redirect).
      chrome.alarms.clear(TIMEOUT_ALARM);
      await bringToFront(tabId, 'needs_login', { loginPath: null });
      sendResponse({ ok: true });
    } else if (msg.type === 'np:needsUser' && tabId != null) {
      await bringToFront(tabId, 'needs_user');
      sendResponse({ ok: true });
    } else if (msg.type === 'np:filled' && tabId != null) {
      // Form filled and button pressed: we are checking again (e.g. right after a login).
      const status = await getStatus();
      if (status?.tabId === tabId && status.state !== 'done') { await setStatus('checking', { ...status }); armTimeout(); }
      sendResponse({ ok: true });
    } else if (msg.type === 'np:result' && tabId != null) {
      const status = (await getStatus()) ?? {};
      await store.set({ result: { result: msg.result, verdict: msg.verdict, checkedAt: msg.checkedAt } });
      await setStatus('done');
      await cleanup();
      chrome.tabs.remove(tabId).catch(() => {});
      if (status.returnTabId != null) await focusTab(status.returnTabId); // back to where the user was
      await showResult(msg.verdict.valid, status.returnTabId);
      sendResponse({ ok: true });
    } else sendResponse({ ok: false });
  })();
  return true; // async response
});

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== 'complete' || !tab.url) return;
  const status = await getStatus();
  if (!status || status.tabId !== tabId) return;

  if (status.state === 'checking' && !NP.isCheckPage(tab.url)) {
    // Woohoo sent us away from the check page: that is the login. Remember where, and ask the user.
    chrome.alarms.clear(TIMEOUT_ALARM);
    await bringToFront(tabId, 'needs_login', { loginPath: new URL(tab.url).pathname });
  } else if (status.state === 'needs_login' && NP.shouldReturnToCheck(tab.url, status.loginPath)) {
    // The user got through the login: send the tab back to the check page.
    await setStatus('checking', { ...status });
    armTimeout();
    chrome.tabs.update(tabId, { url: CHECK_URL });
  }
});

// User closed the Woohoo tab before it finished: cancel and drop the secret.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const status = await getStatus();
  if (status?.tabId === tabId && (status.state === 'checking' || status.state === 'needs_login' || status.state === 'needs_user')) {
    await cleanup();
    await setStatus('cancelled');
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  const status = await getStatus();
  if (alarm.name === TIMEOUT_ALARM && status?.state === 'checking') {
    await bringToFront(status.tabId, 'needs_user');
  } else if (alarm.name === EXPIRE_ALARM && status && status.state !== 'done') {
    await cleanup();
    await setStatus('expired');
  }
});
