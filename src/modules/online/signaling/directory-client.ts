import { apiUrl } from '~/modules/api';
import { RoomInfoResponse } from '~/modules/online/signaling/protocol';

const ROOM_INFO_TIMEOUT_MS = 5_000;

/** Whether a room exists and who hosts it, without claiming a seat. Everything else goes over the
 * relay socket (`RelayRoomConnection`); this one is a plain request so the join screen can check a
 * code before opening anything. */
export const fetchRoomInfo = async (roomCode: string): Promise<RoomInfoResponse | null> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ROOM_INFO_TIMEOUT_MS);
  try {
    const response = await fetch(apiUrl(`/online/room/${roomCode.toLowerCase()}`), { signal: controller.signal });
    if (!response.ok) return null;
    return (await response.json()) as RoomInfoResponse;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};
