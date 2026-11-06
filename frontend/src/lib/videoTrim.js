/** Client-side trim via MediaRecorder + captureStream. No server FFmpeg required. */
export async function trimVideoToBlob(file, startSec, endSec, onProgress) {
    const durationWanted = Math.max(0.5, endSec - startSec);
    if (durationWanted > 60.05) {
        throw new Error('Selected clip must be 60 seconds or less');
    }
    const url = URL.createObjectURL(file);
    try {
        const video = document.createElement('video');
        video.src = url;
        video.muted = true;
        video.playsInline = true;
        await new Promise((resolve, reject) => {
            video.onloadedmetadata = () => resolve();
            video.onerror = () => reject(new Error('Could not load video'));
        });
        const total = video.duration || 0;
        if (!total || !Number.isFinite(total))
            throw new Error('Invalid video duration');
        const start = Math.max(0, Math.min(startSec, total - 0.2));
        const end = Math.min(total, Math.max(start + 0.5, endSec));
        if (end - start > 60.05)
            throw new Error('Selected clip must be 60 seconds or less');
        // Short enough already — skip re-encode when whole file ≤ 60s and range covers all.
        if (total <= 60.05 && start <= 0.05 && end >= total - 0.05) {
            onProgress?.(100);
            return { blob: file, durationSeconds: total };
        }
        if (typeof video.captureStream !== 'function') {
            throw new Error('Video trim requires a browser that supports captureStream');
        }
        video.currentTime = start;
        await new Promise((resolve) => {
            video.onseeked = () => resolve();
        });
        const stream = video.captureStream();
        const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
            ? 'video/webm;codecs=vp9'
            : 'video/webm';
        const recorder = new MediaRecorder(stream, { mimeType: mime });
        const chunks = [];
        recorder.ondataavailable = (e) => {
            if (e.data.size)
                chunks.push(e.data);
        };
        const stopped = new Promise((resolve, reject) => {
            recorder.onstop = () => resolve(new Blob(chunks, { type: mime }));
            recorder.onerror = () => reject(new Error('Recording failed'));
        });
        recorder.start(200);
        onProgress?.(10);
        await video.play();
        await new Promise((resolve) => {
            const tick = () => {
                const t = video.currentTime;
                const pct = 10 + Math.min(85, ((t - start) / (end - start)) * 85);
                onProgress?.(pct);
                if (t >= end - 0.05 || video.ended) {
                    video.pause();
                    resolve();
                    return;
                }
                requestAnimationFrame(tick);
            };
            tick();
        });
        recorder.stop();
        stream.getTracks().forEach((t) => t.stop());
        const blob = await stopped;
        onProgress?.(100);
        return { blob, durationSeconds: end - start };
    }
    finally {
        URL.revokeObjectURL(url);
    }
}
export function loadVideoDuration(file) {
    const url = URL.createObjectURL(file);
    return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.src = url;
        video.onloadedmetadata = () => {
            const d = video.duration;
            URL.revokeObjectURL(url);
            if (!d || !Number.isFinite(d))
                reject(new Error('Invalid duration'));
            else
                resolve(d);
        };
        video.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Could not read video'));
        };
    });
}
