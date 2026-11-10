import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.chukta.mobile',
  appName: 'Chukta',
  webDir: 'dist',
  // Lets a test build talk to a plain-http server on your Wi-Fi. Remove once the server is on HTTPS.
  android: { allowMixedContent: true },
};

export default config;
