// Ported 1:1 from AgenticDesigner/DesignSystem/DevicePreset.swift

/** Platform kinds the editor knows how to design for. */
export const AllDevicePlatform = ['iPhone', 'iPad', 'appleWatch', 'mac', 'custom'] as const;
export type DevicePlatform = (typeof AllDevicePlatform)[number];

/** A screen / device preset. */
export interface DevicePreset {
  id: string;
  name: string;
  platform: DevicePlatform;

  width: number;
  height: number;

  cornerRadius: number;

  safeAreaTop: number;
  safeAreaBottom: number;
  safeAreaHorizontal: number;
}

export function devicePresetsEqual(a: DevicePreset, b: DevicePreset): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.platform === b.platform &&
    a.width === b.width &&
    a.height === b.height &&
    a.cornerRadius === b.cornerRadius &&
    a.safeAreaTop === b.safeAreaTop &&
    a.safeAreaBottom === b.safeAreaBottom &&
    a.safeAreaHorizontal === b.safeAreaHorizontal
  );
}

const iPhone15Pro: DevicePreset = {
  id: 'iphone_15_pro',
  name: 'iPhone 15 Pro',
  platform: 'iPhone',
  width: 393,
  height: 852,
  cornerRadius: 44,
  safeAreaTop: 59,
  safeAreaBottom: 34,
  safeAreaHorizontal: 0,
};

const iPhoneSE: DevicePreset = {
  id: 'iphone_se',
  name: 'iPhone SE',
  platform: 'iPhone',
  width: 375,
  height: 667,
  cornerRadius: 0,
  safeAreaTop: 20,
  safeAreaBottom: 0,
  safeAreaHorizontal: 0,
};

const iPadPro11: DevicePreset = {
  id: 'ipad_pro_11',
  name: 'iPad Pro 11',
  platform: 'iPad',
  width: 834,
  height: 1194,
  cornerRadius: 24,
  safeAreaTop: 24,
  safeAreaBottom: 20,
  safeAreaHorizontal: 0,
};

const appleWatch45: DevicePreset = {
  id: 'apple_watch_45',
  name: 'Apple Watch 45mm',
  platform: 'appleWatch',
  width: 396,
  height: 484,
  cornerRadius: 86,
  safeAreaTop: 24,
  safeAreaBottom: 24,
  safeAreaHorizontal: 12,
};

const macBookPro14: DevicePreset = {
  id: 'macbook_pro_14',
  name: 'MacBook Pro 14',
  platform: 'mac',
  width: 1512,
  height: 982,
  cornerRadius: 16,
  safeAreaTop: 0,
  safeAreaBottom: 0,
  safeAreaHorizontal: 0,
};

const all: DevicePreset[] = [iPhone15Pro, iPhoneSE, iPadPro11, appleWatch45, macBookPro14];

export const DevicePresetLibrary = {
  iPhone15Pro,
  iPhoneSE,
  iPadPro11,
  appleWatch45,
  macBookPro14,
  all,
  /** `DevicePresetLibrary.preset(for:)` */
  preset(id: string): DevicePreset | undefined {
    return all.find((preset) => preset.id === id);
  },
} as const;
