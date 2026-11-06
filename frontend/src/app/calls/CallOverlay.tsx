import { useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { fetchIceServers } from '@/api/messagingExtras';
import { searchAll } from '@/api/social';
import { useI18n } from '@/i18n/I18nProvider';
import { createPeerConnection, flipCamera, getLocalMedia, type CallSignal } from '@/lib/webrtcCall';
import {
  IconCameraFlip,
  IconHangup,
  IconMic,
  IconMute,
  IconPhone,
  IconSpeaker,
  IconUserPlus,
  IconVideo,
  IconVolume
} from '../ui/Icons';

export type IncomingCall = {
  callId: string;
  kind: 'audio' | 'video';
  scope: 'dm' | 'group' | 'channel';
  from: { id: string; username: string; displayName?: string | null };
  spaceId?: string;
};

type ActiveCall = {
  callId: string;
  kind: 'audio' | 'video';
  peerUserId: string;
  peerLabel: string;
  role: 'caller' | 'callee';
  status: 'ringing' | 'connecting' | 'connected' | 'ended' | 'failed';
};

type Props = {
  socket: Socket | null;
  currentUserId: string;
  incoming: IncomingCall | null;
  active: ActiveCall | null;
  onClearIncoming: () => void;
  onActiveChange: (c: ActiveCall | null) => void;
  turnNote?: string;
};

export function CallOverlay({
  socket,
  currentUserId,
  incoming,
  active,
  onClearIncoming,
  onActiveChange,
  turnNote
}: Props) {
  const { t } = useI18n();
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const [muted, setMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [error, setError] = useState('');
  const [iceNote, setIceNote] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteQ, setInviteQ] = useState('');
  const [invitePeople, setInvitePeople] = useState<any[]>([]);

  useEffect(() => {
    if (!socket) return;
    const onSignal = async (payload: { callId: string; fromUserId: string; signal: CallSignal }) => {
      if (!active || payload.callId !== active.callId) return;
      const pc = pcRef.current;
      if (!pc) return;
      try {
        if (payload.signal.type === 'offer') {
          await pc.setRemoteDescription(payload.signal.sdp);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit('call:signal', {
            callId: active.callId,
            toUserId: payload.fromUserId,
            signal: { type: 'answer', sdp: answer }
          });
        } else if (payload.signal.type === 'answer') {
          await pc.setRemoteDescription(payload.signal.sdp);
        } else if (payload.signal.type === 'ice' && payload.signal.candidate) {
          await pc.addIceCandidate(payload.signal.candidate);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : t('errorGeneric'));
      }
    };
    socket.on('call:signal', onSignal);
    return () => {
      socket.off('call:signal', onSignal);
    };
  }, [socket, active, t]);

  useEffect(() => {
    if (!active || active.status === 'ended' || active.status === 'failed') {
      cleanupMedia();
      return;
    }
    if (active.status !== 'connecting' && active.status !== 'connected') return;
    let canceled = false;
    void (async () => {
      try {
        const ice = await fetchIceServers();
        if (ice.note) setIceNote(ice.note);
        if (canceled) return;
        const { loadStoragePrefs } = await import('../focus/focusPrefs');
        const lessData = loadStoragePrefs(currentUserId).lessDataForCalls;
        const stream = await getLocalMedia(active.kind, lessData ? { lowData: true } : undefined);
        localStreamRef.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
          void localVideoRef.current.play().catch(() => undefined);
        }
        const pc = createPeerConnection(ice.iceServers || [{ urls: 'stun:stun.l.google.com:19302' }]);
        pcRef.current = pc;
        if (lessData) {
          for (const sender of pc.getSenders()) {
            const params = sender.getParameters();
            if (!params.encodings?.length) params.encodings = [{}];
            for (const enc of params.encodings) {
              enc.maxBitrate = active.kind === 'video' ? 250_000 : 24_000;
            }
            void sender.setParameters(params).catch(() => undefined);
          }
        }
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));
        pc.ontrack = (ev) => {
          const remote = ev.streams[0] || null;
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = remote;
            void remoteVideoRef.current.play().catch(() => undefined);
          }
          if (remoteAudioRef.current) {
            remoteAudioRef.current.srcObject = remote;
            remoteAudioRef.current.muted = false;
            void remoteAudioRef.current.play().catch(() => undefined);
          }
        };
        pc.onicecandidate = (ev) => {
          if (!ev.candidate || !socket) return;
          socket.emit('call:signal', {
            callId: active.callId,
            toUserId: active.peerUserId,
            signal: { type: 'ice', candidate: ev.candidate.toJSON() }
          });
        };
        pc.onconnectionstatechange = () => {
          if (pc.connectionState === 'failed') {
            onActiveChange({ ...active, status: 'failed' });
            socket?.emit('call:end', { callId: active.callId, reason: 'failed' });
          }
          if (pc.connectionState === 'connected') {
            onActiveChange({ ...active, status: 'connected' });
          }
        };
        if (active.role === 'caller') {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket?.emit('call:signal', {
            callId: active.callId,
            toUserId: active.peerUserId,
            signal: { type: 'offer', sdp: offer }
          });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : t('micPermissionDenied'));
        onActiveChange({ ...active, status: 'failed' });
      }
    })();
    return () => {
      canceled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.callId, active?.status]);

  useEffect(() => {
    if (!inviteOpen) {
      setInvitePeople([]);
      return;
    }
    const q = inviteQ.trim();
    if (q.length < 1) {
      setInvitePeople([]);
      return;
    }
    const tmr = window.setTimeout(() => {
      void searchAll(q)
        .then((res) =>
          setInvitePeople(
            (res.users || []).filter((u: any) => u.id !== currentUserId && u.id !== active?.peerUserId).slice(0, 10)
          )
        )
        .catch(() => setInvitePeople([]));
    }, 280);
    return () => window.clearTimeout(tmr);
  }, [inviteOpen, inviteQ, currentUserId, active?.peerUserId]);

  function cleanupMedia() {
    pcRef.current?.close();
    pcRef.current = null;
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
  }

  function acceptIncoming() {
    if (!incoming || !socket) return;
    socket.emit('call:accept', { callId: incoming.callId }, () => undefined);
    onActiveChange({
      callId: incoming.callId,
      kind: incoming.kind,
      peerUserId: incoming.from.id,
      peerLabel: incoming.from.displayName || incoming.from.username,
      role: 'callee',
      status: 'connecting'
    });
    onClearIncoming();
  }

  function rejectIncoming() {
    if (!incoming || !socket) return;
    socket.emit('call:reject', { callId: incoming.callId });
    onClearIncoming();
  }

  function hangup() {
    if (active && socket) {
      socket.emit('call:end', { callId: active.callId, reason: 'ended' });
    }
    cleanupMedia();
    onActiveChange(null);
    setInviteOpen(false);
  }

  function toggleMute() {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMuted(!track.enabled);
  }

  function toggleVideo() {
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setVideoOff(!track.enabled);
  }

  function toggleSpeaker() {
    const next = !speakerOn;
    setSpeakerOn(next);
    if (remoteAudioRef.current) remoteAudioRef.current.muted = !next;
    if (remoteVideoRef.current) remoteVideoRef.current.muted = !next;
  }

  async function onFlip() {
    if (!localStreamRef.current) return;
    try {
      await flipCamera(localStreamRef.current);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    }
  }

  function inviteFriend(userId: string) {
    if (!socket || !active) return;
    // Ring friend into a new DM call of the same kind; they can join the conversation.
    socket.emit(
      'call:invite',
      { peerUserId: userId, kind: active.kind, scope: 'dm' },
      () => undefined
    );
    setInviteOpen(false);
    setInviteQ('');
  }

  if (!incoming && !active) return null;

  return (
    <div className={`call-overlay ${active ? 'call-overlay-full' : ''}`} role="dialog" aria-modal="true">
      <div className={`call-card ${active ? 'call-card-full' : ''}`}>
        {incoming ? (
          <div className="call-incoming">
            <p className="call-peer-name">{incoming.from.displayName || incoming.from.username}</p>
            <p className="muted">{incoming.kind === 'video' ? t('videoCall') : t('audioCall')}</p>
            <div className="call-actions">
              <button type="button" className="call-fab accept" onClick={acceptIncoming} aria-label={t('acceptCall')}>
                <IconPhone size={26} />
              </button>
              <button type="button" className="call-fab hangup" onClick={rejectIncoming} aria-label={t('rejectCall')}>
                <IconHangup size={26} />
              </button>
            </div>
          </div>
        ) : null}

        {active ? (
          <>
            <div className={`call-videos ${active.kind === 'audio' ? 'audio-only' : ''}`}>
              {active.kind === 'video' ? (
                <video ref={remoteVideoRef} playsInline autoPlay className="call-remote" muted={!speakerOn} />
              ) : (
                <div className="call-audio-stage">
                  <strong>{active.peerLabel}</strong>
                  <span className="muted">{active.status}</span>
                </div>
              )}
              <audio ref={remoteAudioRef} autoPlay playsInline muted={!speakerOn} />
              {active.kind === 'video' ? (
                <video ref={localVideoRef} playsInline autoPlay muted className="call-local" />
              ) : (
                <video ref={localVideoRef} playsInline autoPlay muted className="sr-only" />
              )}
            </div>

            <p className="call-peer-name">{active.peerLabel}</p>
            {iceNote || turnNote ? <p className="muted tiny">{iceNote || turnNote}</p> : null}
            {error ? <p className="auth-error">{error}</p> : null}

            <div className="call-actions">
              <button type="button" className={`call-fab ${muted ? 'is-off' : ''}`} onClick={toggleMute} aria-label={muted ? t('unmute') : t('mute')}>
                {muted ? <IconMute size={22} /> : <IconMic size={22} />}
              </button>
              <button
                type="button"
                className={`call-fab ${speakerOn ? '' : 'is-off'}`}
                onClick={toggleSpeaker}
                aria-label={t('mute')}
              >
                {speakerOn ? <IconSpeaker size={22} /> : <IconVolume size={22} />}
              </button>
              {active.kind === 'video' ? (
                <>
                  <button
                    type="button"
                    className={`call-fab ${videoOff ? 'is-off' : ''}`}
                    onClick={toggleVideo}
                    aria-label={videoOff ? t('cameraOn') : t('cameraOff')}
                  >
                    <IconVideo size={22} />
                  </button>
                  <button type="button" className="call-fab" onClick={() => void onFlip()} aria-label={t('flipCamera')}>
                    <IconCameraFlip size={22} />
                  </button>
                </>
              ) : null}
              <button type="button" className="call-fab" onClick={() => setInviteOpen((v) => !v)} aria-label={t('share')}>
                <IconUserPlus size={22} />
              </button>
              <button type="button" className="call-fab hangup" onClick={hangup} aria-label={t('endCall')}>
                <IconHangup size={24} />
              </button>
            </div>

            {inviteOpen ? (
              <div className="call-invite-panel">
                <input
                  value={inviteQ}
                  onChange={(e) => setInviteQ(e.target.value)}
                  placeholder={t('searchPeopleHint')}
                  dir="auto"
                />
                {invitePeople.map((u) => (
                  <button key={u.id} type="button" className="list-row" onClick={() => inviteFriend(u.id)}>
                    @{u.username}
                  </button>
                ))}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
