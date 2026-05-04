import logging
try:
    import audioop
except ImportError:
    try:
        from audioop_lts import audioop
        import sys
        sys.modules['audioop'] = audioop
    except ImportError:
        pass # Allow calling code to handle missing audioop if needed

import os
import shutil
import site
import tempfile
import time
from typing import Dict, Any, List

def _safe_remove(path: str, retries: int = 5, delay: float = 0.5):
    """
    Safely delete a file with retries to handle WinError 32 (File in use).
    """
    if not os.path.exists(path):
        return
    for i in range(retries):
        try:
            os.remove(path)
            return
        except OSError:
            if i < retries - 1:
                time.sleep(delay)
            else:
                logger.warning(f"Could not delete temporary file: {path}")

logger = logging.getLogger(__name__)
_FFMPEG_EXE: str | None = None
_FFPROBE_EXE: str | None = None

# Dynamically inject ffmpeg/ffprobe into PATH for Whisper & PyDub
try:
    import static_ffmpeg
    static_ffmpeg.add_paths()
    logger.info("Successfully injected FFmpeg/FFprobe into PATH using static-ffmpeg.")
except ImportError:
    logger.warning("static-ffmpeg is not installed, Audio Anonymization may fail on non-WAV files.")
except Exception as e:
    logger.warning(f"Failed to inject FFmpeg from static-ffmpeg: {e}")


def _resolve_ffmpeg_binaries() -> tuple[str | None, str | None]:
    global _FFMPEG_EXE, _FFPROBE_EXE
    if _FFMPEG_EXE and _FFPROBE_EXE:
        return _FFMPEG_EXE, _FFPROBE_EXE

    try:
        from static_ffmpeg.run import get_or_fetch_platform_executables_else_raise

        ffmpeg_exe, ffprobe_exe = get_or_fetch_platform_executables_else_raise()
        _FFMPEG_EXE = ffmpeg_exe if os.path.exists(ffmpeg_exe) else None
        _FFPROBE_EXE = ffprobe_exe if os.path.exists(ffprobe_exe) else None
        logger.info("Resolved static ffmpeg binaries ffmpeg=%s ffprobe=%s", _FFMPEG_EXE, _FFPROBE_EXE)
    except Exception as e:
        logger.warning("Could not resolve bundled ffmpeg binaries: %s", e)

    if not (_FFMPEG_EXE and _FFPROBE_EXE):
        ffmpeg_from_path = shutil.which("ffmpeg")
        ffprobe_from_path = shutil.which("ffprobe")
        candidate_dirs = []

        appdata = os.getenv("APPDATA")
        if appdata:
            candidate_dirs.append(os.path.join(appdata, "Python", "Python313", "site-packages", "static_ffmpeg", "bin", "win32"))

        try:
            for user_site in site.getusersitepackages(), *site.getsitepackages():
                candidate_dirs.append(os.path.join(user_site, "static_ffmpeg", "bin", "win32"))
        except Exception:
            pass

        candidate_dirs.extend([
            r"C:\Program Files\ffmpeg\bin",
            r"C:\ffmpeg\bin",
        ])

        for candidate_dir in candidate_dirs:
            if not candidate_dir:
                continue
            ffmpeg_candidate = os.path.join(candidate_dir, "ffmpeg.exe")
            ffprobe_candidate = os.path.join(candidate_dir, "ffprobe.exe")
            if not ffmpeg_from_path and os.path.exists(ffmpeg_candidate):
                ffmpeg_from_path = ffmpeg_candidate
            if not ffprobe_from_path and os.path.exists(ffprobe_candidate):
                ffprobe_from_path = ffprobe_candidate
            if ffmpeg_from_path and ffprobe_from_path:
                break

        _FFMPEG_EXE = _FFMPEG_EXE or ffmpeg_from_path
        _FFPROBE_EXE = _FFPROBE_EXE or ffprobe_from_path
        logger.info("Fallback ffmpeg probe resolved ffmpeg=%s ffprobe=%s", _FFMPEG_EXE, _FFPROBE_EXE)

    return _FFMPEG_EXE, _FFPROBE_EXE


def _configure_pydub_binaries() -> None:
    try:
        from pydub import AudioSegment

        ffmpeg_exe, ffprobe_exe = _resolve_ffmpeg_binaries()
        if ffmpeg_exe:
            AudioSegment.converter = ffmpeg_exe
        if ffprobe_exe:
            AudioSegment.ffprobe = ffprobe_exe
    except Exception as e:
        logger.warning("Failed to configure pydub ffmpeg binaries: %s", e)

