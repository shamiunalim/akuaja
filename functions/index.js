const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getAuth } = require("firebase-admin/auth");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");
initializeApp();
const db = getFirestore();
// Keep this allowlist in trusted server code too; do not rely on UI checks.
const DEVELOPER_EMAILS = ["shamiunaje@gmail.com"];

exports.broadcastPushNotification = onDocumentCreated("broadcasts/{broadcastId}", async (event) => {
  const data = event.data?.data();
  if (!data) return;
  // Firestore Rules restrict creation to verified developer accounts. This trigger
  // sends push to registered browser tokens after an authorized broadcast is stored.
  if (!DEVELOPER_EMAILS.includes(String(data.senderEmail || "").toLowerCase())) {
    console.warn("Broadcast sender not in server allowlist; push skipped.");
    return;
  }
  const snapshot = await db.collection("fcmTokens").get();
  const docs = snapshot.docs;
  const tokens = [...new Set(docs.map(d => d.get("token")).filter(t => typeof t === "string" && t.length))];
  if (!tokens.length) return;
  const message = {
    notification: { title: String(data.title || "Maxiel Web").slice(0, 100), body: String(data.message || "").slice(0, 2000) },
    data: { title: String(data.title || "Maxiel Web").slice(0, 100), body: String(data.message || "").slice(0, 2000), url: "/" },
    tokens
  };
  // FCM multicast accepts up to 500 registration tokens per request.
  for (let i = 0; i < message.tokens.length; i += 500) {
    const batch = message.tokens.slice(i, i + 500);
    const result = await getMessaging().sendEachForMulticast({ ...message, tokens: batch });
    const stale = [];
    result.responses.forEach((response, index) => {
      if (!response.success && ["messaging/registration-token-not-registered", "messaging/invalid-registration-token"].includes(response.error?.code)) {
        const token = batch[index];
        const doc = docs.find(d => d.get("token") === token);
        if (doc) stale.push(doc.ref.delete());
      }
    });
    await Promise.all(stale);
  }
});


// Menghitung seluruh akun Firebase Authentication secara global.
// Endpoint hanya melayani pengguna yang sudah login; jumlah dihitung di server.
exports.getRegisteredUserCount = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Login diperlukan untuk melihat statistik pengguna.");
  }
  try {
    let count = 0;
    let pageToken;
    do {
      const page = await getAuth().listUsers(1000, pageToken);
      count += page.users.length;
      pageToken = page.pageToken;
    } while (pageToken);
    return { count };
  } catch (error) {
    console.error("Gagal menghitung akun Firebase Authentication:", error);
    throw new HttpsError("internal", "Total pengguna tidak dapat dimuat saat ini.");
  }
});
