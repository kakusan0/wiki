// 動画にする：WebCodecs で実時間より速く書き出す（MP4 か WebM）。使えなければ MediaRecorder で実時間に録る
import { ArrayBufferTarget as Mp4Target, Muxer as Mp4Muxer } from 'mp4-muxer';
import { ArrayBufferTarget as WebmTarget, Muxer as WebmMuxer } from 'webm-muxer';

export interface Encoded { blob: Blob; ext: 'mp4' | 'webm'; mime: string }
export interface EncodeJob {
  width: number; height: number; fps: number; frames: number;
  draw: (i: number, ctx: CanvasRenderingContext2D) => void;
  onProgress: (done: number) => void;
  signal: AbortSignal;
}

const aborted = () => new DOMException('中止しました', 'AbortError');

async function pickCodec(w: number, h: number, fps: number): Promise<{ codec: string; kind: 'mp4' | 'webm'; muxCodec: string } | null> {
  if (typeof VideoEncoder === 'undefined') return null;
  const tries: { codec: string; kind: 'mp4' | 'webm'; muxCodec: string }[] = [
    { codec: 'avc1.640028', kind: 'mp4', muxCodec: 'avc' },
    { codec: 'avc1.4d0028', kind: 'mp4', muxCodec: 'avc' },
    { codec: 'vp09.00.40.08', kind: 'webm', muxCodec: 'V_VP9' },
    { codec: 'vp8', kind: 'webm', muxCodec: 'V_VP8' },
  ];
  for (const t of tries) {
    try {
      const r = await VideoEncoder.isConfigSupported({ codec: t.codec, width: w, height: h, bitrate: 6_000_000, framerate: fps });
      if (r.supported) return t;
    } catch { /* 次を試す */ }
  }
  return null;
}

export async function encodeVideo(job: EncodeJob): Promise<Encoded> {
  const { width: w, height: h, fps } = job;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const pick = await pickCodec(w, h, fps);
  if (!pick) return recordRealtime(job, canvas, ctx);

  const mp4 = pick.kind === 'mp4';
  const target = mp4 ? new Mp4Target() : new WebmTarget();
  const muxer = mp4
    ? new Mp4Muxer({ target: target as Mp4Target, video: { codec: 'avc', width: w, height: h }, fastStart: 'in-memory' })
    : new WebmMuxer({ target: target as WebmTarget, video: { codec: pick.muxCodec, width: w, height: h, frameRate: fps } });
  let failure: unknown = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => (muxer as Mp4Muxer<Mp4Target>).addVideoChunk(chunk, meta),
    error: (e) => { failure = e; },
  });
  encoder.configure({ codec: pick.codec, width: w, height: h, bitrate: Math.round(w * h * fps * 0.1), framerate: fps, ...(mp4 ? { avc: { format: 'avc' } } : {}) } as VideoEncoderConfig);
  const us = 1_000_000 / fps;
  for (let i = 0; i < job.frames; i++) {
    if (job.signal.aborted) { encoder.close(); throw aborted(); }
    if (failure) throw failure;
    job.draw(i, ctx);
    const frame = new VideoFrame(canvas, { timestamp: Math.round(i * us), duration: Math.round(us) });
    encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
    frame.close();
    // 書き出しが追いつくまで少し待つ（メモリを使いすぎない）
    while (encoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 4));
    if (i % 10 === 0) { job.onProgress(i / job.frames); await new Promise((r) => setTimeout(r, 0)); }
  }
  await encoder.flush();
  encoder.close();
  if (failure) throw failure;
  muxer.finalize();
  const buf = (target as Mp4Target).buffer;
  job.onProgress(1);
  const mime = mp4 ? 'video/mp4' : 'video/webm';
  return { blob: new Blob([buf], { type: mime }), ext: mp4 ? 'mp4' : 'webm', mime };
}

// 古いブラウザ：画面に描きながら実時間で録る
async function recordRealtime(job: EncodeJob, canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): Promise<Encoded> {
  if (typeof MediaRecorder === 'undefined' || !canvas.captureStream) throw new Error('このブラウザでは動画を作れません');
  const types = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  const mime = types.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
  job.draw(0, ctx);
  const stream = canvas.captureStream(job.fps);
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 6_000_000 } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise<void>((r) => { rec.onstop = () => r(); });
  rec.start(1000);
  const t0 = performance.now();
  for (let i = 0; i < job.frames; i++) {
    if (job.signal.aborted) { rec.stop(); throw aborted(); }
    const due = t0 + (i * 1000) / job.fps;
    const wait = due - performance.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    job.draw(i, ctx);
    if (i % 10 === 0) job.onProgress(i / job.frames);
  }
  await new Promise((r) => setTimeout(r, 1000 / job.fps));
  rec.stop();
  await done;
  job.onProgress(1);
  const type = rec.mimeType || mime || 'video/webm';
  return { blob: new Blob(chunks, { type }), ext: type.includes('mp4') ? 'mp4' : 'webm', mime: type };
}
