#!/usr/bin/env python3
"""
Facebook/Meta Ads MCP Server
Provides tools to manage Facebook ad campaigns via the Marketing API.
"""
import sys
import json
import argparse
import requests

# Meta Graph API base
GRAPH_API = "https://graph.facebook.com/v21.0"
TOKEN = None

def api_get(endpoint, params=None):
    p = params or {}
    p["access_token"] = TOKEN
    r = requests.get(f"{GRAPH_API}/{endpoint}", params=p)
    return r.json()

def api_post(endpoint, data=None):
    d = data or {}
    d["access_token"] = TOKEN
    r = requests.post(f"{GRAPH_API}/{endpoint}", data=d)
    return r.json()

# ── MCP Protocol ─────────────────────────────────────────────

def handle_initialize(msg):
    return {
        "protocolVersion": "2024-11-05",
        "capabilities": {"tools": {"listChanged": False}},
        "serverInfo": {"name": "fb-ads-mcp-server", "version": "1.0.0"}
    }

def handle_tools_list(msg):
    return {
        "tools": [
            {
                "name": "fb_get_ad_accounts",
                "description": "List all ad accounts accessible with the current token",
                "inputSchema": {"type": "object", "properties": {}}
            },
            {
                "name": "fb_get_campaigns",
                "description": "List campaigns for an ad account",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "ad_account_id": {"type": "string", "description": "Ad account ID (act_XXXXX)"}
                    },
                    "required": ["ad_account_id"]
                }
            },
            {
                "name": "fb_get_adsets",
                "description": "List ad sets for a campaign",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "campaign_id": {"type": "string", "description": "Campaign ID"}
                    },
                    "required": ["campaign_id"]
                }
            },
            {
                "name": "fb_get_ads",
                "description": "List ads for an ad set or campaign",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "parent_id": {"type": "string", "description": "Ad set ID or campaign ID"},
                        "parent_type": {"type": "string", "enum": ["adset", "campaign"], "description": "Parent type"}
                    },
                    "required": ["parent_id"]
                }
            },
            {
                "name": "fb_get_insights",
                "description": "Get performance insights/metrics for a campaign, adset, or ad",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "object_id": {"type": "string", "description": "Campaign, adset, or ad ID"},
                        "date_preset": {"type": "string", "enum": ["today", "yesterday", "last_7d", "last_30d", "this_month", "last_month"], "description": "Date range preset"}
                    },
                    "required": ["object_id"]
                }
            },
            {
                "name": "fb_create_campaign",
                "description": "Create a new ad campaign",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "ad_account_id": {"type": "string", "description": "Ad account ID (act_XXXXX)"},
                        "name": {"type": "string", "description": "Campaign name"},
                        "objective": {"type": "string", "enum": ["OUTCOME_AWARENESS", "OUTCOME_TRAFFIC", "OUTCOME_ENGAGEMENT", "OUTCOME_LEADS", "OUTCOME_SALES"], "description": "Campaign objective"},
                        "status": {"type": "string", "enum": ["PAUSED", "ACTIVE"], "description": "Initial status"}
                    },
                    "required": ["ad_account_id", "name", "objective"]
                }
            },
            {
                "name": "fb_create_adset",
                "description": "Create an ad set within a campaign",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "ad_account_id": {"type": "string", "description": "Ad account ID"},
                        "campaign_id": {"type": "string", "description": "Campaign ID"},
                        "name": {"type": "string", "description": "Ad set name"},
                        "daily_budget": {"type": "string", "description": "Daily budget in cents (e.g. '2000' = $20)"},
                        "targeting": {"type": "object", "description": "Targeting spec"},
                        "billing_event": {"type": "string", "enum": ["IMPRESSIONS", "LINK_CLICKS"], "description": "Billing event"},
                        "optimization_goal": {"type": "string", "enum": ["REACH", "IMPRESSIONS", "LINK_CLICKS", "LANDING_PAGE_VIEWS", "LEAD_GENERATION"], "description": "Optimization goal"}
                    },
                    "required": ["ad_account_id", "campaign_id", "name", "daily_budget"]
                }
            },
            {
                "name": "fb_upload_image",
                "description": "Upload an ad image to the ad account",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "ad_account_id": {"type": "string", "description": "Ad account ID"},
                        "image_path": {"type": "string", "description": "Local path to the image file"}
                    },
                    "required": ["ad_account_id", "image_path"]
                }
            },
            {
                "name": "fb_create_ad_creative",
                "description": "Create an ad creative with image and copy",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "ad_account_id": {"type": "string", "description": "Ad account ID"},
                        "name": {"type": "string", "description": "Creative name"},
                        "image_hash": {"type": "string", "description": "Image hash from fb_upload_image"},
                        "page_id": {"type": "string", "description": "Facebook Page ID"},
                        "message": {"type": "string", "description": "Primary text / post copy"},
                        "headline": {"type": "string", "description": "Headline (25 chars)"},
                        "description": {"type": "string", "description": "Description (30 chars)"},
                        "link": {"type": "string", "description": "Destination URL"},
                        "call_to_action_type": {"type": "string", "enum": ["LEARN_MORE", "SIGN_UP", "CONTACT_US", "SEND_WHATSAPP_MESSAGE", "MESSAGE_PAGE"], "description": "CTA button type"}
                    },
                    "required": ["ad_account_id", "name", "image_hash", "page_id", "message"]
                }
            },
            {
                "name": "fb_create_ad",
                "description": "Create an ad linking a creative to an ad set",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "ad_account_id": {"type": "string", "description": "Ad account ID"},
                        "adset_id": {"type": "string", "description": "Ad set ID"},
                        "creative_id": {"type": "string", "description": "Creative ID"},
                        "name": {"type": "string", "description": "Ad name"},
                        "status": {"type": "string", "enum": ["PAUSED", "ACTIVE"], "description": "Initial status"}
                    },
                    "required": ["ad_account_id", "adset_id", "creative_id", "name"]
                }
            },
            {
                "name": "fb_get_pages",
                "description": "List Facebook Pages accessible with the current token",
                "inputSchema": {"type": "object", "properties": {}}
            }
        ]
    }

