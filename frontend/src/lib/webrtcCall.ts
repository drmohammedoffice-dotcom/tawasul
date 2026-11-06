export type CallSignal =
  | { type: 'offer'; sdp: RTCSessionDescriptionInit }
  | { type: 'answer'; sdp: RTCSessionDescriptionInit }
  | { type: 'ice'; candidate: RTCIceCandidateInit };

export async function getLocalMedia(
  kind: 'audio' | 'video',
  opts?: { lowData?: boolean }
) {
  const low = Boolean(opts?.lowData);
  return navigator.mediaDevices.getUserMedia({
    audio: low
      ? { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 }
      : true,
    video:
      kind === 'video'
        ? low
          ? { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 15 } }
          : true
        : false
  });
}

export function createPeerConnection(iceServers: RTCIceServer[]) {
  return new RTCPeerConnection({ iceServers });
}

export async function flipCamera(stream: MediaStream) {
  const videoTrack = stream.getVideoTracks()[0];
  if (!videoTrack || typeof (videoTrack as any).getCapabilities !== 'function') {
    throw new Error('camera flip not supported');
  }
  const caps = (videoTrack as any).getCapabilities?.() as { facingMode?: string[] };
  if (!caps?.facingMode?.length) throw new Error('facingMode not supported');
  const current = videoTrack.getSettings().facingMode;
  const next = current === 'user' ? 'environment' : 'user';
  await videoTrack.applyConstraints({ facingMode: { ideal: next } });
}
