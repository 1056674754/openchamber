import { afterEach, describe, expect, test } from 'bun:test';

import {
  joinSegmentTranscripts,
  RECORDING_SEGMENT_MAX_MS,
  RECORDING_SEGMENT_MIN_MS,
  shouldSplitRecordingSegment,
  AudioStreamService,
} from './audioStreamService';

const originalWindow = globalThis.window;
const originalNavigator = globalThis.navigator;
const originalMediaRecorder = globalThis.MediaRecorder;
const originalFetch = globalThis.fetch;
const originalDateNow = Date.now;

afterEach(() => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: originalNavigator });
  Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, value: originalMediaRecorder });
  globalThis.fetch = originalFetch;
  Date.now = originalDateNow;
});

describe('post-recording dictation segmentation', () => {
  test('does not split short pauses or short recordings', () => {
    expect(shouldSplitRecordingSegment(RECORDING_SEGMENT_MIN_MS - 1, true)).toBe(false);
    expect(shouldSplitRecordingSegment(RECORDING_SEGMENT_MIN_MS, false)).toBe(false);
  });

  test('splits at a natural pause after the minimum and hard-caps long speech', () => {
    expect(shouldSplitRecordingSegment(RECORDING_SEGMENT_MIN_MS, true)).toBe(true);
    expect(shouldSplitRecordingSegment(RECORDING_SEGMENT_MAX_MS, false)).toBe(true);
  });

  test('returns every queued segment as one final transcript', () => {
    expect(joinSegmentTranscripts([' first sentence ', '', 'second sentence'])).toBe('first sentence second sentence');
  });

  test('does not transcribe until finish and emits one combined final result', async () => {
    let now = 1_000;
    Date.now = () => now;
    class FakeMediaRecorder {
      static isTypeSupported() { return true; }
      state: RecordingState = 'inactive';
      ondataavailable: ((event: BlobEvent) => void) | null = null;
      onstop: (() => void) | null = null;
      constructor(_stream: MediaStream, public readonly options: MediaRecorderOptions) {}
      start() { this.state = 'recording'; }
      stop() {
        this.state = 'inactive';
        this.ondataavailable?.({ data: new Blob(['audio'], { type: 'audio/webm' }) } as BlobEvent);
        this.onstop?.();
      }
    }
    const analyser = { fftSize: 512, getFloatTimeDomainData: (buffer: Float32Array) => buffer.fill(0) };
    class FakeAudioContext {
      createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
      createAnalyser() { return analyser; }
      close() { return Promise.resolve(); }
    }
    const stream = { getTracks: () => [{ stop() {} }] } as unknown as MediaStream;
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { MediaRecorder: FakeMediaRecorder, AudioContext: FakeAudioContext } });
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async () => stream } } });
    Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, value: FakeMediaRecorder });
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      return Response.json({ transcript: 'complete transcript' });
    };
    const results: Array<[string, boolean]> = [];
    const result = (text: string, final: boolean) => { results.push([text, final]); };
    const service = new AudioStreamService();
    service.configure({ baseURL: 'https://stt.test/v1', model: 'whisper' });

    await service.startListening('en', result);
    expect(fetchCalls).toBe(0);
    now += 500;
    await service.finishListening();

    expect(fetchCalls).toBe(1);
    expect(results).toEqual([['complete transcript', true]]);
  });
});
