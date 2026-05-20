declare module 'react-native-capture-protection' {
  export const CaptureProtection: {
    prevent(option?: { screenshot?: boolean; record?: boolean; appSwitcher?: boolean }): Promise<void>;
    allow(option?: { screenshot?: boolean; record?: boolean; appSwitcher?: boolean }): Promise<void>;
    isScreenRecording(): Promise<boolean | undefined>;
  };
}
