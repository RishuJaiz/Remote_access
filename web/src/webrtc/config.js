export const SIGNAL_URL =
  import.meta.env.VITE_SIGNAL_URL || "http://localhost:3001";

export const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];
