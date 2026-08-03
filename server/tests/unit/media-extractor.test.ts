import { describe, it, expect } from 'vitest';
import { StubMediaExtractor, audioArgs, framesArgs } from '../../src/fetch/media-extractor.js';

describe('audioArgs', () => {
  it('builds mono 16 kHz WAV-to-stdout ffmpeg args for the given URL', () => {
    expect(audioArgs('https://cdn/x.mp4')).toEqual([
      '-i', 'https://cdn/x.mp4', '-vn', '-ac', '1', '-ar', '16000', '-f', 'wav', 'pipe:1',
    ]);
  });
});

describe('framesArgs', () => {
  it('caps the frame count with -frames:v and writes numbered jpegs to outDir', () => {
    const args = framesArgs('https://cdn/x.mp4', '/tmp/frames', 8);
    expect(args).toContain('-frames:v');
    expect(args[args.indexOf('-frames:v') + 1]).toBe('8');
    expect(args.at(-1)).toBe('/tmp/frames/frame-%03d.jpg');
  });
});

describe('StubMediaExtractor', () => {
  it('returns fixed audio bytes and max zero-padded frame paths, no ffmpeg', async () => {
    const stub = new StubMediaExtractor();
    expect(await stub.audio('x')).toBe(StubMediaExtractor.AUDIO);

    const { paths } = await stub.frames('x', '/tmp/f', 3);
    expect(paths).toEqual(['/tmp/f/frame-001.jpg', '/tmp/f/frame-002.jpg', '/tmp/f/frame-003.jpg']);
  });
});
