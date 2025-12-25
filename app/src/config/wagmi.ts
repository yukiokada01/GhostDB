import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { sepolia } from 'wagmi/chains';

export const config = getDefaultConfig({
  appName: 'GhostDB',
  projectId: 'b0b5c133f2e84d6d9c5b8e5b4d8e3f21',
  chains: [sepolia],
  ssr: false,
});
