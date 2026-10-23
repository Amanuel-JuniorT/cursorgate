"use strict";
const webpush = require("web-push");

/**
 * @param {import('./store').Store} store
 */
function ensureVapid(store) {
  if (!store.state.vapid) {
    const keys = webpush.generateVAPIDKeys();
    store.state.vapid = {
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
      subject: "mailto:companion@localhost",
    };
    store.save();
  }
  webpush.setVapidDetails(
    store.state.vapid.subject,
    store.state.vapid.publicKey,
    store.state.vapid.privateKey
  );
  return store.state.vapid;
}

/**
 * @param {import('./store').Store} store
 * @param {object} payload
 */
async function notifyAll(store, payload) {
  ensureVapid(store);
  const body = JSON.stringify(payload);
  const results = [];
  for (const { deviceId, sub } of store.allPushSubscriptions()) {
    try {
      await webpush.sendNotification(sub, body);
      results.push({ deviceId, ok: true });
    } catch (e) {
      results.push({ deviceId, ok: false, error: e.message });
      if (e.statusCode === 404 || e.statusCode === 410) {
        delete store.state.pushSubscriptions[deviceId];
        store.save();
      }
    }
  }
  return results;
}

module.exports = { ensureVapid, notifyAll };
