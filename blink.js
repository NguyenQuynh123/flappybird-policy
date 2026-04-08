(function () {
    const BLINK_EVENT = 'BLINK';
    const BLINK_DEBOUNCE_MS = 500;
    const EAR_CLOSED_THRESHOLD = 0.2;
    const EAR_OPEN_THRESHOLD = 0.24;

    const LEFT_EYE = {
        p1: 33,
        p2: 160,
        p3: 158,
        p4: 133,
        p5: 153,
        p6: 144,
    };

    const RIGHT_EYE = {
        p1: 362,
        p2: 385,
        p3: 387,
        p4: 263,
        p5: 373,
        p6: 380,
    };

    let lastBlinkAt = 0;
    let eyeClosed = false;
    let videoEl = null;
    let stream = null;
    let faceMesh = null;

    function distance2D(a, b) {
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    function computeEAR(landmarks, eye) {
        const p1 = landmarks[eye.p1];
        const p2 = landmarks[eye.p2];
        const p3 = landmarks[eye.p3];
        const p4 = landmarks[eye.p4];
        const p5 = landmarks[eye.p5];
        const p6 = landmarks[eye.p6];

        if (!p1 || !p2 || !p3 || !p4 || !p5 || !p6) {
            return 1;
        }

        const vertical = distance2D(p2, p6) + distance2D(p3, p5);
        const horizontal = 2 * distance2D(p1, p4);
        if (horizontal <= Number.EPSILON) {
            return 1;
        }

        return vertical / horizontal;
    }

    function emitBlink() {
        const now = Date.now();
        if (now - lastBlinkAt < BLINK_DEBOUNCE_MS) {
            return;
        }

        lastBlinkAt = now;
        if (window.GameEventBus && typeof window.GameEventBus.emit === 'function') {
            window.GameEventBus.emit(BLINK_EVENT);
        } else {
            console.warn('[blink] window.GameEventBus is not available.');
        }
    }

    function onResults(results) {
        const faces = results.multiFaceLandmarks;
        if (!faces || faces.length === 0) {
            eyeClosed = false;
            return;
        }

        const landmarks = faces[0];
        const leftEAR = computeEAR(landmarks, LEFT_EYE);
        const rightEAR = computeEAR(landmarks, RIGHT_EYE);
        const ear = (leftEAR + rightEAR) * 0.5;

        if (!eyeClosed && ear < EAR_CLOSED_THRESHOLD) {
            eyeClosed = true;
            return;
        }

        // Count one blink when eye transitions from closed to open.
        if (eyeClosed && ear > EAR_OPEN_THRESHOLD) {
            eyeClosed = false;
            emitBlink();
        }
    }

    async function ensureCameraAvailable() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            console.warn('[blink] getUserMedia is not supported in this browser.');
            return false;
        }

        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const hasVideoInput = devices.some((d) => d.kind === 'videoinput');
            if (!hasVideoInput) {
                console.warn('[blink] No camera device found.');
                return false;
            }
        } catch (error) {
            console.warn('[blink] Unable to enumerate media devices.', error);
        }

        return true;
    }

    function createVideoElement() {
        const video = document.createElement('video');
        video.autoplay = true;
        video.playsInline = true;
        video.muted = true;
        video.style.position = 'fixed';
        video.style.width = '1px';
        video.style.height = '1px';
        video.style.opacity = '0';
        video.style.pointerEvents = 'none';
        document.body.appendChild(video);
        return video;
    }

    async function start() {
        const canUseCamera = await ensureCameraAvailable();
        if (!canUseCamera) {
            return;
        }

        if (typeof window.FaceMesh !== 'function') {
            console.warn('[blink] MediaPipe FaceMesh is not loaded.');
            return;
        }

        videoEl = createVideoElement();

        try {
            stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'user' },
                audio: false,
            });
            videoEl.srcObject = stream;
            await videoEl.play();
        } catch (error) {
            console.warn('[blink] Unable to access camera.', error);
            return;
        }

        faceMesh = new window.FaceMesh({
            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
        });

        faceMesh.setOptions({
            maxNumFaces: 1,
            refineLandmarks: true,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5,
        });
        faceMesh.onResults(onResults);

        async function detectFrame() {
            if (!faceMesh || !videoEl) {
                return;
            }
            await faceMesh.send({ image: videoEl });
            requestAnimationFrame(detectFrame);
        }

        detectFrame();
    }

    window.BlinkDetector = {
        start,
    };
})();