class AudioRedactorService:
    def __init__(self):
        self.model = None

    def _load_model(self):
        if self.model is None:
            from faster_whisper import WhisperModel
            logger.info("Loading Faster-Whisper 'small' model for Audio Anonymization...")
            # Use 'small' for better accuracy, int8 for speed on CPU
            self.model = WhisperModel("small", device="cpu", compute_type="int8")
            logger.info("Faster-Whisper model loaded successfully.")

    def detect_pii(self, audio_bytes: bytes, filename: str, presidio_service, policy: str = "Global") -> Dict[str, Any]:
        """
        Transcribes audio and maps PII character offsets to audio time intervals.
        """
        self._load_model()
        
        # Write to temp file for Whisper and Pydub
        ext = os.path.splitext(filename)[1]
        if not ext:
            ext = ".wav"
        
        # Audio preprocessing
        with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name

        try:
            # 1. Transcribe with Faster-Whisper (word-level timestamps enabled)
            segments, info = self.model.transcribe(tmp_path, word_timestamps=True, beam_size=5)
            segments = list(segments) # Force execution
            
            # Reconstruct transcript and track character-to-time mapping

            # Reconstruct transcript and track character-to-time mapping
            char_to_time = {}
            current_char_idx = 0
            formatted_text = ""

            words_info = []
            for segment in segments:
                if not segment.words:
                    continue
                for word in segment.words:
                    w = word.word
                    # Apply capitalization natively prior to time-mapping to prevent index drifting
                    if len(w.strip()) >= 3:
                        w = w.title() # Preserves exact whitespace prefix/suffixes natively from Whisper

                    start_time = word.start
                    end_time = word.end
                    
                    formatted_text += w
                    for _ in range(len(w)):
                        char_to_time[current_char_idx] = (start_time, end_time)
                        current_char_idx += 1
                        
            # 2. Run Comprehensive Detection with Deduplication
            from .utils import presidio_detect, regex_detect, contextual_name_detect, merge_results
            entities = merge_results(
                regex_detect(formatted_text, policy=policy),
                presidio_detect(formatted_text, policy=policy) + contextual_name_detect(formatted_text),
            )
            
            # 3. Map entities to Audio Timestamps
            audio_entities = []
            for ent in entities:
                ent_start_char = ent["start"]
                ent_end_char = ent["end"] - 1 # inclusive
                
                start_t = char_to_time.get(ent_start_char, (0, 0))[0]
                end_t = char_to_time.get(ent_end_char, (start_t, start_t))[1]
                
                audio_entities.append({
                    "entity_type": ent["entity"],
                    "value": ent["value"],
                    "score": ent.get("score", 0.85),
                    "start_time": start_t,
                    "end_time": end_t,
                    "start": ent["start"],
                    "end": ent["end"]
                })
            
            return {
                "transcript": formatted_text,
                "entities": audio_entities,
                "duration": segments[-1].end if segments else 0,
                "ai_summary": "Extracted conversational text matching {} PII entities.".format(len(audio_entities))
            }

        finally:
            _safe_remove(tmp_path)


    def redact_audio(self, audio_bytes: bytes, filename: str, config: Dict[str, str], detection_result: Dict[str, Any]) -> bytes:
        """
        Takes the original audio, applies specific masking techniques to the identified timestamps.
        config maps from `entity_type` -> technique (e.g. "PERSON_NAME": "bleep", "SSN": "silence")
        """
        from pydub import AudioSegment
        from pydub.generators import Sine
        _configure_pydub_binaries()

        ext = os.path.splitext(filename)[1]
        out_ext = ".wav" # Output standard format
        if not ext: ext = ".wav"

        with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name

        try:
            audio = AudioSegment.from_file(tmp_path)
            
            entities = detection_result.get("entities", [])
            
            # Sort entities by start time ascending, handle overlaps by merging
            # Because Pydub is immutable, it's easier to process them safely or create an overlay
            
            for ent in entities:
                tech = config.get(ent["entity_type"], "none")
                if tech == "none" or not tech:
                    continue
                
                t_start = int(ent["start_time"] * 1000)
                t_end = int(ent["end_time"] * 1000)
                duration_ms = t_end - t_start
                if duration_ms <= 0:
                    continue

                if tech == "suppress" or tech == "redact" or tech == "mute": # Silence
                    audio = audio[:t_start] + AudioSegment.silent(duration=duration_ms) + audio[t_end:]
                elif tech == "mask" or tech == "bleep" or tech == "beep": # Bleep tone (1000 Hz)
                    beep = Sine(1000).to_audio_segment(duration=duration_ms, volume=-30.0)
                    audio = audio[:t_start] + beep + audio[t_end:]

            out_path = tmp_path + "_out.wav"
            audio.export(out_path, format="wav")
            with open(out_path, "rb") as f:
                output_bytes = f.read()
            _safe_remove(out_path)
            return output_bytes

        finally:
            _safe_remove(tmp_path)
