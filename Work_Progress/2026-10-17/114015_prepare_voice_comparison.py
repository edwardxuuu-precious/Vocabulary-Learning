"""Decode existing previews and cut at pauses; never synthesize or change pitch."""
import array
import hashlib
import json
import math
from pathlib import Path
import statistics
import subprocess
import sys
import tempfile
import wave

sys.path.insert(0, str(Path(tempfile.gettempdir()) / 'codex-voice-tools-20261017'))
import imageio_ffmpeg

root = Path('artifacts/voice-previews/2026-10-17-rounded-mandarin').resolve()
ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()

def read_pcm(path):
    with wave.open(str(path), 'rb') as audio:
        assert (audio.getnchannels(), audio.getsampwidth(), audio.getframerate()) == (1, 2, 24000)
        return array.array('h', audio.readframes(audio.getnframes()))

def rms(samples):
    return math.sqrt(sum(x * x for x in samples) / max(1, len(samples))) / 32768

def estimate_pitch(samples):
    values = [x / 32768 for x in samples[::3]]
    pitches = []
    for offset in range(0, len(values) - 320, 320):
        segment = values[offset:offset + 320]
        mean = statistics.mean(segment)
        segment = [x - mean for x in segment]
        if math.sqrt(sum(x * x for x in segment) / 320) < 0.018:
            continue
        correlations = []
        for lag in range(29, 146):
            left, right = segment[:-lag], segment[lag:]
            denominator = math.sqrt(sum(x*x for x in left) * sum(x*x for x in right))
            correlations.append(sum(a*b for a, b in zip(left, right)) / max(1e-12, denominator))
        peaks = [(i + 29, v) for i, v in enumerate(correlations[1:-1], start=1)
                 if v > correlations[i-1] and v >= correlations[i+1]]
        if not peaks:
            continue
        strongest = max(v for _, v in peaks)
        if strongest < 0.64:
            continue
        lag = next(lag for lag, v in peaks if v >= max(0.64, strongest * 0.94))
        pitches.append(8000 / lag)
    return {'medianHzApprox': round(statistics.median(pitches), 1) if pitches else None,
            'voicedWindows': len(pitches), 'note': 'Autocorrelation estimate; not a pronunciation or voice-quality score.'}

def choose_cut(samples):
    frames = [rms(samples[i:i+480]) for i in range(0, len(samples), 480)]
    threshold = max(0.0045, rms(samples) * 0.12)
    pauses = []
    start = None
    for i, value in enumerate(frames):
        if value < threshold:
            if start is None:
                start = i
        else:
            if start is not None and i - start >= 4:
                middle = (start + i) / 2 * 0.02
                if 9 <= middle <= 16:
                    pauses.append(middle)
            start = None
    if pauses:
        return round(min(pauses, key=lambda t: abs(t - 12.5)) * 24000)
    index = min(range(500, min(751, len(frames))), key=lambda i: frames[i])
    return index * 480

rows = []
for label in 'abc':
    original = root / f'voice-{label}-original.mp3'
    original_hash = hashlib.sha256(original.read_bytes()).hexdigest()
    decoded = root / f'voice-{label}-full.wav'
    subprocess.run([ffmpeg, '-v', 'error', '-nostdin', '-i', str(original), '-ac', '1', '-ar', '24000',
                    '-c:a', 'pcm_s16le', '-y', str(decoded)], check=True)
    samples = read_pcm(decoded)
    stop = choose_cut(samples)
    clipped = samples[:stop]
    output = root / f'voice-{label}-preview.wav'
    with wave.open(str(output), 'wb') as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(24000)
        audio.writeframes(clipped.tobytes())
    verified = read_pcm(output)
    assert verified == clipped, 'Cutting must preserve the original decoded samples.'
    assert max(abs(x) for x in verified) < 32767
    assert rms(verified) > 0.015
    assert hashlib.sha256(original.read_bytes()).hexdigest() == original_hash
    rows.append({'label': label.upper(), 'path': str(output), 'originalPath': str(original),
                 'originalSha256': original_hash, 'durationSeconds': round(len(verified)/24000, 3),
                 'fullDurationSeconds': round(len(samples)/24000, 3), 'rms': round(rms(verified), 4),
                 'peak': max(abs(x) for x in verified), 'processing': 'Decode and cut only; no pitch, speed or effects changes.',
                 'pitchEstimate': estimate_pitch(verified)})

old = Path('artifacts/voice-previews/2026-10-17-native-male/martin-li-cn-original.wav')
report = {'candidates': rows, 'previousMartinLiPitchEstimate': estimate_pitch(read_pcm(old))}
(root / 'comparison.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False, indent=2))
