/* eslint-disable no-undef */
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

self.addEventListener("push", (event) => {
  let data = { title: "Companion", body: "Update" };
  try {
    data = { ...data, ...event.data.json() };
  } catch {
    try {
      data.body = event.data.text();
    } catch {
      /* ignore */
    }
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Companion", {
      body: data.body || "",
      tag: data.tag || "companion",
      data: data.data || {},
      renotify: true,
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow("/");
    })
  );
});
