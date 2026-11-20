"""Render the approved English voice offline. One request or a prepared batch."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import sys


RATE = 24000
FRAME = 240
SPEED = {'word': .89, 'sentence': .92}
ISOLATED = {
    'a': 'ˈeɪ', 'am': 'ˈæm', 'and': 'ˈænd', 'are': 'ˈɑɹ', 'at': 'ˈæt',
    'but': 'bˈʌt', 'for': 'fˈɔɹ', 'the': 'ðˈiː', 'to': 'tˈuː',
}
SENTENCE_FORMS = {
    'I am a child.': 'aɪ ˈæm ə tʃˈaɪld.',
    'I am at school.': 'aɪ æm ˈæt skˈuːl.',
    'I want to be a cook.': 'aɪ wˈɑnt tə bˈi ə kˈʊk!',
}
UPBEAT = {'All the children are here.', 'You are my friend.', 'The bear is brown.'}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--runtime', type=Path, required=True)
    parser.add_argument('--batch', type=Path)
    parser.add_argument('--out', type=Path)
    args = parser.parse_args()
    if bool(args.batch) != bool(args.out):
        parser.error('--batch and --out must be used together')
    runtime = args.runtime.resolve(strict=True)
    batch = args.batch.resolve(strict=True) if args.batch else None
    output = args.out.resolve() if args.out else None
    sys.path.insert(0, str(runtime / 'python'))
    import numpy as np
    import onnxruntime as ort
    import lameenc
    from piper.phonemize_espeak import EspeakPhonemizer

    os.chdir(runtime)
    phonemizer = EspeakPhonemizer(os.path.join('python', 'piper', 'espeak-ng-data'))
    vocabulary = json.loads(Path('vocab.json').read_text(encoding='utf-8'))['vocab']
    voice = np.load('nova.npy', allow_pickle=False)
    if voice.shape != (510, 1, 256):
        raise ValueError('Invalid Nova voice table')
    session_options = ort.SessionOptions()
    session_options.intra_op_num_threads = 3
    session_options.inter_op_num_threads = 1
    model = ort.InferenceSession(str(runtime / 'model.onnx'), sess_options=session_options, providers=['CPUExecutionProvider'])
    id_key = next(node.name for node in model.get_inputs() if node.name in {'input_ids', 'tokens'})

    def active(audio):
        padded = np.pad(audio, (0, (-len(audio)) % FRAME))
        rms = np.sqrt(np.mean(padded.reshape(-1, FRAME) ** 2, axis=1))
        speech = np.flatnonzero(rms > rms.max() * .075)
        if len(speech) < 9:
            raise ValueError('Incomplete Nova audio')
        return int(speech[0]), int(speech[-1])

    def render_clip(tokens, speed):
        inputs = {id_key: np.array([[0, *tokens, 0]], np.int64), 'style': voice[len(tokens)], 'speed': np.array([speed], np.float32)}
        signal = model.run(None, inputs)[0].reshape(-1).astype(np.float32)
        if not np.isfinite(signal).all() or np.max(np.abs(signal)) < .03:
            raise ValueError('Invalid Nova signal')
        signal = np.pad(signal, (RATE // 10, RATE // 10))
        frequency = np.fft.rfftfreq(len(signal), 1 / RATE)
        shelf = np.clip((frequency - 4750) / 3200, 0, 1)
        shaping = frequency**2 / (frequency**2 + 62**2) * 10 ** (-7.5 * shelf**2 * (3 - 2 * shelf) / 20)
        shaping *= np.clip((11500 - frequency) / 1600, 0, 1)
        audio = np.fft.irfft(np.fft.rfft(signal) * shaping, n=len(signal)).astype(np.float32)
        first, last = active(audio)
        clip = audio[max(0, (first - 8) * FRAME):min(len(audio), (last + 12) * FRAME)].copy()
        fade = np.sin(np.linspace(0, np.pi / 2, 208)) ** 2
        clip[:len(fade)] *= fade
        clip[-len(fade):] *= fade[::-1]
        first, last = active(clip)
        main = clip[first * FRAME:(last + 1) * FRAME]
        gain = min(1.7, .115 / np.sqrt(np.mean(main**2)), .67 / np.max(np.abs(clip)))
        return np.pad(clip * gain, (RATE // 22, RATE // 16))

    def utterance(row):
        text = row['text']
        if not isinstance(text, str) or not text or len(text) > 500 or text != text.strip():
            raise ValueError('Invalid Nova text')
        kind = row.get('kind') or ('sentence' if any(mark in text for mark in ',.!?') or len(text.split()) >= 4 else 'word')
        speed = SPEED[kind]
        spoken = text[:-1] + '!' if text in UPBEAT else text
        explicit = SENTENCE_FORMS.get(text) if kind == 'sentence' else ISOLATED.get(text.lower())
        clauses = [explicit] if explicit else [''.join(part) for part in phonemizer.phonemize('en-us', spoken)]
        clips = []
        for clause in clauses:
            tokens = [vocabulary[char] for char in clause if char in vocabulary]
            while tokens:
                limit = min(len(tokens), 450)
                if limit < len(tokens):
                    limit = max((n for n in range(350, limit) if tokens[n - 1] == vocabulary[' ']), default=limit)
                clips.append(render_clip(tokens[:limit], speed))
                tokens = tokens[limit:]
        if not clips:
            raise ValueError('No pronounceable English text')
        audio = np.concatenate(clips)
        encoder = lameenc.Encoder()
        encoder.set_in_sample_rate(RATE)
        encoder.set_channels(1)
        encoder.set_bit_rate(128)
        encoder.set_quality(2)
        return encoder.encode((audio * 32767).astype('<i2').tobytes()) + encoder.flush()

    if not batch:
        sys.stdout.buffer.write(utterance(json.loads(sys.stdin.buffer.read(8192))))
        return
    rows = json.loads(batch.read_text(encoding='utf-8'))['rows']
    if not 1 <= len(rows) <= 10_000:
        raise ValueError('Invalid Nova batch size')
    output.mkdir(parents=True, exist_ok=True)
    count = 0
    for row in rows:
        key = hashlib.sha256(row['text'].encode()).hexdigest()
        path = output / (key + '.mp3')
        if not path.is_file():
            sound = utterance(row)
            with path.open('xb') as file:
                file.write(sound)
            count += 1
    print(json.dumps({'generated': count, 'total': len(rows)}))


if __name__ == '__main__':
    main()
