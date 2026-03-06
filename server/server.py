"""A minimal MCP server example for Dicloak."""
import sys
import json

# This server simply echoes requests back for demonstration purposes.
# Replace with real logic for dicloak.

def handle_request(params):
    # simple echo
    return {"result": params}


def main():
    for line in sys.stdin:
        try:
            message = json.loads(line)
        except json.JSONDecodeError:
            continue
        # MCP messages usually include an "id" and a "method" field
        response = {
            "id": message.get("id"),
            "result": handle_request(message.get("params"))
        }
        sys.stdout.write(json.dumps(response) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
