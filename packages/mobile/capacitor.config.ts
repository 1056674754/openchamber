import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.openchamber.app',
  appName: 'OpenChamber',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    // The Android WebView serves the app from an https:// origin, so its fetch
    // and WebSocket calls to plain-http LAN servers (http://192.168.x.x) are
    // blocked as mixed content even with cleartext allowed in the manifest.
    // Allow it — LAN transport is a core feature; iOS has no equivalent issue
    // (capacitor:// scheme) and relay/tunnel traffic is TLS anyway.
    allowMixedContent: true,
  },
  plugins: {
    Keyboard: {
      // 'none': do not resize document.body. Body resize collapsed the chat
      // shell to ~header height after IME hide on Harmony (main height:0 /
      // black content). Composer lift is owned by CSS
      // position:fixed + --oc-keyboard-inset (useNativeMobileChrome).
      resize: 'none',
      resizeOnFullScreen: true,
      autoBackdropColor: 'dom',
    },
    StatusBar: {
      overlaysWebView: true,
      style: 'DEFAULT',
    },
    PushNotifications: {
      // Never display an APNs alert while the app is foreground. The server always sends
      // (no racy visibility gate); iOS suppresses the foreground banner, so there is no
      // notification when the app is active. Background pushes are shown by iOS as usual.
      presentationOptions: [],
    },
  },
};

export default config;
