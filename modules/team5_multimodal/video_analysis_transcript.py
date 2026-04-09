"""
video_analysis_transcript.py — Video audio transcription using OpenAI Whisper.
Extracts audio from a video file and generates a full transcript with timestamps.
"""

import os
import tempfile
import subprocess
import json


def extract_audio(video_path: str, audio_path: str = "") -> str:
    """
    Extract audio track from a video file using ffmpeg.
    Returns the path to the extracted .wav file.
    """
    if not os.path.exists(video_path):
        raise FileNotFoundError(f"Video file not found: {video_path}")

    if not audio_path:
        audio_path = os.path.join(tempfile.gettempdir(), "extracted_audio.wav")

    # Use imageio-ffmpeg's bundled ffmpeg for portability
    try:
        import imageio_ffmpeg
        ffmpeg_path = imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        ffmpeg_path = "ffmpeg"

    cmd = [
        ffmpeg_path,
        "-y",
        "-i", video_path,
        "-vn",                  # no video
        "-acodec", "pcm_s16le", # 16-bit PCM
        "-ar", "16000",         # 16kHz sample rate (Whisper default)
        "-ac", "1",             # mono
        audio_path
    ]

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if result.returncode != 0:
        print(f"ffmpeg audio extraction stderr: {result.stderr[:300]}")
        raise RuntimeError("Failed to extract audio from video")

    if os.path.getsize(audio_path) < 1000:
        raise RuntimeError("Extracted audio is too small — video may have no audio track.")

    print(f"✅ Audio extracted: {audio_path}")
    return audio_path

