export const permissionPalettes = {
  light: {
    background: '#FFFFFF', surface: '#FFFFFF', frame: '#ECEEF1',
    shadow: '#F6F7F9', placeholder: '#E4E7EB', radio: '#E2E5EA',
    icon: '#F0F2F5', halo: '#F2F6FF', ink: '#131A2C', muted: '#8A91A0',
    button: '#EFF0F3', dot: '#E7E9EE', error: '#FFF1F1', errorText: '#CA4149',
  },
  dark: {
    background: '#050505', surface: '#15171C', frame: '#292C33',
    shadow: '#101115', placeholder: '#343842', radio: '#3A3E48',
    icon: '#252932', halo: '#101C33', ink: '#F4F5F7', muted: '#B0B0B0',
    button: '#1D1D1D', dot: '#3A3E48', error: '#2A1519', errorText: '#FFABB4',
  },
} as const;

export type PermissionPalette = typeof permissionPalettes[keyof typeof permissionPalettes];
