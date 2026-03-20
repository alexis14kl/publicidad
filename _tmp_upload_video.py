import sys, os
sys.path.insert(0, r"C:\Users\NyGsoft\Desktop\publicidad")
os.chdir(r"C:\Users\NyGsoft\Desktop\publicidad")

from cfg.platform import load_env
env = load_env()

token = env.get("FB_ACCESS_TOKEN", "") or os.environ.get("FB_ACCESS_TOKEN", "")
page_id = env.get("FB_PAGE_ID", "") or os.environ.get("FB_PAGE_ID", "")

print(f"Token: {token[:20]}..." if token else "TOKEN NO ENCONTRADO")
print(f"Page ID: {page_id}" if page_id else "PAGE_ID NO ENCONTRADO")

if not token or not page_id:
    print("Faltan credenciales. Abortando.")
    sys.exit(1)

video_path = r"C:\Users\NyGsoft\Desktop\publicidad\videos_publicitarias\20260319_215742_d5bb6ee7-920.mp4"

from facebook.direct_video_upload import upload_reel
result = upload_reel(
    video_path=video_path,
    page_id=page_id,
    access_token=token,
    title="Reel NoyeCode - Automatizacion",
    description="Automatiza tu negocio con NoyeCode - Generado con IA",
)
print(f"\nResultado: {result}")