def generate_audio_plots(audio_path: str) -> dict:
    plots = {}
    try:
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
        import numpy as np
        from scipy.io import wavfile
        import base64
        import io

        samplerate, data = wavfile.read(audio_path)
        
        # If stereo, convert to mono
        if len(data.shape) == 2:
            data = data.mean(axis=1)

        def fig_to_base64(fig):
            buf = io.BytesIO()
            fig.savefig(buf, format='png', bbox_inches='tight', facecolor='#020617', transparent=True)
            buf.seek(0)
            b64 = base64.b64encode(buf.read()).decode('utf-8')
            plt.close(fig)
            return f"data:image/png;base64,{b64}"

        duration = len(data) / samplerate
        time = np.linspace(0., duration, len(data))

        # 1. Waveform
        fig, ax = plt.subplots(figsize=(8, 2))
        skip = max(1, len(data) // 50000)
        ax.plot(time[::skip], data[::skip], color='#38bdf8', linewidth=0.5)
        ax.set_title('Audio Waveform', color='#f1f5f9', fontsize=10)
        ax.tick_params(colors='#94a3b8')
        for spine in ax.spines.values(): spine.set_color('#1e293b')
        plots['waveform'] = fig_to_base64(fig)

        # 2. Spectrogram
        fig, ax = plt.subplots(figsize=(8, 2))
        ax.specgram(data, NFFT=1024, Fs=samplerate, noverlap=512, cmap='viridis')
        ax.set_title('Spectrogram', color='#f1f5f9', fontsize=10)
        ax.tick_params(colors='#94a3b8')
        for spine in ax.spines.values(): spine.set_color('#1e293b')
        plots['spectrogram'] = fig_to_base64(fig)

        # 3. Energy Graph
        fig, ax = plt.subplots(figsize=(8, 2))
        win_size = int(samplerate * 0.05)
        data_float = data.astype(np.float32)
        energy = np.convolve(data_float**2, np.ones(win_size)/win_size, mode='same')
        skip_e = max(1, len(energy) // 10000)
        ax.plot(time[::skip_e], energy[::skip_e], color='#4ade80', linewidth=1)
        ax.set_title('Energy Graph', color='#f1f5f9', fontsize=10)
        ax.tick_params(colors='#94a3b8')
        for spine in ax.spines.values(): spine.set_color('#1e293b')
        plots['energy'] = fig_to_base64(fig)

        return plots
    except Exception as e:
        print(f"Failed to generate audio plots: {e}")
        return plots
def transcribe_video(video_path: str, model_size: str = "base") -> dict:
    """
    Transcribe a video's audio using OpenAI Whisper.

    Args:
        video_path: Path to the video file
        model_size: Whisper model size ('tiny', 'base', 'small', 'medium', 'large')

    Returns:
        dict with keys:
            - full_text: The complete transcript as a single string
            - segments: List of {start, end, text} dicts with timestamps
            - language: Detected language
    """
    print(f"🎤 Starting transcription for: {video_path}")

    # Step 1: Extract audio
    audio_path = ""
    try:
        audio_path = extract_audio(video_path)
    except RuntimeError as e:
        print(f"⚠ Audio extraction failed: {e}")
        return {
            "full_text": "No audio track found in this video.",
            "segments": [],
            "language": "unknown"
        }

    # Step 2: Load Whisper model and transcribe
    try:
        import whisper
        print(f"Loading Whisper model ({model_size})...")
        model = whisper.load_model(model_size)

        print("Transcribing audio...")
        result = model.transcribe(audio_path, verbose=False)

        # Build clean segments and WebVTT subtitles
        segments = []
        
        def format_vtt_time(seconds: float):
            import math
            hrs = math.floor(seconds / 3600)
            mins = math.floor((seconds % 3600) / 60)
            strs = seconds % 60
            secs = math.floor(strs)
            msecs = math.floor((strs - secs) * 1000)
            return f"{hrs:02d}:{mins:02d}:{secs:02d}.{msecs:03d}"

        vtt_content = "WEBVTT\n\n"
        
        for i, seg in enumerate(result.get("segments", [])):
            start_str = format_vtt_time(seg["start"])
            end_str = format_vtt_time(seg["end"])
            text = seg["text"].strip()
            
            segments.append({
                "start": round(seg["start"], 1),
                "end": round(seg["end"], 1),
                "text": text
            })
            vtt_content += f"{i+1}\n{start_str} --> {end_str}\n{text}\n\n"

        transcript = {
            "full_text": result.get("text", "").strip(),
            "segments": segments,
            "vtt_content": vtt_content,
            "language": result.get("language", "unknown"),
            "speakers": [],
            "entities": [],
            "topics": [],
            "audio_plots": generate_audio_plots(audio_path)
        }

        # Pyannote Speaker Diarization section removed as per user request using Azure OpenAI alternative planned instead.

        # --- Sub-step: SpaCy NER ---
        try:
            import spacy
            print("Loading SpaCy NER model...")
            # Suppress specific spacy warnings if needed
            nlp = spacy.load("en_core_web_sm")
            doc = nlp(transcript["full_text"])
            
            # Group unique entities by label
            ent_map = {}
            for ent in doc.ents:
                if ent.label_ not in ent_map:
                    ent_map[ent.label_] = set()
                ent_map[ent.label_].add(ent.text)
                
            for label, texts in ent_map.items():
                transcript["entities"].append({
                    "label": label,
                    "items": list(texts)
                })
            print("✅ SpaCy NER complete.")
        except Exception as e:
            print(f"⚠ SpaCy skipped: {e}")

        # --- Sub-step: BERTopic on segments ---
        try:
            # Only run topic modeling if we have enough chunks
            if len(segments) >= 3:
                from bertopic import BERTopic
                print("Loading BERTopic...")
                topic_model = BERTopic(language="english", min_topic_size=2)
                texts = [s["text"] for s in segments]
                topics_found, _ = topic_model.fit_transform(texts)
                
                topic_info = topic_model.get_topic_info()
                for idx, row in topic_info.iterrows():
                    if row["Topic"] != -1:  # ignore outlier topic
                        # The "Name" usually looks like "0_word1_word2_word3"
                        clean_name = "_".join(row["Name"].split("_")[1:4])
                        transcript["topics"].append({
                            "id": int(row["Topic"]),
                            "name": clean_name,
                            "count": int(row["Count"])
                        })
                print("✅ BERTopic complete.")
        except Exception as e:
            print(f"⚠ BERTopic skipped: {e}")

        print(f"✅ Transcription complete! Language: {transcript['language']}")
        print(f"   Full text: {transcript['full_text'][:200]}...")
        return transcript

    except ImportError:
        print("⚠ Whisper not installed. Install with: pip install openai-whisper")
        return {
            "full_text": "Whisper not installed. Run: pip install openai-whisper",
            "segments": [],
            "language": "unknown"
        }
    except Exception as e:
        print(f"⚠ Transcription failed: {e}")
        return {
            "full_text": f"Transcription failed: {str(e)}",
            "segments": [],
            "language": "unknown"
        }
    finally:
        # Cleanup temp audio file
        if audio_path and os.path.exists(audio_path):
            try:
                os.remove(audio_path)
            except:
                pass


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Transcribe a video's audio using Whisper.")
    parser.add_argument("video", help="Path to the video file")
    parser.add_argument("-m", "--model", default="base", choices=["tiny", "base", "small", "medium", "large"],
                        help="Whisper model size (default: base)")
    parser.add_argument("-o", "--output", default="", help="Output JSON path (optional)")

    args = parser.parse_args()

    transcript = transcribe_video(args.video, args.model)

    # Print results
    print("\n" + "=" * 50)
    print(f"Language: {transcript['language']}")
    print(f"Full transcript:\n{transcript['full_text']}")
    print("=" * 50)

    if transcript["segments"]:
        print("\nTimestamped segments:")
        for seg in transcript["segments"]:
            print(f"  [{seg['start']}s - {seg['end']}s] {seg['text']}")

    # Save to JSON if requested
    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(transcript, f, indent=2, ensure_ascii=False)
        print(f"\nSaved to: {args.output}")
