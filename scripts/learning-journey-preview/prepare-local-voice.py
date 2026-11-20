"""Prepare local Lessac audio from the explicitly scoped English preview text."""

import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import wave


def encode_mp3(pcm, samplerate, lameenc):
    encoder = lameenc.Encoder()
    encoder.set_bit_rate(96)
    encoder.set_in_sample_rate(samplerate)
    encoder.set_channels(1)
    encoder.set_quality(2)
    return encoder.encode(pcm) + encoder.flush()


def render_bundle(out, texts, voice, speech, isolated_forms, speed, lameenc):
    clips = []
    report = []
    samples = {}
    for text in texts:
        spoken = '[[' + isolated_forms[text] + ']]' if text in isolated_forms else text
        wav_bytes = io.BytesIO()
        with wave.open(wav_bytes, 'wb') as file:
            voice.synthesize_wav(spoken, file, syn_config=speech)
        wav_bytes.seek(0)
        with wave.open(wav_bytes, 'rb') as file:
            assert file.getnchannels() == 1 and file.getsampwidth() == 2
            rate = file.getframerate()
            frames = file.readframes(file.getnframes())
        assert frames and rate == 22050
        padded = bytes(2 * round(rate * 0.055)) + frames + bytes(2 * round(rate * 0.09))
        audio = encode_mp3(padded, rate, lameenc)
        file = hashlib.sha256(text.encode()).hexdigest()[:20] + '.mp3'
        (out / file).write_bytes(audio)
        clips.append({'text': text, 'file': file, 'sha256': hashlib.sha256(audio).hexdigest()})
        report.append({'text': text, 'phones': voice.phonemize(spoken), 'duration': round(len(padded) / (2 * rate), 3)})
        samples[text] = padded
    manifest = {'version': 1, 'variant': out.name, 'voice': 'Lessac', 'speed': speed, 'clips': clips}
    (out / 'manifest.json').write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding='utf-8')
    (out / 'reading-report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')
    demo = [samples[text] for text in ['am', 'are', 'ate', 'I am a child.'] if text in samples]
    if demo:
        pause = bytes(2 * round(rate * 0.36))
        (out / 'sample.mp3').write_bytes(encode_mp3(pause.join(demo), rate, lameenc))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', type=Path, required=True, help='en_US-lessac-medium.onnx with its adjacent JSON configuration')
    for key in ('scope', 'packages', 'out'):
        parser.add_argument('--' + key, type=Path, required=True)
    parser.add_argument('--speed', type=float, default=0.62)
    args = parser.parse_args()
    assert 0.55 <= args.speed <= 1

    scope = json.loads(args.scope.read_text(encoding='utf-8'))
    texts = list(dict.fromkeys([*scope['terms'], *scope['sentences']]))
    assert 1 <= len(texts) <= 80 and all(1 <= len(text) <= 180 and text.strip() == text for text in texts)
    model_digest = hashlib.sha256(args.model.read_bytes()).hexdigest()
    isolated_forms = {'am': 'ˈæm', 'are': 'ˈɑːɹ', 'at': 'ˈæt', 'but': 'bˈʌt'}
    variant_hash = hashlib.sha256(json.dumps([model_digest, args.speed, isolated_forms, texts]).encode()).hexdigest()[:12]
    variant = 'lessac-' + variant_hash
    output_root = args.out.resolve()
    out = output_root / variant
    if not out.exists():
        sys.path.insert(0, str(args.packages.resolve()))
        from piper import PiperVoice, SynthesisConfig
        import lameenc

        espeak = os.path.relpath(args.packages / 'piper' / 'espeak-ng-data')
        voice = PiperVoice.load(args.model, espeak_data_dir=espeak)
        speech = SynthesisConfig(length_scale=1 / args.speed, volume=0.86)
        output_root.mkdir(parents=True, exist_ok=True)
        with TemporaryDirectory(dir=output_root, prefix='.render-') as temp:
            staged = Path(temp) / variant
            staged.mkdir()
            render_bundle(staged, texts, voice, speech, isolated_forms, args.speed, lameenc)
            staged.rename(out)

    manifest = json.loads((out / 'manifest.json').read_text(encoding='utf-8'))
    assert manifest['variant'] == variant and [clip['text'] for clip in manifest['clips']] == texts
    print(json.dumps({'bundle': str(out), 'clips': len(texts), 'voice': 'Lessac', 'speed': args.speed, 'modelSha256': model_digest}))


if __name__ == '__main__':
    main()
