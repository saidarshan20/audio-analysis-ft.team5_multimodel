"""
Video_analysis.py — Full multimodal video analysis pipeline.
Uses YOLOv8 for object detection, BLIP for captioning, CLIP for embeddings.
Produces a browser-compatible H.264 MP4 and returns rich analysis metadata.
"""

import cv2
import os
import json
import argparse
import tempfile
import subprocess
import numpy as np
from collections import Counter
from ultralytics import YOLO
from PIL import Image


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
                        import base64
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
        "-c:v", "libx264",             # H.264 codec
        "-preset", "fast",
        "-pix_fmt", "yuv420p",          # browser compatibility
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

    # --- Step 3: Run BLIP captioning on keyframes → single combined caption ---
    per_frame_captions = []
    video_caption = ""
    try:
        from transformers import BlipProcessor, BlipForConditionalGeneration
        print("Loading BLIP captioning model...")
        blip_processor = BlipProcessor.from_pretrained("Salesforce/blip-image-captioning-base")
        blip_model = BlipForConditionalGeneration.from_pretrained("Salesforce/blip-image-captioning-base")
        
        for i, img in enumerate(keyframe_images):
            inputs = blip_processor(img, return_tensors="pt")
            out = blip_model.generate(**inputs, max_new_tokens=50)
            caption = blip_processor.decode(out[0], skip_special_tokens=True)
            per_frame_captions.append(caption)
            print(f"  Frame {i+1} caption: {caption}")
        
        # Filter and deduplicate per-frame captions for the LLM
        unique_blip = []
        for c in per_frame_captions:
            if c not in unique_blip:
                unique_blip.append(c)
        # We will use Groq later to synthesize this into a single caption to save API requests
        video_caption_raw = ", ".join(unique_blip)
        video_caption = ". ".join(unique_blip[:3]) # temporary fallback
        print(f"  Captured {len(unique_blip)} unique BLIP frame captions.")
    except Exception as e:
        print(f"BLIP captioning skipped (error: {e})")
        video_caption_raw = "None"
        video_caption = "Caption unavailable"

    # --- Step 4: Run CLIP embeddings on keyframes + UMAP + KMeans ---
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

        print(f"CLIP scene classification complete for {len(embeddings)} frames.")
    except Exception as e:
        print(f"CLIP embedding skipped (error: {e})")

    # --- Step 5: Groq LLM summary (Combined Call) ---
    groq_summary = ""
    sentiment_analysis = "Neutral - Default fallback."
    
    if detected_objects or video_caption_raw:
        try:
            from groq import Groq
            from dotenv import load_dotenv
            load_dotenv()
            
            items_str = ", ".join([f"{count} {obj}(s)" for obj, count in detected_objects.most_common(10)])
            scenes_str = ", ".join(set([s["scene"] for s in clip_labels[:5]])) if clip_labels else "unknown"
            
            client = Groq()
            completion = client.chat.completions.create(
                model="llama3-8b-8192",
                messages=[
                    {"role": "system", "content": "You are a multimodal video analysis AI."},
                    {"role": "user", "content": (
                        f"Analyze this video based on these AI outputs:\n"
                        f"- YOLO detected objects: {items_str}\n"
                        f"- Unique BLIP frame captions: {video_caption_raw}\n"
                        f"- CLIP scene types: {scenes_str}\n"
                        f"- Video duration: ~{duration_sec} seconds\n\n"
                        f"Provide your response EXACTLY in this format:\n"
                        f"Caption: [Write a SINGLE, natural 1-sentence descriptive caption of the entire video, removing repetitions]\n"
                        f"Summary: [Write a 2-3 sentence summary of what this video shows]\n"
                        f"Sentiment: [Positive/Negative/Neutral] - [Brief Reason]"
                    )}
                ]
            )
            raw_groq_resp = completion.choices[0].message.content
            print("==========================================")
            print("🚀 GROQ AI VIDEO SUMMARY RAW:")
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
                    
            print(f"Parsed Caption: {video_caption}")
            print(f"Parsed Summary: {groq_summary}")
            print(f"Parsed Sentiment: {sentiment_analysis}")
            print("==========================================")
        except Exception as e:
            print(f"Groq API call failed: {e}")
            if not groq_summary:
                groq_summary = f"Video contains: {', '.join(detected_objects.keys())}"
            sentiment_analysis = "Neutral - API call failed."
    else:
        groq_summary = "No objects detected in the video."
        sentiment_analysis = "Neutral - Video is empty."

    # --- Step 6: Whisper audio transcription ---
    transcript = {"full_text": "", "segments": [], "language": "unknown"}
    try:
        from modules.team5_multimodal.video_analysis_transcript import transcribe_video as whisper_transcribe
        transcript = whisper_transcribe(input_path, model_size="base")
    except ImportError:
        # Try relative import for CLI usage
        try:
            from video_analysis_transcript import transcribe_video as whisper_transcribe
            transcript = whisper_transcribe(input_path, model_size="base")
        except Exception as e:
            print(f"Whisper transcription skipped (error: {e})")
    except Exception as e:
        print(f"Whisper transcription skipped (error: {e})")

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
