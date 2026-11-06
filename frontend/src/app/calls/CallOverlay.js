import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
import { fetchIceServers } from '@/api/messagingExtras';
import { searchAll } from '@/api/social';
import { useI18n } from '@/i18n/I18nProvider';
import { createPeerConnection, flipCamera, getLocalMedia } from '@/lib/webrtcCall';
import { IconCameraFlip, IconHangup, IconMic, IconMute, IconPhone, IconSpeaker, IconUserPlus, IconVideo, IconVolume } from '../ui/Icons';
export function CallOverlay({ socket, currentUserId, incoming, active, onClearIncoming, onActiveChange, turnNote }) {
    const { t } = useI18n();
    const localVideoRef = useRef(null);
    const remoteVideoRef = useRef(null);
    const remoteAudioRef = useRef(null);
    const pcRef = useRef(null);
    const localStreamRef = useRef(null);
    const [muted, setMuted] = useState(false);
    const [videoOff, setVideoOff] = useState(false);
    const [speakerOn, setSpeakerOn] = useState(true);
    const [error, setError] = useState('');
    const [iceNote, setIceNote] = useState('');
    const [inviteOpen, setInviteOpen] = useState(false);
    const [inviteQ, setInviteQ] = useState('');
    const [invitePeople, setInvitePeople] = useState([]);
    useEffect(() => {
        if (!socket)
            return;
        const onSignal = async (payload) => {
            if (!active || payload.callId !== active.callId)
                return;
            const pc = pcRef.current;
            if (!pc)
                return;
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
                }
                else if (payload.signal.type === 'answer') {
                    await pc.setRemoteDescription(payload.signal.sdp);
                }
                else if (payload.signal.type === 'ice' && payload.signal.candidate) {
                    await pc.addIceCandidate(payload.signal.candidate);
                }
            }
            catch (err) {
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
        if (active.status !== 'connecting' && active.status !== 'connected')
            return;
        let canceled = false;
        void (async () => {
            try {
                const ice = await fetchIceServers();
                if (ice.note)
                    setIceNote(ice.note);
                if (canceled)
                    return;
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
                        if (!params.encodings?.length)
                            params.encodings = [{}];
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
                    if (!ev.candidate || !socket)
                        return;
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
            }
            catch (err) {
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
                .then((res) => setInvitePeople((res.users || []).filter((u) => u.id !== currentUserId && u.id !== active?.peerUserId).slice(0, 10)))
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
        if (!incoming || !socket)
            return;
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
        if (!incoming || !socket)
            return;
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
        if (!track)
            return;
        track.enabled = !track.enabled;
        setMuted(!track.enabled);
    }
    function toggleVideo() {
        const track = localStreamRef.current?.getVideoTracks()[0];
        if (!track)
            return;
        track.enabled = !track.enabled;
        setVideoOff(!track.enabled);
    }
    function toggleSpeaker() {
        const next = !speakerOn;
        setSpeakerOn(next);
        if (remoteAudioRef.current)
            remoteAudioRef.current.muted = !next;
        if (remoteVideoRef.current)
            remoteVideoRef.current.muted = !next;
    }
    async function onFlip() {
        if (!localStreamRef.current)
            return;
        try {
            await flipCamera(localStreamRef.current);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
    }
    function inviteFriend(userId) {
        if (!socket || !active)
            return;
        // Ring friend into a new DM call of the same kind; they can join the conversation.
        socket.emit('call:invite', { peerUserId: userId, kind: active.kind, scope: 'dm' }, () => undefined);
        setInviteOpen(false);
        setInviteQ('');
    }
    if (!incoming && !active)
        return null;
    return (_jsx("div", { className: `call-overlay ${active ? 'call-overlay-full' : ''}`, role: "dialog", "aria-modal": "true", children: _jsxs("div", { className: `call-card ${active ? 'call-card-full' : ''}`, children: [incoming ? (_jsxs("div", { className: "call-incoming", children: [_jsx("p", { className: "call-peer-name", children: incoming.from.displayName || incoming.from.username }), _jsx("p", { className: "muted", children: incoming.kind === 'video' ? t('videoCall') : t('audioCall') }), _jsxs("div", { className: "call-actions", children: [_jsx("button", { type: "button", className: "call-fab accept", onClick: acceptIncoming, "aria-label": t('acceptCall'), children: _jsx(IconPhone, { size: 26 }) }), _jsx("button", { type: "button", className: "call-fab hangup", onClick: rejectIncoming, "aria-label": t('rejectCall'), children: _jsx(IconHangup, { size: 26 }) })] })] })) : null, active ? (_jsxs(_Fragment, { children: [_jsxs("div", { className: `call-videos ${active.kind === 'audio' ? 'audio-only' : ''}`, children: [active.kind === 'video' ? (_jsx("video", { ref: remoteVideoRef, playsInline: true, autoPlay: true, className: "call-remote", muted: !speakerOn })) : (_jsxs("div", { className: "call-audio-stage", children: [_jsx("strong", { children: active.peerLabel }), _jsx("span", { className: "muted", children: active.status })] })), _jsx("audio", { ref: remoteAudioRef, autoPlay: true, playsInline: true, muted: !speakerOn }), active.kind === 'video' ? (_jsx("video", { ref: localVideoRef, playsInline: true, autoPlay: true, muted: true, className: "call-local" })) : (_jsx("video", { ref: localVideoRef, playsInline: true, autoPlay: true, muted: true, className: "sr-only" }))] }), _jsx("p", { className: "call-peer-name", children: active.peerLabel }), iceNote || turnNote ? _jsx("p", { className: "muted tiny", children: iceNote || turnNote }) : null, error ? _jsx("p", { className: "auth-error", children: error }) : null, _jsxs("div", { className: "call-actions", children: [_jsx("button", { type: "button", className: `call-fab ${muted ? 'is-off' : ''}`, onClick: toggleMute, "aria-label": muted ? t('unmute') : t('mute'), children: muted ? _jsx(IconMute, { size: 22 }) : _jsx(IconMic, { size: 22 }) }), _jsx("button", { type: "button", className: `call-fab ${speakerOn ? '' : 'is-off'}`, onClick: toggleSpeaker, "aria-label": t('mute'), children: speakerOn ? _jsx(IconSpeaker, { size: 22 }) : _jsx(IconVolume, { size: 22 }) }), active.kind === 'video' ? (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", className: `call-fab ${videoOff ? 'is-off' : ''}`, onClick: toggleVideo, "aria-label": videoOff ? t('cameraOn') : t('cameraOff'), children: _jsx(IconVideo, { size: 22 }) }), _jsx("button", { type: "button", className: "call-fab", onClick: () => void onFlip(), "aria-label": t('flipCamera'), children: _jsx(IconCameraFlip, { size: 22 }) })] })) : null, _jsx("button", { type: "button", className: "call-fab", onClick: () => setInviteOpen((v) => !v), "aria-label": t('share'), children: _jsx(IconUserPlus, { size: 22 }) }), _jsx("button", { type: "button", className: "call-fab hangup", onClick: hangup, "aria-label": t('endCall'), children: _jsx(IconHangup, { size: 24 }) })] }), inviteOpen ? (_jsxs("div", { className: "call-invite-panel", children: [_jsx("input", { value: inviteQ, onChange: (e) => setInviteQ(e.target.value), placeholder: t('searchPeopleHint'), dir: "auto" }), invitePeople.map((u) => (_jsxs("button", { type: "button", className: "list-row", onClick: () => inviteFriend(u.id), children: ["@", u.username] }, u.id)))] })) : null] })) : null] }) }));
}
