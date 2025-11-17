export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request);
    } catch (err) {
      return new Response("Worker error:\n" + err.stack, { status: 502 });
    }
  }
}

async function handleRequest(request) {
  const url = new URL(request.url);
  url.hostname = "target.com"; // force target host
  const targetUrl = "https://" + url.host + url.pathname + url.search;

  const upstreamRes = await fetch(targetUrl, {
    method: request.method,
    headers: request.headers,
    body: request.method !== "GET" && request.method !== "HEAD" ? request.body : undefined,
    redirect: "manual"
  });

  const contentType = upstreamRes.headers.get("content-type") || "";
  let body = await upstreamRes.text();

  // 🟢 Inject JS into HTML responses
  if (contentType.includes("text/html")) {
    const injectScript = `
      <script>
        (function() {
          // Patch fetch to intercept /api/v1/auth/login
          const origFetch = window.fetch;
          window.fetch = async function(input, init) {
            const res = await origFetch(input, init);
            try {
              if (typeof input === "string" && input.includes("/api/v1/auth/login")) {
                const clone = res.clone();
                clone.json().then(data => {
                  if (data && data.data && data.data.token) {
                    alert("Token: " + data.data.token);
                  }
                }).catch(()=>{});
              }
            } catch(e) { console.warn("Token intercept failed", e); }
            return res;
          };
        })();
      </script>
    `;
    // Inject before </body> or at end of document
    if (body.includes("</body>")) {
      body = body.replace("</body>", injectScript + "</body>");
    } else {
      body += injectScript;
    }
  }

  // 🟡 Patch JS responses (still keep replaceState neutralization)
  if (contentType.includes("javascript")) {
    body =
      `window.history.replaceState2 = function(u, _, o) { return; };` +
      body.replace(/window\.history\.replaceState/g, "window.history.replaceState2");
  }

  // Add permissive CORS headers
  const newHeaders = new Headers(upstreamRes.headers);
  newHeaders.set("access-control-allow-origin", "*");
  newHeaders.set("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  newHeaders.set("access-control-allow-headers", "*");

  return new Response(body, {
    status: upstreamRes.status,
    headers: newHeaders,
  });
}
