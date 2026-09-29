/**
 * Camera-only QR reader. Frames stay in memory and are never uploaded.
 *
 * start(), switchCamera() and toggleTorch() resolve to true on success or false
 * on cancellation/error. Expected errors are delivered ONLY to onError(Error),
 * so callers should not add a second catch-based error notification.
 * onDecode(text) runs once per start, after the 350 ms detection highlight.
 * Calling stop() or destroy() during that interval cancels the pending result.
 */
export class QRScanner {
  constructor({ video, overlay, onDecode, onState, onError }) {
    if (!video || !overlay) throw new TypeError('Se requieren el vídeo y el lienzo de detección.');
    this.video = video;
    this.overlay = overlay;
    this.onDecode = onDecode;
    this.onState = onState;
    this.onError = onError;
    this._document = video.ownerDocument;
    this._window = this._document.defaultView;
    this._media = this._window.navigator.mediaDevices;
    this._canvas = this._document.createElement('canvas');
    this._context = this._canvas.getContext('2d', { willReadFrequently: true });
    this._overlayContext = overlay.getContext('2d');
    this._generation = 0;
    this._destroyed = false;
    this._running = false;
    this._starting = false;
    this._stream = null;
    this._ownedStreams = new Set();
    this._openQueue = Promise.resolve();
    this._torchQueue = Promise.resolve();
    this._cameras = [];
    this._selectedCameraId = null;
    this._torchSupported = false;
    this._torchOn = false;
    this._raf = null;
    this._decodeTimer = null;
    this._quad = null;
    this._trackEndCleanup = null;
    this._visibilityHandler = () => {
      if (this._document.hidden) this.stop();
    };
    this._pageHideHandler = () => this.stop();
    this._resizeHandler = () => this._drawQuad();
    this._deviceChangeHandler = () => {
      if (!this._destroyed && (this._running || this._starting)) {
        void this._refreshCameras(this._generation);
      }
    };
    this._document.addEventListener('visibilitychange', this._visibilityHandler);
    this._window.addEventListener('pagehide', this._pageHideHandler);
    this._window.addEventListener('resize', this._resizeHandler);
    this._media?.addEventListener?.('devicechange', this._deviceChangeHandler);
    if (this._window.ResizeObserver) {
      this._resizeObserver = new this._window.ResizeObserver(this._resizeHandler);
      this._resizeObserver.observe(overlay);
    }
    video.muted = true;
    video.playsInline = true;
    this._emitState();
  }

  async start(deviceId) {
    if (this._destroyed) return false;
    this.stop();
    const token = this._generation;
    this._starting = true;
    try {
      if (!this._window.isSecureContext) {
        throw this._error('Abre esta página con HTTPS o en localhost para activar la cámara.');
      }
      if (!this._media?.getUserMedia) {
        throw this._error('Este navegador no permite acceder a la cámara. Abre la página en un navegador compatible y permite su uso.');
      }
      if (this._document.hidden) return false;
      if (!this._context || !this._overlayContext || typeof this._window.jsQR !== 'function') {
        throw this._error('No se pudo cargar el lector QR. Recarga la página e inténtalo de nuevo.');
      }

      let stream = await this._acquire(deviceId || null, token);
      if (!stream || !this._isCurrent(token)) return false;
      this._stream = stream;
      const initialId = this._streamDeviceId(stream) || deviceId || null;
      await this._refreshCameras(token, false);
      if (!this._isCurrent(token)) return false;

      // Labels become available after permission. Prefer the lowest numbered
      // rear camera, while keeping every camera available in the menu.
      const preferred = !deviceId && this._cameras.find((camera) => this._isRear(camera.label));
      if (preferred?.id && preferred.id !== initialId) {
        this._release(stream);
        this._stream = null;
        try {
          stream = await this._acquire(preferred.id, token);
        } catch (error) {
          if (!this._isCurrent(token)) return false;
          if (this._permissionError(error)) throw error;
          // Some devices expose an unavailable auxiliary lens. Recover with
          // the originally working camera rather than failing the whole scan.
          stream = await this._acquire(initialId, token);
        }
        if (!stream || !this._isCurrent(token)) return false;
        this._stream = stream;
      }

      const track = stream.getVideoTracks()[0];
      if (!track) throw this._error('No se encontró una cámara disponible. Conecta una cámara y vuelve a intentarlo.');
      this._selectedCameraId = this._streamDeviceId(stream) || deviceId || null;
      const caps = this._capabilities(track);
      this._torchSupported = caps.torch === true || (Array.isArray(caps.torch) && caps.torch.includes(true));
      this._torchOn = false;
      const adjustments = {};
      if (this._torchSupported) adjustments.torch = false;
      for (const key of ['focusMode', 'exposureMode', 'whiteBalanceMode']) {
        if (Array.isArray(caps[key]) && caps[key].includes('continuous')) adjustments[key] = 'continuous';
      }
      if (Object.keys(adjustments).length && track.applyConstraints) {
        try { await track.applyConstraints({ advanced: [adjustments] }); } catch { /* Optional camera settings. */ }
      }
      if (!this._isCurrent(token)) return false;

      this.video.srcObject = stream;
      await this.video.play();
      if (!this._isCurrent(token)) return false;
      const ended = () => {
        if (!this._isCurrent(token)) return;
        this.stop();
        this._report(this._error('La cámara se desconectó o dejó de estar disponible. Vuelve a activarla.'));
      };
      track.addEventListener?.('ended', ended);
      this._trackEndCleanup = () => track.removeEventListener?.('ended', ended);
      if (track.readyState === 'ended') {
        ended();
        return false;
      }
      this._running = true;
      this._starting = false;
      this._emitState();
      this._scan(token);
      return true;
    } catch (error) {
      if (!this._isCurrent(token)) return false;
      this.stop();
      this._report(error);
      return false;
    } finally {
      if (this._isCurrent(token)) this._starting = false;
    }
  }

