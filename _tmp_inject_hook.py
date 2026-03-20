import sys, os
sys.path.insert(0, r"C:\Users\NyGsoft\Desktop\publicidad")
os.chdir(r"C:\Users\NyGsoft\Desktop\publicidad")
from cdp.force_cdp import inject_cdp_hook
result = inject_cdp_hook(dicloak_port=9333)
print("Hook result:", result)
