import sys
sys.path.insert(0, r"C:\Users\NyGsoft\Desktop\publicidad")
from cfg.platform import read_cdp_debug_info, test_cdp_port
data = read_cdp_debug_info()
print("CDP info:", data)
for k, v in data.items():
    if isinstance(v, dict):
        port = v.get("debugPort", 0)
        if port:
            alive = test_cdp_port(int(port))
            print(f"  {k}: port={port} alive={alive}")
# Also scan common ports
for p in range(9225, 9240):
    if test_cdp_port(p):
        print(f"  FOUND CDP on port {p}!")
