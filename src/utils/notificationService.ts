import * as webpush from 'web-push';
import fs from 'node:fs';
import path from 'node:path';

export interface WebPushKeys {
  p256dh: string;
  auth: string;
}

export interface WebPushSubscription {
  endpoint: string;
  expirationTime?: number | null;
  keys: WebPushKeys;
  userId?: string;
  createdAt?: string;
}

export interface NotificationPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: {
    url?: string;
    [key: string]: unknown;
  };
  timestamp?: number;
}

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
  isGenerated: boolean;
}

export interface PushNotificationServiceOptions {
  publicKey?: string;
  privateKey?: string;
  subject?: string;
  cacheFilePath?: string;
}

export class PushNotificationService {
  private vapidConfig: VapidConfig;
  private subscriptions: Map<string, WebPushSubscription> = new Map();

  constructor(options: PushNotificationServiceOptions = {}) {
    this.vapidConfig = this.resolveVapidKeys(options);
    this.initWebPush();
  }

  private resolveVapidKeys(options: PushNotificationServiceOptions): VapidConfig {
    const envPub = (options.publicKey || process.env.VAPID_PUBLIC_KEY || '').trim();
    const envPriv = (options.privateKey || process.env.VAPID_PRIVATE_KEY || '').trim();
    const subject = (
      options.subject ||
      process.env.VAPID_SUBJECT ||
      process.env.APP_URL ||
      'mailto:admin@mistdev.ai.studio'
    ).trim();

    if (envPub && envPriv) {
      return {
        publicKey: envPub,
        privateKey: envPriv,
        subject: subject.startsWith('http') || subject.startsWith('mailto:') ? subject : `mailto:${subject}`,
        isGenerated: false,
      };
    }

    // Try reading cached keys from local scratch/file if available to survive restarts
    const cacheFile = options.cacheFilePath || path.resolve(process.cwd(), '.vapid-cache.json');
    if (fs.existsSync(cacheFile)) {
      try {
        const raw = fs.readFileSync(cacheFile, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed.publicKey && parsed.privateKey) {
          return {
            publicKey: parsed.publicKey,
            privateKey: parsed.privateKey,
            subject: parsed.subject || subject,
            isGenerated: true,
          };
        }
      } catch {
        // Fall back to generating new keys
      }
    }

    // Generate fresh VAPID keys
    const generated = webpush.generateVAPIDKeys();
    const config: VapidConfig = {
      publicKey: generated.publicKey,
      privateKey: generated.privateKey,
      subject: subject.startsWith('http') || subject.startsWith('mailto:') ? subject : `mailto:${subject}`,
      isGenerated: true,
    };

    try {
      fs.writeFileSync(cacheFile, JSON.stringify(config, null, 2), 'utf-8');
    } catch {
      // Non-fatal if filesystem is read-only
    }

    console.info('[Mist Notifications] Auto-generated VAPID keys for Web Push:');
    console.info(`  VAPID_PUBLIC_KEY:  ${config.publicKey}`);
    console.info('  VAPID_PRIVATE_KEY: [REDACTED]');
    console.info(`  VAPID_SUBJECT:     ${config.subject}`);
    console.info('[Mist Notifications] To persist across AI Studio restarts at mistdev.ai.studio:');
    console.info('  Add VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY to the Google AI Studio Secrets / Environment Variables panel.');

    return config;
  }

  private initWebPush(): void {
    try {
      webpush.setVapidDetails(
        this.vapidConfig.subject,
        this.vapidConfig.publicKey,
        this.vapidConfig.privateKey,
      );
    } catch (err) {
      console.error('[Mist Notifications] Failed to initialize web-push VAPID details:', err);
    }
  }

  public getVapidPublicConfig(): { publicKey: string; subject: string; isGenerated: boolean } {
    return {
      publicKey: this.vapidConfig.publicKey,
      subject: this.vapidConfig.subject,
      isGenerated: this.vapidConfig.isGenerated,
    };
  }

  public generateNewKeypair(): { publicKey: string; privateKey: string } {
    return webpush.generateVAPIDKeys();
  }

  public addSubscription(
    sub: { endpoint: string; expirationTime?: number | null; keys: WebPushKeys },
    userId?: string,
  ): WebPushSubscription {
    if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
      throw new Error('Invalid push subscription object: missing endpoint or cryptographic keys.');
    }

    const record: WebPushSubscription = {
      endpoint: sub.endpoint,
      expirationTime: sub.expirationTime,
      keys: {
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
      },
      userId: userId || undefined,
      createdAt: new Date().toISOString(),
    };

    this.subscriptions.set(sub.endpoint, record);
    return record;
  }

  public removeSubscription(endpoint: string): boolean {
    return this.subscriptions.delete(endpoint);
  }

  public getSubscriptions(userId?: string): WebPushSubscription[] {
    const all = Array.from(this.subscriptions.values());
    if (!userId) return all;
    return all.filter((s) => s.userId === userId);
  }

  public async sendNotification(
    sub: WebPushSubscription,
    payload: NotificationPayload,
  ): Promise<{ success: boolean; statusCode?: number; error?: string }> {
    try {
      const payloadString = JSON.stringify({
        title: payload.title || 'Mist',
        body: payload.body || '',
        icon: payload.icon || '/favicon.ico',
        badge: payload.badge || '/favicon.ico',
        tag: payload.tag || 'mist-notification',
        data: payload.data || { url: '/' },
        timestamp: payload.timestamp || Date.now(),
      });

      const pushSub = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.keys.p256dh,
          auth: sub.keys.auth,
        },
      };

      const result = await webpush.sendNotification(pushSub, payloadString);
      return { success: true, statusCode: result.statusCode };
    } catch (err: unknown) {
      const errorObj = err as { statusCode?: number; message?: string };
      const statusCode = errorObj.statusCode || 500;
      const message = errorObj.message || String(err);

      // If subscription expired or was invalidated (404 Not Found or 410 Gone)
      if (statusCode === 404 || statusCode === 410) {
        this.removeSubscription(sub.endpoint);
      }

      return {
        success: false,
        statusCode,
        error: message,
      };
    }
  }

  public async sendNotificationToUser(
    userId: string,
    payload: NotificationPayload,
  ): Promise<{ sent: number; failed: number }> {
    const userSubs = this.getSubscriptions(userId);
    let sent = 0;
    let failed = 0;

    for (const sub of userSubs) {
      const res = await this.sendNotification(sub, payload);
      if (res.success) {
        sent++;
      } else {
        failed++;
      }
    }

    return { sent, failed };
  }

  public async broadcast(
    payload: NotificationPayload,
  ): Promise<{ sent: number; failed: number }> {
    const all = Array.from(this.subscriptions.values());
    let sent = 0;
    let failed = 0;

    for (const sub of all) {
      const res = await this.sendNotification(sub, payload);
      if (res.success) {
        sent++;
      } else {
        failed++;
      }
    }

    return { sent, failed };
  }
}

export const defaultNotificationService = new PushNotificationService();
