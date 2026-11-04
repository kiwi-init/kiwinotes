# Cliente mínimo do MCP do Rive desktop (http://127.0.0.1:9791/mcp, só nesta máquina, com o Rive aberto) para os
# scripts do T3151: `python3 rive-mcp.py tools`, `schema NOME`, `t NOME JSON` (o texto da resposta) e `upload ARQUIVO`
# (o editor é sandbox: o arquivo vai como data URI). A sessão fica em rive-sid.txt, ao lado.
# Cliente MCP mínimo do Rive (http://127.0.0.1:9791/mcp), por linha de comando. Só local.
import json, sys, urllib.request, os
URL = "http://127.0.0.1:9791/mcp"
SID_FILE = os.path.join(os.path.dirname(__file__), "rive-sid.txt")
def post(body, sid=None):
    h = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25"}
    if sid: h["mcp-session-id"] = sid
    req = urllib.request.Request(URL, data=json.dumps(body).encode(), headers=h, method="POST")
    with urllib.request.urlopen(req, timeout=60) as r:
        raw = r.read().decode(); sid2 = r.headers.get("mcp-session-id")
    if raw.startswith("event:") or raw.startswith("data:"):
        raw = "\n".join(l[5:].strip() for l in raw.splitlines() if l.startswith("data:"))
    return (json.loads(raw) if raw.strip() else None), sid2
def session():
    if os.path.exists(SID_FILE): return open(SID_FILE).read().strip()
    _, sid = post({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"kiwi-agent","version":"1"}}})
    post({"jsonrpc":"2.0","method":"notifications/initialized"}, sid)
    open(SID_FILE,"w").write(sid); return sid
cmd = sys.argv[1]
sid = session()
if cmd == "tools":
    r,_ = post({"jsonrpc":"2.0","id":2,"method":"tools/list"}, sid)
    for t in r["result"]["tools"]: print(t["name"], "—", (t.get("description") or "")[:160].replace("\n"," "))
elif cmd == "schema":
    r,_ = post({"jsonrpc":"2.0","id":2,"method":"tools/list"}, sid)
    for t in r["result"]["tools"]:
        if t["name"] == sys.argv[2]: print(json.dumps(t, indent=1))
elif cmd == "call":
    args = json.loads(sys.argv[3]) if len(sys.argv) > 3 else {}
    r,_ = post({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":sys.argv[2],"arguments":args}}, sid)
    print(json.dumps(r, indent=1, ensure_ascii=False)[:int(os.environ.get("MAX","8000"))])
elif cmd == "t":
    args = json.loads(sys.argv[3]) if len(sys.argv) > 3 else {}
    r,_ = post({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":sys.argv[2],"arguments":args}}, sid)
    res = r.get("result") or r
    for c in res.get("content", []):
        if c.get("type") == "text": print(c["text"][:int(os.environ.get("MAX","3000"))])
        elif c.get("type") == "image":
            import base64
            out = os.environ.get("IMG", os.path.join(os.path.dirname(__file__), "rive-capture.png"))
            open(out,"wb").write(base64.b64decode(c["data"])); print("image ->", out)
    if res.get("isError"): print("[isError]")
elif cmd == "upload":
    import base64, urllib.parse
    f = sys.argv[2]
    mt = "image/svg+xml" if f.endswith(".svg") else "image/webp" if f.endswith(".webp") else "application/octet-stream"
    uri = "data:%s;name=%s;base64,%s" % (mt, urllib.parse.quote(os.path.basename(f)), base64.b64encode(open(f,"rb").read()).decode())
    r,_ = post({"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"upload_asset","arguments":{"file":uri}}}, sid)
    for c in (r.get("result") or {}).get("content", []): print(c.get("text","")[:2000])
