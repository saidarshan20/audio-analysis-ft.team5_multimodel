"""
Video_analysis.py — Full multimodal video analysis pipeline.
Uses YOLOv8 for object detection, BLIP for captioning, CLIP for embeddings.
Produces a browser-compatible H.264 MP4 and returns rich analysis metadata.

LLM Priority: Azure OpenAI → Groq  (mirrors config.get_llm_client logic)
"""

import cv2
import os
import json
import argparse
import tempfile
import subprocess
import numpy as np
import base64
import io
from collections import Counter
from ultralytics import YOLO
from PIL import Image

from modules.team5_multimodal.config import get_settings


# ── Helpers: synchronous LLM clients (this file runs in asyncio.to_thread) ──

def _get_sync_llm_client():
    """
    Returns (client, model_name) for the best available *synchronous* LLM.
    Priority: Azure OpenAI → Groq
    """
    from openai import OpenAI, AzureOpenAI
    s = get_settings()

    if s.azure_openai_key and s.azure_openai_endpoint and s.azure_openai_deployment_name:
        return AzureOpenAI(
            azure_endpoint=s.azure_openai_endpoint,
            api_key=s.azure_openai_key,
            api_version=s.azure_openai_api_version,
        ), s.azure_openai_deployment_name

    # Groq fallback
    if s.groq_api_key:
        return OpenAI(
            base_url="https://api.groq.com/openai/v1",
            api_key=s.groq_api_key,
        ), s.groq_model

    raise RuntimeError("No LLM API key configured (set AZURE_OPENAI_KEY or GROQ_API_KEY in .env)")


def _get_sync_vision_client():
    """
    Returns (client, model_name) for vision-capable LLM (image understanding).
    Priority: Azure OpenAI → Groq Vision
    """
    from openai import OpenAI, AzureOpenAI
    s = get_settings()

    if s.azure_openai_key and s.azure_openai_endpoint and s.azure_openai_deployment_name:
        return AzureOpenAI(
            azure_endpoint=s.azure_openai_endpoint,
            api_key=s.azure_openai_key,
            api_version=s.azure_openai_api_version,
        ), s.azure_openai_deployment_name

    if s.groq_api_key and s.groq_vision_model:
        return OpenAI(
            base_url="https://api.groq.com/openai/v1",
            api_key=s.groq_api_key,
        ), s.groq_vision_model

    return None, None