def handle_tool_call(msg):
    name = msg["params"]["name"]
    args = msg["params"].get("arguments", {})

    try:
        if name == "fb_get_ad_accounts":
            result = api_get("me/adaccounts", {"fields": "id,name,account_status,currency,business_name"})

        elif name == "fb_get_campaigns":
            result = api_get(f"{args['ad_account_id']}/campaigns", {"fields": "id,name,status,objective,daily_budget,lifetime_budget"})

        elif name == "fb_get_adsets":
            result = api_get(f"{args['campaign_id']}/adsets", {"fields": "id,name,status,daily_budget,targeting,optimization_goal"})

        elif name == "fb_get_ads":
            parent = args["parent_id"]
            result = api_get(f"{parent}/ads", {"fields": "id,name,status,creative"})

        elif name == "fb_get_insights":
            preset = args.get("date_preset", "last_7d")
            result = api_get(f"{args['object_id']}/insights", {
                "fields": "impressions,clicks,spend,cpc,cpm,ctr,actions,cost_per_action_type",
                "date_preset": preset
            })

        elif name == "fb_create_campaign":
            result = api_post(f"{args['ad_account_id']}/campaigns", {
                "name": args["name"],
                "objective": args["objective"],
                "status": args.get("status", "PAUSED"),
                "special_ad_categories": "[]"
            })

        elif name == "fb_create_adset":
            data = {
                "campaign_id": args["campaign_id"],
                "name": args["name"],
                "daily_budget": args["daily_budget"],
                "billing_event": args.get("billing_event", "IMPRESSIONS"),
                "optimization_goal": args.get("optimization_goal", "LINK_CLICKS"),
                "status": "PAUSED"
            }
            if "targeting" in args:
                data["targeting"] = json.dumps(args["targeting"])
            else:
                data["targeting"] = json.dumps({
                    "geo_locations": {"countries": ["CO"]},
                    "age_min": 25, "age_max": 55
                })
            result = api_post(f"{args['ad_account_id']}/adsets", data)

        elif name == "fb_upload_image":
            with open(args["image_path"], "rb") as f:
                r = requests.post(
                    f"{GRAPH_API}/{args['ad_account_id']}/adimages",
                    params={"access_token": TOKEN},
                    files={"filename": f}
                )
                result = r.json()

        elif name == "fb_create_ad_creative":
            obj_story = {
                "page_id": args["page_id"],
                "link_data": {
                    "image_hash": args["image_hash"],
                    "message": args["message"],
                    "link": args.get("link", "https://noyecode.com"),
                    "name": args.get("headline", ""),
                    "description": args.get("description", ""),
                    "call_to_action": {"type": args.get("call_to_action_type", "LEARN_MORE")}
                }
            }
            result = api_post(f"{args['ad_account_id']}/adcreatives", {
                "name": args["name"],
                "object_story_spec": json.dumps(obj_story)
            })

        elif name == "fb_create_ad":
            result = api_post(f"{args['ad_account_id']}/ads", {
                "adset_id": args["adset_id"],
                "creative": json.dumps({"creative_id": args["creative_id"]}),
                "name": args["name"],
                "status": args.get("status", "PAUSED")
            })

        elif name == "fb_get_pages":
            result = api_get("me/accounts", {"fields": "id,name,category,access_token"})

        else:
            result = {"error": f"Unknown tool: {name}"}

        return {"content": [{"type": "text", "text": json.dumps(result, indent=2, ensure_ascii=False)}]}

    except Exception as e:
        return {"content": [{"type": "text", "text": f"Error: {str(e)}"}]}

# ── Main loop (stdio transport) ──────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--fb-token", required=True, help="Meta Marketing API access token")
    args = parser.parse_args()

    global TOKEN
    TOKEN = args.fb_token

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue

        method = msg.get("method", "")
        response = {"jsonrpc": "2.0", "id": msg.get("id")}

        if method == "initialize":
            response["result"] = handle_initialize(msg)
        elif method == "tools/list":
            response["result"] = handle_tools_list(msg)
        elif method == "tools/call":
            response["result"] = handle_tool_call(msg)
        elif method == "notifications/initialized":
            continue
        else:
            response["result"] = {}

        sys.stdout.write(json.dumps(response) + "\n")
        sys.stdout.flush()

if __name__ == "__main__":
    main()
