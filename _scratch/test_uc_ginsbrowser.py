"""
Test: Launch ginsbrowser directly with --remote-debugging-port.
3 strategies:
  A) subprocess directo (sin chromedriver)
  B) undetected-chromedriver con ginsbrowser
  C) selenium attach a browser ya abierto por DiCloak
"""
import subprocess
import time
import sys
import os
import json
import urllib.request

GINSBROWSER_EXE = r"C:\Users\NyGsoft\AppData\Roaming\.DICloakCache\browsers\134.1.21\core\Application\ginsbrowser.exe"
TEMP_USER_DATA = os.path.join(os.environ.get("TEMP", r"C:\Users\NyGsoft\AppData\Local\Temp"), "uc_gins_test")
DEBUG_PORT = 9225


def test_cdp(port, label=""):
    """Check if CDP responds on given port."""
    try:
        resp = urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=5)
        info = json.loads(resp.read())
        print(f"  [CDP OK] {label} puerto {port}")
        print(f"    Browser: {info.get('Browser', '?')}")
        print(f"    WebSocket: {info.get('webSocketDebuggerUrl', 'N/A')}")
        return True
    except Exception as e:
        print(f"  [CDP FAIL] {label} puerto {port}: {e}")
        return False


def test_a_subprocess():
    """Strategy A: Launch ginsbrowser directly with subprocess."""
    print("\n" + "=" * 60)
    print("STRATEGY A: subprocess directo")
    print("=" * 60)

    cmd = [
        GINSBROWSER_EXE,
        f"--remote-debugging-port={DEBUG_PORT}",
        "--remote-allow-origins=*",
        f"--user-data-dir={TEMP_USER_DATA}",
        "--no-first-run",
        "--no-default-browser-check",
    ]
    print(f"[1] Lanzando: {' '.join(cmd[:3])}...")

    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    print(f"[2] PID: {proc.pid}")

    # Wait for browser to start
    for i in range(15):
        time.sleep(1)
        if test_cdp(DEBUG_PORT, "Strategy A"):
            # List pages
            try:
                resp = urllib.request.urlopen(f"http://127.0.0.1:{DEBUG_PORT}/json", timeout=5)
                pages = json.loads(resp.read())
                print(f"\n[3] Paginas abiertas: {len(pages)}")
                for p in pages[:3]:
                    print(f"    - {p.get('type', '?')}: {p.get('title', '?')} | {p.get('url', '?')[:60]}")
            except Exception as e:
                print(f"[3] Error listando paginas: {e}")

            print(f"\n[4] SUCCESS! ginsbrowser con CDP en puerto {DEBUG_PORT}")
            proc.terminate()
            return True

        if proc.poll() is not None:
            stderr = proc.stderr.read().decode(errors="replace")
            print(f"[!] ginsbrowser termino con code {proc.returncode}")
            if stderr:
                print(f"    stderr: {stderr[:500]}")
            return False

    print("[!] Timeout: CDP no respondio en 15s")
    proc.terminate()
    return False


def test_b_undetected_chromedriver():
    """Strategy B: Use undetected-chromedriver with ginsbrowser binary."""
    print("\n" + "=" * 60)
    print("STRATEGY B: undetected-chromedriver")
    print("=" * 60)

    try:
        import undetected_chromedriver as uc

        options = uc.ChromeOptions()
        options.binary_location = GINSBROWSER_EXE
        options.add_argument(f"--remote-debugging-port={DEBUG_PORT}")
        options.add_argument("--remote-allow-origins=*")
        options.add_argument(f"--user-data-dir={TEMP_USER_DATA}_uc")
        options.add_argument("--no-first-run")
        options.add_argument("--no-default-browser-check")

        print("[1] Lanzando via uc.Chrome...")
        driver = uc.Chrome(
            options=options,
            browser_executable_path=GINSBROWSER_EXE,
            version_main=134,
        )
        print(f"[2] Conectado! Title: {driver.title}")
        test_cdp(DEBUG_PORT, "Strategy B")
        driver.quit()
        return True
    except Exception as e:
        print(f"[ERROR] {type(e).__name__}: {e}")
        return False


def test_c_attach_existing():
    """Strategy C: Scan ginsbrowser processes for debug ports."""
    print("\n" + "=" * 60)
    print("STRATEGY C: Buscar ginsbrowser ya abierto con CDP")
    print("=" * 60)

    # Check common ports
    ports_to_try = [9225, 9222, 9229, 9333, 0]

    # Also scan via netstat
    print("[1] Buscando procesos ginsbrowser...")
    try:
        result = subprocess.run(
            ["netstat", "-ano", "-p", "tcp"],
            capture_output=True, text=True, timeout=10,
        )
        # Get ginsbrowser PIDs
        tasklist = subprocess.run(
            ["tasklist", "/fi", "imagename eq ginsbrowser.exe", "/fo", "csv", "/nh"],
            capture_output=True, text=True, timeout=10,
        )
        gins_pids = set()
        for line in tasklist.stdout.strip().splitlines():
            parts = line.strip('"').split('","')
            if len(parts) >= 2:
                try:
                    gins_pids.add(int(parts[1]))
                except ValueError:
                    pass

        if not gins_pids:
            print("  No hay procesos ginsbrowser corriendo.")
            return False

        print(f"  PIDs ginsbrowser: {gins_pids}")

        # Find LISTENING ports for those PIDs
        for line in result.stdout.splitlines():
            tokens = line.split()
            if len(tokens) >= 5 and "LISTENING" in tokens[3]:
                try:
                    pid = int(tokens[4])
                except ValueError:
                    continue
                if pid in gins_pids:
                    local = tokens[1]
                    port_str = local.rsplit(":", 1)[1]
                    try:
                        port = int(port_str)
                        ports_to_try.append(port)
                    except ValueError:
                        pass

    except Exception as e:
        print(f"  Error escaneando: {e}")

    # Test each port
    print(f"\n[2] Probando puertos: {sorted(set(p for p in ports_to_try if p > 0))}")
    for port in sorted(set(p for p in ports_to_try if p > 0)):
        if test_cdp(port, "Strategy C"):
            print(f"\n[3] SUCCESS! ginsbrowser accesible en puerto {port}")
            return True

    print("\n[3] No se encontro CDP en ningun puerto.")
    return False


if __name__ == "__main__":
    print("=" * 60)
    print("TEST: ginsbrowser + CDP debug port")
    print("=" * 60)

    results = {}

    # Strategy A: Direct subprocess
    results["A"] = test_a_subprocess()

    # Strategy C: Check existing ginsbrowser (if DiCloak opened one)
    results["C"] = test_c_attach_existing()

    # Strategy B: undetected-chromedriver (last, slowest)
    if not results["A"]:
        results["B"] = test_b_undetected_chromedriver()
    else:
        results["B"] = "SKIPPED"

    print("\n" + "=" * 60)
    print("RESULTADOS:")
    print("=" * 60)
    for key, val in results.items():
        status = "OK" if val is True else ("SKIP" if val == "SKIPPED" else "FAIL")
        print(f"  Strategy {key}: {status}")
