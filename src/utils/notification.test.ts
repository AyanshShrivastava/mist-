import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  PushNotificationService,
  type WebPushSubscription,
} from './notificationService';
import { createMistApp } from './mistServerApp';

test('PushNotificationService auto-generates VAPID keys if none provided', () => {
  const service = new PushNotificationService({
    publicKey: '',
    privateKey: '',
  });

  const config = service.getVapidPublicConfig();
  assert.ok(config.publicKey.length > 20, 'VAPID public key should be non-empty');
  assert.ok(config.subject.includes('mistdev.ai.studio'), 'Subject should contain default domain');
  assert.equal(config.isGenerated, true);
});

test('PushNotificationService accepts explicit VAPID keys and subject', () => {
  const keypair = new PushNotificationService().generateNewKeypair();
  const service = new PushNotificationService({
    publicKey: keypair.publicKey,
    privateKey: keypair.privateKey,
    subject: 'mailto:developer@example.com',
  });

  const config = service.getVapidPublicConfig();
  assert.equal(config.publicKey, keypair.publicKey);
  assert.equal(config.subject, 'mailto:developer@example.com');
  assert.equal(config.isGenerated, false);
});

test('PushNotificationService registers, filters by user, and unregisters subscriptions', () => {
  const service = new PushNotificationService();

  const sub1: WebPushSubscription = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/sub1',
    keys: {
      p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QT9t044YjsCfqWmqurCPTxJEoKsFeQDjdFs444D8wvGWzk9s',
      auth: 'tBHItJI5svbpez7KI4CCXg',
    },
  };

  const sub2: WebPushSubscription = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/sub2',
    keys: {
      p256dh: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZfIOCeSglVwJUqwt16h394z_zJ997B_f_n4wS8',
      auth: 'k9Jb2a5Fk83lsKx210',
    },
  };

  service.addSubscription(sub1, 'user-alpha');
  service.addSubscription(sub2, 'user-beta');

  assert.equal(service.getSubscriptions().length, 2);
  assert.equal(service.getSubscriptions('user-alpha').length, 1);
  assert.equal(service.getSubscriptions('user-alpha')[0].endpoint, sub1.endpoint);
  assert.equal(service.getSubscriptions('user-beta').length, 1);

  const removed = service.removeSubscription(sub1.endpoint);
  assert.equal(removed, true);
  assert.equal(service.getSubscriptions('user-alpha').length, 0);
  assert.equal(service.getSubscriptions().length, 1);
});

test('Server notification endpoints: /sw.js, /api/notifications/vapid-public-key, /subscribe, and /keys/generate', async () => {
  const customService = new PushNotificationService();
  const app = createMistApp({
    notificationService: customService,
    verifyAuthHeader: async (header) => {
      if (header === 'Bearer valid-user-token') {
        return {
          uid: 'test-user-123',
          email: 'test@example.com',
          emailVerified: true,
          idToken: 'valid-user-token',
        };
      }
      throw new Error('Unauthorized');
    },
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. GET /sw.js
    const swRes = await fetch(`${baseUrl}/sw.js`);
    assert.equal(swRes.status, 200);
    assert.equal(swRes.headers.get('service-worker-allowed'), '/');
    assert.ok(swRes.headers.get('content-type')?.includes('application/javascript'));
    const swText = await swRes.text();
    assert.ok(swText.includes('mist-notification'));

    // 2. GET /api/notifications/vapid-public-key
    const keyRes = await fetch(`${baseUrl}/api/notifications/vapid-public-key`);
    assert.equal(keyRes.status, 200);
    const keyJson = await keyRes.json();
    assert.ok(keyJson.publicKey);
    assert.ok(keyJson.subject);

    // 3. POST /api/notifications/keys/generate
    const genRes = await fetch(`${baseUrl}/api/notifications/keys/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    assert.equal(genRes.status, 200);
    const genJson = await genRes.json();
    assert.ok(genJson.publicKey);
    assert.ok(genJson.privateKey);

    // 4. POST /api/notifications/subscribe (anonymous)
    const subPayload = {
      subscription: {
        endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/gAAAAAB...',
        keys: {
          p256dh: 'BLC4v_982Fjkl...',
          auth: '9082jkl12...',
        },
      },
    };
    const subRes = await fetch(`${baseUrl}/api/notifications/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subPayload),
    });
    assert.equal(subRes.status, 200);
    const subJson = await subRes.json();
    assert.equal(subJson.ok, true);
    assert.equal(subJson.subscription.endpoint, subPayload.subscription.endpoint);

    // 5. POST /api/notifications/subscribe (authenticated with user)
    const subResAuth = await fetch(`${baseUrl}/api/notifications/subscribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-user-token',
      },
      body: JSON.stringify(subPayload),
    });
    assert.equal(subResAuth.status, 200);
    assert.equal(customService.getSubscriptions('test-user-123').length, 1);

    // 6. POST /api/notifications/unsubscribe
    const unsubRes = await fetch(`${baseUrl}/api/notifications/unsubscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: subPayload.subscription.endpoint }),
    });
    assert.equal(unsubRes.status, 200);
    const unsubJson = await unsubRes.json();
    assert.equal(unsubJson.ok, true);
    assert.equal(customService.getSubscriptions().length, 0);
  } finally {
    server.close();
  }
});
