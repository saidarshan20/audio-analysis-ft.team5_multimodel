# Audio Quality Calibration Fixtures

Place labeled speech clips here for score calibration.

Required minimum for robust calibration:
- 15 clips per tier: `Poor`, `Fair`, `Good`, `Excellent`
- At least 2 domains (e.g. studio speech, phone speech, noisy environment speech)

Labels file format (`labels.csv`):

```csv
file,tier
clip001.wav,Poor
clip002.wav,Fair
clip003.wav,Good
clip004.wav,Excellent
```

Use:

```bash
python scripts/calibrate_scoring.py
```