def analyze_video(input_path: str, output_path: str = "", model_path: str = "yolov8n.pt", show: bool = False):
    """
    Perform full multimodal analysis on a video file.
    Returns a dict with detected_objects, frame_captions, and groq_summary.
    """
    if not os.path.exists(input_path):
        print(f"Error: Input video '{input_path}' not found.")
        return None

    # Load the YOLO model
    print(f"Loading YOLO model from {model_path}...")
    model = YOLO(model_path)

    # Open the video file
    cap = cv2.VideoCapture(input_path)
    if not cap.isOpened():
        print(f"Error: Could not open video file '{input_path}'.")
        return None

    # Get video properties
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = int(cap.get(cv2.CAP_PROP_FPS))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    if fps <= 0:
        fps = 25

    if not output_path:
        base, ext = os.path.splitext(input_path)
        output_path = f"{base}_analyzed.mp4"

    duration_sec = total_frames // fps if fps > 0 else 0
    print(f"Processing video: {width}x{height} at {fps} FPS, ~{duration_sec}s duration")
    print(f"Will analyze {duration_sec} keyframes (1 per second)")

    # --- Step 1: Extract keyframes, run YOLO, write annotated frames ---
    # Use a temp directory for raw annotated frames
    temp_dir = tempfile.mkdtemp(prefix="video_analysis_")
    
    detected_objects = Counter()
    frame_detections = []  # per-keyframe detection info
    keyframe_images = []   # PIL images for BLIP/CLIP
    object_details = {}    # { "car": [{second: 1, confidence: 0.9, image: "base64..."}, ...] }
    frame_count = 0
    saved_frames = 0

    while cap.isOpened():
        success, frame = cap.read()
        if not success:
            break

        frame_count += 1

        # Only process 1 frame per second
        if frame_count % fps != 0:
            continue

        second = frame_count // fps

        # Run YOLO inference
        results = model(frame, verbose=False)

        # Collect detections
        frame_dets = []
        if len(results) > 0 and results[0].boxes:
            for box in results[0].boxes:
                class_name = model.names[int(box.cls[0])]
                conf = float(box.conf[0])
                detected_objects[class_name] += 1
                frame_dets.append({"label": class_name, "confidence": round(conf, 3)})

                # Extract cropped image containing the object
                x1, y1, x2, y2 = map(int, box.xyxy[0])
                # Ensure coordinates are within frame bounds
                h, w = frame.shape[:2]
                x1, y1 = max(0, x1), max(0, y1)
                x2, y2 = min(w, x2), min(h, y2)
                
                # Only save crops if valid area
                if x2 > x1 and y2 > y1:
                    if class_name not in object_details:
                        object_details[class_name] = []
                    
                    # Cap crops to top 15 instances per class to save memory
                    crop_b64 = None
                    if len(object_details[class_name]) < 15:
                        crop = frame[y1:y2, x1:x2]
                        # Resize large crops to save payload size
                        if crop.shape[0] > 300 or crop.shape[1] > 300:
                            scale = 300 / max(crop.shape[0], crop.shape[1])
                            crop = cv2.resize(crop, (0,0), fx=scale, fy=scale)
                        
                        _, buffer = cv2.imencode('.jpg', crop, [cv2.IMWRITE_JPEG_QUALITY, 70])
                        crop_b64 = f"data:image/jpeg;base64,{base64.b64encode(buffer.tobytes()).decode('utf-8')}"
                    
                    object_details[class_name].append({
                        "second": second,
                        "confidence": round(conf, 3),
                        "image": crop_b64,
                        "box_2d": [
                            round((x1 / w) * 100, 2),  # left %
                            round((y1 / h) * 100, 2),  # top %
                            round(((x2 - x1) / w) * 100, 2), # width %
                            round(((y2 - y1) / h) * 100, 2)  # height %
                        ]
                    })

        frame_detections.append({"second": second, "detections": frame_dets})

        # Save PIL image for BLIP/CLIP later
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        keyframe_images.append(Image.fromarray(rgb_frame))

        # Plot YOLO annotations on the frame
        annotated_frame = results[0].plot()

        # Save annotated frame as image file for ffmpeg
        frame_path = os.path.join(temp_dir, f"frame_{saved_frames:06d}.png")
        cv2.imwrite(frame_path, annotated_frame)
        saved_frames += 1

        print(f"  Keyframe {saved_frames} (t={second}s): {len(frame_dets)} objects detected")

    cap.release()
    print(f"YOLO pass complete. {saved_frames} keyframes analyzed.")

    # --- Step 2: Encode annotated frames into browser-compatible MP4 via ffmpeg ---
    print("Encoding analyzed video with ffmpeg (H.264)...")
    
    # Find ffmpeg from imageio
    try:
        import imageio_ffmpeg
        ffmpeg_path = imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        ffmpeg_path = "ffmpeg"  # hope it's on PATH

    ffmpeg_cmd = [
        ffmpeg_path,
        "-y",                           # overwrite
        "-framerate", "1",              # input is 1 fps (one keyframe per second)
        "-i", os.path.join(temp_dir, "frame_%06d.png"),
        "-i", input_path,               # original video for audio
        "-c:v", "libx264",             # H.264 codec
        "-preset", "fast",
        "-pix_fmt", "yuv420p",          # browser compatibility
        "-c:a", "aac",                  # encode audio to AAC
        "-map", "0:v:0",                # map video from frames
        "-map", "1:a:0?",               # map audio from original video (optional)
        "-shortest",                    # stop encoding when shortest stream ends
        "-movflags", "+faststart",      # stream-friendly
        "-r", "1",                      # output 1 fps
        output_path
    ]
    
    try:
        result = subprocess.run(ffmpeg_cmd, capture_output=True, text=True, timeout=120)
        if result.returncode != 0:
            print(f"ffmpeg stderr: {result.stderr}")
            print("Warning: ffmpeg encoding may have failed, falling back to raw frames.")
        else:
            print(f"✅ Video encoded successfully: {output_path}")
    except FileNotFoundError:
        print("ffmpeg not found. Trying imageio fallback...")
        _imageio_fallback(temp_dir, output_path, saved_frames)
    except subprocess.TimeoutExpired:
        print("ffmpeg timed out. Trying imageio fallback...")
        _imageio_fallback(temp_dir, output_path, saved_frames)

    # Cleanup temp frames
    import shutil
    shutil.rmtree(temp_dir, ignore_errors=True)

    # --- Step 3: Image Description (Azure Vision → Groq Vision → BLIP fallback) ---
    video_caption_raw = "None"
    settings = get_settings()

    # Sample 3 keyframes for deep AI analysis
    n_frames = len(keyframe_images)
    indices = [0, n_frames // 2, max(0, n_frames - 1)] if n_frames >= 3 else list(range(n_frames))

    ai_captions = []

    # 3a. Try Azure OpenAI Vision / Groq Vision for primary captions
    vision_client, vision_model = _get_sync_vision_client()
    if vision_client and vision_model:
        provider = "Azure OpenAI" if settings.azure_openai_key else "Groq Vision"
        print(f"Using {provider} ({vision_model}) for primary captions...")
        try:
            for idx in indices:
                img = keyframe_images[idx]
                buffered = io.BytesIO()
                img.save(buffered, format="JPEG")
                img_str = base64.b64encode(buffered.getvalue()).decode("utf-8")

                response = vision_client.chat.completions.create(
                    model=vision_model,
                    messages=[{
                        "role": "user",
                        "content": [
                            {"type": "text", "text": "Describe this video frame concisely, focusing on the main action and environment."},
                            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{img_str}"}}
                        ]
                    }],
                    max_tokens=150
                )
                cap_text = response.choices[0].message.content
                ai_captions.append(cap_text)
                print(f"  {provider} Frame {idx}: {cap_text[:60]}...")

            video_caption_raw = " | ".join(ai_captions)
        except Exception as e:
            print(f"{provider} Vision failed: {e}")

    # 3b. BLIP Fallback (if no AI captions were generated)
    if video_caption_raw == "None":
        try:
            from transformers import BlipProcessor, BlipForConditionalGeneration
            print("Loading local BLIP fallback...")
            blip_processor = BlipProcessor.from_pretrained(settings.caption_model)
            blip_model = BlipForConditionalGeneration.from_pretrained(settings.caption_model)

            per_frame_captions = []
            for img in keyframe_images:
                inputs = blip_processor(img, return_tensors="pt")
                out = blip_model.generate(**inputs, max_new_tokens=50)
                per_frame_captions.append(blip_processor.decode(out[0], skip_special_tokens=True))
            video_caption_raw = ", ".join(set(per_frame_captions))
        except Exception as e:
            print(f"BLIP fallback skipped: {e}")

    video_caption = "No analysis available"
    if video_caption_raw != "None":
        video_caption = video_caption_raw

    # --- Step 4: Run CLIP embeddings on keyframes ---
    clip_labels = []
    umap_projection = []
    scene_clusters = []
    try:
        from sentence_transformers import SentenceTransformer
        print("Loading CLIP embedding model...")
        clip_model = SentenceTransformer("sentence-transformers/clip-ViT-B-32")
        
        embeddings = clip_model.encode(keyframe_images)
        
        # Simple scene labeling via cosine similarity with text prompts
        scene_labels = [
            "indoor scene", "outdoor scene", "people walking", "traffic",
            "animals", "nature landscape", "city street", "sports activity",
            "food preparation", "office work", "construction site", "water body"
        ]
        text_embeddings = clip_model.encode(scene_labels)
        
        for i, emb in enumerate(embeddings):
            similarities = np.dot(text_embeddings, emb) / (
                np.linalg.norm(text_embeddings, axis=1) * np.linalg.norm(emb)
            )
            best_idx = int(np.argmax(similarities))
            clip_labels.append({"second": i + 1, "scene": scene_labels[best_idx], "score": round(float(similarities[best_idx]), 3)})
            
        print(f"CLIP scene classification complete for {len(embeddings)} frames.")
    except Exception as e:
        print(f"CLIP embedding skipped (error: {e})")

    # --- Step 5: Whisper audio transcription (BEFORE LLM so transcript feeds into summary) ---
    transcript = {"full_text": "", "segments": [], "language": "unknown"}
    try:
        from modules.team5_multimodal.video_analysis_transcript import transcribe_video as whisper_transcribe
        transcript = whisper_transcribe(input_path, model_size="base")
    except ImportError:
        try:
            from video_analysis_transcript import transcribe_video as whisper_transcribe
            transcript = whisper_transcribe(input_path, model_size="base")
        except Exception as e:
            print(f"Whisper transcription skipped (error: {e})")
    except Exception as e:
        print(f"Whisper transcription skipped (error: {e})")

    # --- Step 6: LLM summary with Azure → Groq fallback (Combined Call) ---
    groq_summary = ""
    sentiment_analysis = "Neutral - Default fallback."
    all_emotions = ""
    
    if detected_objects or video_caption_raw:
        try:
            llm_client, llm_model = _get_sync_llm_client()
            provider = "Azure OpenAI" if settings.azure_openai_key else "Groq"

            items_str = ", ".join([f"{count} {obj}(s)" for obj, count in detected_objects.most_common(12)])
            scenes_str = ", ".join(set([s["scene"] for s in clip_labels[:8]])) if clip_labels else "unknown"
            transcript_text = transcript.get("full_text", "No audio detected.")

            completion = llm_client.chat.completions.create(
                model=llm_model,
                messages=[
                    {"role": "system", "content": "You are a senior multimodal AI. Your goal is to synthesize audio and video data into a professional narrative summary. DO NOT just list objects. Describe the core narrative/action."},
                    {"role": "user", "content": (
                        f"Synthesize this video content:\n"
                        f"- VISUAL CONTENT (Objects detected): {items_str}\n"
                        f"- VISUAL CONTENT (Frame analysis): {video_caption_raw}\n"
                        f"- AUDIO CONTENT (Transcript): {transcript_text}\n"
                        f"- Video duration: ~{duration_sec} seconds\n\n"
                        f"CRITICAL: If the transcript contains speech, prioritize it as the primary narrative source.\n\n"
                        f"Provide your response EXACTLY in this format:\n"
                        f"Summary: [Provide a high-quality, professional narrative summary in EXACTLY 20-30 words. Focus on human actions and conversation if present.]\n"
                        f"Sentiment: [Main Category] ([Score 0-1.0]) - [Brief description of sentiment progression throughout the video]\n"
                        f"All Emotions: [Emotion1] ([Score1]) - [Why1], [Emotion2] ([Score2]) - [Why2], [Emotion3] ([Score3]) - [Why3]"
                    )}
                ]
            )
            raw_groq_resp = completion.choices[0].message.content
            print("==========================================")
            print(f"🚀 {provider} VIDEO SUMMARY RAW:")
            print(raw_groq_resp)
            
            # Parse the structured response
            for line in raw_groq_resp.split('\n'):
                line_lower = line.lower()
                if line_lower.startswith('caption:'):
                    video_caption = line.split(':', 1)[1].strip()
                elif line_lower.startswith('summary:'):
                    groq_summary = line.split(':', 1)[1].strip()
                elif line_lower.startswith('sentiment:'):
                    sentiment_analysis = line.split(':', 1)[1].strip()
                elif line_lower.startswith('all emotions:'):
                    all_emotions = line.split(':', 1)[1].strip()
                    
            print(f"Parsed Caption: {video_caption}")
            print(f"Parsed Summary: {groq_summary}")
            print(f"Parsed Sentiment: {sentiment_analysis}")
            print(f"Parsed All Emotions: {all_emotions}")
            print("==========================================")
        except Exception as e:
            print(f"LLM API call failed: {e}")
            if not groq_summary:
                objects = ", ".join(list(detected_objects.keys())[:5])
                groq_summary = f"This video depicts a scene featuring {objects}. Further analysis is needed for a full narrative."
            sentiment_analysis = "Neutral - API call failed."
            all_emotions = "Neutral (1.0)"
    else:
        groq_summary = "No objects detected in the video."
        sentiment_analysis = "Neutral - Video is empty."
        all_emotions = "Neutral (1.0)"

    # --- Build result metadata ---
    analysis_result = {
        "duration_seconds": duration_sec,
        "keyframes_analyzed": saved_frames,
        "detected_objects": dict(detected_objects),
        "object_details": object_details,  # For the accordion UI
        "frame_detections": frame_detections,
        "video_caption": video_caption,
        "clip_scenes": clip_labels,
        "groq_summary": groq_summary,
        "sentiment_analysis": sentiment_analysis,
        "all_emotions": all_emotions,
        "transcript": transcript,
        "output_video": output_path
    }

    # Save metadata JSON alongside the video
    meta_path = output_path.replace(".mp4", "_metadata.json")
    with open(meta_path, "w") as f:
        json.dump(analysis_result, f, indent=2)
    print(f"Metadata saved to {meta_path}")

    return analysis_result


def _imageio_fallback(temp_dir: str, output_path: str, num_frames: int):
    """Fallback encoder using imageio if ffmpeg subprocess fails."""
    try:
        import imageio
        writer = imageio.get_writer(output_path, fps=1, codec='libx264',
                                     output_params=['-pix_fmt', 'yuv420p', '-movflags', '+faststart'])
        for i in range(num_frames):
            frame_path = os.path.join(temp_dir, f"frame_{i:06d}.png")
            if os.path.exists(frame_path):
                img = imageio.imread(frame_path)
                writer.append_data(img)
        writer.close()
        print(f"✅ Video encoded via imageio fallback: {output_path}")
    except Exception as e:
        print(f"imageio fallback also failed: {e}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Analyze a video using YOLOv8 + BLIP + CLIP.")
    parser.add_argument("input_video", help="Path to the input video file (e.g., sample.mp4)")
    parser.add_argument("-o", "--output", default="", help="Path for the output video file (optional)")
    parser.add_argument("-m", "--model", default="../../yolov8n.pt", help="Path to the YOLO model")
    parser.add_argument("--show", action="store_true", help="Show video window while processing")

    args = parser.parse_args()

    actual_model_path = args.model if os.path.exists(args.model) else "yolov8n.pt"

    analyze_video(args.input_video, args.output, actual_model_path, args.show)
