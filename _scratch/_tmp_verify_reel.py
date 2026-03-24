import sys, json, urllib.request
sys.path.insert(0, r"C:\Users\NyGsoft\Desktop\publicidad")

from cfg.platform import load_env
env = load_env()
token = env.get("FB_ACCESS_TOKEN", "")
page_id = env.get("FB_PAGE_ID", "")
post_id = "948300137777748"
video_id = "1554274125668567"

# 1. Check post status
print("=== VERIFICANDO POST ===")
try:
    url = f"https://graph.facebook.com/v21.0/{post_id}?fields=id,message,created_time,permalink_url,status_type&access_token={token}"
    with urllib.request.urlopen(url, timeout=10) as resp:
        data = json.loads(resp.read())
    print(json.dumps(data, indent=2))
except Exception as e:
    print(f"Error consultando post: {e}")

# 2. Check video status
print("\n=== VERIFICANDO VIDEO ===")
try:
    url = f"https://graph.facebook.com/v21.0/{video_id}?fields=id,title,description,length,status,permalink_url,source&access_token={token}"
    with urllib.request.urlopen(url, timeout=10) as resp:
        data = json.loads(resp.read())
    print(json.dumps(data, indent=2))
except Exception as e:
    print(f"Error consultando video: {e}")

# 3. Check recent page videos/reels
print("\n=== REELS RECIENTES DE LA PAGINA ===")
try:
    url = f"https://graph.facebook.com/v21.0/{page_id}/video_reels?fields=id,title,description,length,status,permalink_url&limit=3&access_token={token}"
    with urllib.request.urlopen(url, timeout=10) as resp:
        data = json.loads(resp.read())
    print(json.dumps(data, indent=2))
except Exception as e:
    print(f"Error consultando reels: {e}")