  stop() {
    this._generation += 1;
    this._running = false;
    this._starting = false;
    if (this._raf !== null) this._window.cancelAnimationFrame(this._raf);
    if (this._decodeTimer !== null) this._window.clearTimeout(this._decodeTimer);
    this._raf = null;
    this._decodeTimer = null;
    this._trackEndCleanup?.();
    this._trackEndCleanup = null;
    for (const stream of this._ownedStreams) this._release(stream);
    this._stream = null;
    try { this.video.pause(); } catch { /* A detached video may already be closed. */ }
    this.video.srcObject = null;
    this._torchSupported = false;
    this._torchOn = false;
    this._torchQueue = Promise.resolve();
    this._quad = null;
    this._clearOverlay();
    this._emitState();
  }

  async switchCamera(id) {
    if (!id || this._destroyed) return false;
    return this.start(id);
  }

  async toggleTorch() {
    const token = this._generation;
    const operation = this._torchQueue.then(async () => {
      if (!this._isCurrent(token)) return false;
      const track = this._stream?.getVideoTracks()[0];
      if (!this._running || !track || !this._torchSupported) {
        this._report(this._error('El flash no está disponible en esta cámara.'));
        return false;
      }
      const enabled = !this._torchOn;
      try {
        await track.applyConstraints({ advanced: [{ torch: enabled }] });
        if (!this._isCurrent(token)) return false;
        this._torchOn = enabled;
        this._emitState();
        return true;
      } catch {
        if (this._isCurrent(token)) this._report(this._error('No se pudo cambiar el flash. Prueba con otra cámara.'));
        return false;
      }
    });
    this._torchQueue = operation.catch(() => false);
    return operation;
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this.stop();
    this._document.removeEventListener('visibilitychange', this._visibilityHandler);
    this._window.removeEventListener('pagehide', this._pageHideHandler);
    this._window.removeEventListener('resize', this._resizeHandler);
    this._media?.removeEventListener?.('devicechange', this._deviceChangeHandler);
    this._resizeObserver?.disconnect();
    this.onDecode = null;
    this.onState = null;
    this.onError = null;
    this._canvas.width = this._canvas.height = 0;
  }

  _isCurrent(token) { return !this._destroyed && token === this._generation; }

