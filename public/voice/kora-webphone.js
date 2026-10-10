/* Browser media client. Credentials stay in Kora; only a 30-second media ticket reaches this page. */
(() => {
  const root = document.getElementById('voice-phone');
  if (!root) return;
  const id = root.dataset.conversationId;
  const path = `/api/voice/${encodeURIComponent(id)}`;
  const $ = (suffix) => document.getElementById(`voice-${suffix}`);
  let socket = null;
  let stream = null;
  let context = null;
  let source = null;
  let processor = null;
  let silent = null;
  let playbackAt = 0;
  let captureRate = 16000;
  let previousSample = 0;
  let nextInputPosition = 0;
  let callId = null;
  let starting = false;

  const error = (message) => { $('error').textContent = String(message?.message ?? message ?? ''); };
  const clearError = () => { $('error').textContent = ''; };
  const api = async (action, body) => {
    const response = await fetch(`${path}/${action}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin', cache: 'no-store',
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
    return data;
  };
  const stopMedia = () => {
    if (socket) { const old = socket; socket = null; old.close(); }
    processor?.disconnect(); source?.disconnect(); silent?.disconnect();
    processor = null; source = null; silent = null;
    stream?.getTracks().forEach((track) => track.stop()); stream = null;
    void context?.close(); context = null; playbackAt = 0;
  };
  const refresh = async () => {
    try {
      const status = await api(callId ? `status?callId=${encodeURIComponent(callId)}` : 'status');
      $('connection').textContent = status.ready ? 'Linha pronta' : 'Linha indisponível';
      $('dial').disabled = !status.ready || !!status.call || starting;
      $('hangup').disabled = !status.call || !callId || status.call.id !== callId;
      if (status.call && status.call.id === callId) {
        $('call-state').textContent = `Ligação: ${status.call.state}`;
      } else if (callId && !status.call) {
        callId = null; $('call-state').textContent = 'Nenhuma ligação ativa.'; stopMedia();
      } else if (status.call) {
        $('call-state').textContent = 'Linha ocupada.';
      }
    } catch (e) { error(e); }
  };
  const resample = (input) => {
    const joined = new Float32Array(input.length + 1);
    joined[0] = previousSample; joined.set(input, 1);
    const step = context.sampleRate / captureRate;
    const output = [];
    while (nextInputPosition + 1 < joined.length) {
      const index = Math.floor(nextInputPosition);
      const fraction = nextInputPosition - index;
      output.push(joined[index] * (1 - fraction) + joined[index + 1] * fraction);
      nextInputPosition += step;
    }
    nextInputPosition -= input.length;
    previousSample = joined[joined.length - 1];
    return Float32Array.from(output);
  };
  const playRemote = (bytes) => {
    if (!context) return;
    const pcm = new Float32Array(bytes);
    if (!pcm.length) return;
    const buffer = context.createBuffer(1, pcm.length, 16000);
    buffer.copyToChannel(pcm, 0);
    const node = context.createBufferSource();
    node.buffer = buffer; node.connect(context.destination);
    if (playbackAt < context.currentTime + 0.04 || playbackAt > context.currentTime + 0.5) {
      playbackAt = context.currentTime + 0.06;
    }
    node.start(playbackAt); playbackAt += buffer.duration;
  };
  const onMedia = (event) => {
    if (event.data instanceof ArrayBuffer) { playRemote(event.data); return; }
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (message.type === 'capture-format') {
      if (message.format?.channels !== 1 || !Number.isInteger(message.format?.sampleRate)) {
        error('Formato de captura incompatível.'); return;
      }
      captureRate = message.format.sampleRate;
      previousSample = 0; nextInputPosition = 0;
    } else if (message.type === 'call' && message.call) {
      if (message.call.id !== callId) return;
      $('call-state').textContent = `Ligação: ${message.call.state}`;
      if (message.call.state === 'ended') { callId = null; stopMedia(); void refresh(); }
    } else if (message.type === 'status' && !message.ready) {
      error('A sessão de voz foi desconectada.'); stopMedia();
    }
  };
  const startMedia = async () => {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    context = new AudioContext();
    await context.resume();
    source = context.createMediaStreamSource(stream);
    processor = context.createScriptProcessor(1024, 1, 1);
    silent = context.createGain(); silent.gain.value = 0;
    source.connect(processor); processor.connect(silent); silent.connect(context.destination);
    processor.onaudioprocess = (event) => {
      if (socket?.readyState !== WebSocket.OPEN || socket.bufferedAmount > 128 * 1024) return;
      const pcm = resample(event.inputBuffer.getChannelData(0));
      if (pcm.length) socket.send(pcm.buffer);
    };
    const { ticket, mediaUrl } = await api('media-ticket', {});
    const ws = new WebSocket(mediaUrl, ['voice', ticket]);
    ws.binaryType = 'arraybuffer';
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error('Falha ao abrir o canal de áudio.')), { once: true });
    });
    socket = ws;
    ws.addEventListener('message', onMedia);
    ws.addEventListener('close', () => {
      if (socket === ws) { socket = null; stopMedia(); void refresh(); }
    });
  };
  $('dial').addEventListener('click', async () => {
    clearError(); starting = true; $('dial').disabled = true;
    try {
      await startMedia();
      const started = await api('dial', {});
      callId = started.id;
      await refresh();
    } catch (e) { error(e); stopMedia(); }
    finally { starting = false; }
  });
  $('hangup').addEventListener('click', async () => {
    clearError();
    try { await api('hangup', { callId }); await refresh(); }
    catch (e) { error(e); }
  });
  window.addEventListener('pagehide', stopMedia);
  const timer = setInterval(refresh, 2000);
  window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
  void refresh();
})();
