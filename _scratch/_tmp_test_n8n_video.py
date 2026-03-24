import sys, os
sys.path.insert(0, r"C:\Users\NyGsoft\Desktop\publicidad")
os.chdir(r"C:\Users\NyGsoft\Desktop\publicidad")

from pathlib import Path
from n8n.public_video import publish_video_to_n8n

video = Path(r"C:\Users\NyGsoft\Desktop\publicidad\videos_publicitarias\20260319_215742_d5bb6ee7-920.mp4")

result = publish_video_to_n8n(
    video_path=video,
    title="Reel NoyeCode - Test n8n",
    description="Test envio de video via n8n webhook",
)
print(f"\nResultado: {result}")