  _acquire(deviceId, token) {
    // getUserMedia is not abortable. Serializing requests prevents a stale
    // request from taking the device away from a later start/switch operation.
    const operation = this._openQueue.then(async () => {
      if (!this._isCurrent(token)) return null;
      const video = {
        width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 24 },
        ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } }),
      };
      let stream;
      try {
        stream = await this._media.getUserMedia({ video, audio: false });
      } catch (error) {
        if (!this._isCurrent(token)) return null;
        if (!['OverconstrainedError', 'ConstraintNotSatisfiedError', 'NotFoundError', 'DevicesNotFoundError'].includes(error.name)) throw error;
        stream = await this._media.getUserMedia({ video: true, audio: false });
      }
      this._ownedStreams.add(stream);
      if (!this._isCurrent(token)) {
        this._release(stream);
        return null;
      }
      return stream;
    });
    this._openQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  _release(stream) {
    this._ownedStreams.delete(stream);
    for (const track of stream.getTracks()) {
      if (track.kind === 'video' && this._capabilities(track).torch && track.applyConstraints) {
        try { Promise.resolve(track.applyConstraints({ advanced: [{ torch: false }] })).catch(() => {}); } catch { /* Stopping also disables the light. */ }
      }
      try { track.stop(); } catch { /* Continue closing any remaining tracks. */ }
    }
  }

  async _refreshCameras(token, emit = true) {
    if (!this._media?.enumerateDevices) return;
    try {
      const devices = await this._media.enumerateDevices();
      if (!this._isCurrent(token)) return;
      this._cameras = devices.filter((device) => device.kind === 'videoinput').map((device, index) => ({
        id: device.deviceId,
        label: device.label || `Cámara ${index + 1}`,
        index,
      })).sort((a, b) => {
        const rearA = this._isRear(a.label);
        const rearB = this._isRear(b.label);
        if (rearA !== rearB) return rearA ? -1 : 1;
        if (rearA) {
          const numberDifference = this._cameraNumber(a.label) - this._cameraNumber(b.label);
          if (numberDifference) return numberDifference;
          return a.label.localeCompare(b.label, 'es', { numeric: true });
        }
        return a.index - b.index;
      }).map(({ id, label }) => ({ id, label }));
      if (emit) this._emitState();
    } catch { /* Camera enumeration is optional; the active stream can still scan. */ }
  }

  _isRear(label) {
    return /back|rear|environment|traser[ao]|posterior|arrière|rück/i.test(label)
      && !/front|user|delanter[ao]|avant/i.test(label);
  }

  _cameraNumber(label) {
    const match = label.match(/camera2\s+(\d+)/i) || label.match(/\d+/);
    return match ? Number(match[1] ?? match[0]) : Infinity;
  }

  _streamDeviceId(stream) {
    const track = stream.getVideoTracks()[0];
    try { return track?.getSettings?.().deviceId || null; } catch { return null; }
  }

  _capabilities(track) {
    try { return track.getCapabilities?.() || {}; } catch { return {}; }
  }

  _scan(token) {
    let lastScan = -Infinity;
    const step = (timestamp) => {
      this._raf = null;
      if (!this._isCurrent(token) || !this._running) return;
      const width = this.video.videoWidth;
      const height = this.video.videoHeight;
      if (width && height && this.video.readyState >= 2 && timestamp - lastScan >= 125) {
        lastScan = timestamp;
        const cropSide = Math.min(width, height);
        const sampleSide = Math.min(cropSide, 960);
        const cropX = (width - cropSide) / 2;
        const cropY = (height - cropSide) / 2;
        if (this._canvas.width !== sampleSide || this._canvas.height !== sampleSide) {
          this._canvas.width = this._canvas.height = sampleSide;
        }
        try {
          this._context.drawImage(this.video, cropX, cropY, cropSide, cropSide, 0, 0, sampleSide, sampleSide);
          const frame = this._context.getImageData(0, 0, sampleSide, sampleSide);
          const code = this._window.jsQR(frame.data, sampleSide, sampleSide, { inversionAttempts: 'attemptBoth' });
          if (code && typeof code.data === 'string' && code.data.length) {
            this._quad = code.location ? { location: code.location, cropX, cropY, cropSide, sampleSide, width, height } : null;
            this._drawQuad();
            const text = code.data;
            // Stop scheduling frames immediately: one decoded value per start.
            this._decodeTimer = this._window.setTimeout(() => {
              if (!this._isCurrent(token)) return;
              this._decodeTimer = null;
              this.stop();
              this._invoke(this.onDecode, text);
            }, 350);
            return;
          }
        } catch (error) {
          // Drawing before the first usable frame can fail transiently.
          if (error.name !== 'InvalidStateError') {
            this.stop();
            this._report(this._error('No se pudo leer la imagen de la cámara. Recarga la página y vuelve a intentarlo.'));
            return;
          }
        }
      }
      if (this._isCurrent(token)) this._raf = this._window.requestAnimationFrame(step);
    };
    this._raf = this._window.requestAnimationFrame(step);
  }

  _drawQuad() {
    if (!this._quad || !this._overlayContext) return;
    const bounds = this.overlay.getBoundingClientRect();
    const videoBounds = this.video.getBoundingClientRect();
    if (!bounds.width || !bounds.height || !videoBounds.width || !videoBounds.height) return;
    const ratio = Math.min(this._window.devicePixelRatio || 1, 2);
    this.overlay.width = Math.round(bounds.width * ratio);
    this.overlay.height = Math.round(bounds.height * ratio);
    const ctx = this._overlayContext;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, bounds.width, bounds.height);
    const { location, cropX, cropY, cropSide, sampleSide, width, height } = this._quad;
    const objectFit = this._window.getComputedStyle(this.video).objectFit;
    const scale = (objectFit === 'contain' ? Math.min : Math.max)(videoBounds.width / width, videoBounds.height / height);
    const offsetX = videoBounds.left - bounds.left + (videoBounds.width - width * scale) / 2;
    const offsetY = videoBounds.top - bounds.top + (videoBounds.height - height * scale) / 2;
    const points = [location.topLeftCorner, location.topRightCorner, location.bottomRightCorner, location.bottomLeftCorner];
    ctx.beginPath();
    points.forEach((point, index) => {
      const x = offsetX + (cropX + point.x * cropSide / sampleSide) * scale;
      const y = offsetY + (cropY + point.y * cropSide / sampleSide) * scale;
      if (index) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    });
    ctx.closePath();
    ctx.lineWidth = Math.max(2, bounds.width * 0.008);
    ctx.strokeStyle = '#16a34a';
    ctx.fillStyle = 'rgba(22, 163, 74, 0.18)';
    ctx.fill();
    ctx.stroke();
  }

  _clearOverlay() {
    const ctx = this._overlayContext;
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
  }

  _emitState() {
    this._invoke(this.onState, {
      running: this._running,
      cameras: this._cameras.map((camera) => ({ ...camera })),
      selectedCameraId: this._selectedCameraId,
      torchSupported: this._torchSupported,
      torchOn: this._torchOn,
    });
  }

  _error(message) {
    const error = new Error(message);
    error.name = 'QRScannerError';
    return error;
  }

  _permissionError(error) {
    return ['NotAllowedError', 'PermissionDeniedError', 'SecurityError'].includes(error.name);
  }

  _report(error) {
    let message = error.message;
    if (error.name !== 'QRScannerError') {
      if (this._permissionError(error)) message = 'El navegador bloqueó la cámara. Permite el acceso en los ajustes de este sitio y vuelve a pulsar Activar cámara. Si está dentro de otra aplicación, ábrela en el navegador.';
      else if (['NotFoundError', 'DevicesNotFoundError'].includes(error.name)) message = 'No se encontró una cámara. Conecta una cámara o abre la página desde un móvil.';
      else if (['NotReadableError', 'TrackStartError', 'AbortError'].includes(error.name)) message = 'No se pudo abrir la cámara. Cierra otras aplicaciones que la estén usando y vuelve a intentarlo.';
      else if (['OverconstrainedError', 'ConstraintNotSatisfiedError'].includes(error.name)) message = 'La cámara seleccionada no está disponible. Prueba con otra cámara.';
      else message = 'No se pudo activar la cámara. Revisa los permisos del sitio y vuelve a intentarlo.';
    }
    this._invoke(this.onError, this._error(message));
  }

  _invoke(callback, value) {
    if (typeof callback !== 'function') return;
    try { callback(value); } catch (error) { this._window.console?.error('QRScanner: error en una función de la interfaz.', error); }
  }
}
